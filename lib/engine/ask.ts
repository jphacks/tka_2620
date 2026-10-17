// POST /api/ask (F2, F3.5): the newcomer asks at a seat. The notes they may read answer it, every sentence citing one
// (docs/SPEC.md → F2); when they can't, the question becomes a demand prompt that reaches the seat's reachable
// predecessors (docs/SPEC.md → F3). Either way the question is saved with its lang.
//
// Everything here runs as the caller (lib/engine/route.ts), so the database does the scope work: search_notes (0004)
// finds only notes the asker may read, questions and answers are the asker's own rows, and route_question() (0003)
// creates the prompt and the prompt_routes rows, refusing anyone who holds no seat at the seat they asked — their
// question routes nowhere and no prompt is created. Before routing, open_demand_prompts() (0008) gives the asker's
// waiting question the seat's open demand prompts, so Haiku can join one that asks the same thing (F2.5).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { haiku, sonnet } from "@/lib/ai";
import {
  type AnsweredResult,
  AskRequest,
  AskResult,
  Uuid,
} from "@/lib/contracts";
import { embed } from "@/lib/embed";
import { answerFromNotes } from "@/lib/engine/answer";
import {
  type Dedupe,
  dedupeQuestion,
  type OpenPrompt,
  promptText,
} from "@/lib/engine/dedupe";
import { questionLang } from "@/lib/engine/lang";
import { findNotes } from "@/lib/engine/retrieve";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
  logFailure,
} from "@/lib/engine/route";

// The models behind an answer, passed in so a test can fake them: bge-m3 for the search, Sonnet for the answer, Haiku
// for dedupe. The answer model is made only once notes are found, and the dedupe model only after an abstain, which
// routes without it too (lib/engine/dedupe.ts), so the live loop never needs the Claude key.
export type AskModels = {
  embed: (texts: string[]) => Promise<number[][]>;
  answer: () => LanguageModel;
  dedupe: () => LanguageModel;
};

export async function handleAsk(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = AskRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(
      await askAsCaller(caller.db, caller.userId, parsed.data, {
        embed,
        answer: sonnet,
        dedupe: haiku,
      }),
    );
  } catch (error) {
    // The code only: no question text, ever (docs/SPEC.md → Scope rules).
    return failed("POST /api/ask", error);
  }
}

// route_question()'s OUT parameters: PostgREST answers with its one row, as an object or a one-item array.
const Routed = z.object({
  prompt_id: Uuid.nullable(),
  routed_to: z.number().int().nonnegative(),
});

// open_demand_prompts()'s rows (0008).
const OpenPrompts = z.array(z.object({ id: Uuid, text: z.string() }));

// The flow, as the asker. Split from the handler so a test can drive it with a client and models of its own.
// The search and the answer come before anything is saved, so a stopped Ollama or a failed Claude call leaves no
// question behind; a failure answers unavailable, never a made-up abstain.
export async function askAsCaller(
  client: SupabaseClient,
  askerUserId: string,
  request: AskRequest,
  models: AskModels,
): Promise<AskResult> {
  const { data: seat, error: seatError } = await client
    .from("seats")
    .select("id, name")
    .eq("slug", request.seat)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seat) throw new ApiFailure("not_found");

  const notes = await findNotes(
    client,
    request.seat,
    request.question,
    models.embed,
  );
  const answer =
    notes.length > 0
      ? await answerFromNotes({
          model: models.answer(),
          question: request.question,
          notes,
          seatId: seat.id,
        })
      : undefined;

  const { data: question, error: questionError } = await client
    .from("questions")
    .insert({
      asker_user_id: askerUserId,
      seat_id: seat.id,
      text: request.question,
      lang: questionLang(request.question),
      status: answer ? "answered" : "waiting",
    })
    .select("id")
    .single();
  if (questionError || !question) throw dbFailure(questionError);

  if (answer) {
    const result: AnsweredResult = {
      status: "answered",
      questionId: question.id,
      ...answer,
    };
    // Kept as the asker's latest answer, so a withdrawal can answer again without the withdrawn note (F4). The reply is
    // the row as stored: the database keeps only sentences on live notes the asker may read (0006), so an answer saved
    // while one of its notes was being withdrawn comes back without it, here and in the asker's Realtime row alike.
    const { data: saved, error: answerError } = await client
      .from("answers")
      .insert({ question_id: question.id, payload: result })
      .select("payload")
      .single();
    if (answerError || !saved) throw dbFailure(answerError);
    const stored = AskResult.safeParse(saved.payload);
    if (!stored.success) throw new ApiFailure("unavailable");
    return stored.data;
  }

  // Nobody knew: the question goes to the seat's reachable predecessors as a demand prompt.
  const { promptId, routedTo } = await routeQuestion(
    client,
    question.id,
    { name: seat.name, question: request.question },
    models,
  );
  return {
    status: "abstained",
    questionId: question.id,
    // Absent when nothing was routed (the asker holds no seat at that seat), so no prompt exists to name.
    ...(promptId && { promptId }),
    routedTo,
  };
}

type Routing = { promptId?: string; routedTo: number };

// Dedupe (F2.5): Haiku joins the question to an open prompt of the seat that asks the same thing, or words it as a new
// prompt about the seat. Both are best effort, so the live loop never waits on them: with no open prompts, or no
// Haiku, the question starts a new prompt as typed. A prompt text the guard refuses (contact details, a credential, a
// name) is never sent, so a question with none to send routes nowhere.
async function routeQuestion(
  client: SupabaseClient,
  questionId: string,
  asked: { name: string; question: string },
  models: AskModels,
): Promise<Routing> {
  const prompts = await openPrompts(client, questionId);
  let dedupe: Dedupe = {};
  try {
    dedupe = await dedupeQuestion({
      model: models.dedupe(),
      seatName: asked.name,
      question: asked.question,
      prompts,
    });
  } catch (error) {
    logFailure("POST /api/ask dedupe", error);
  }

  if (dedupe.joinPrompt) {
    const joined = await route(client, {
      question: questionId,
      join_prompt: dedupe.joinPrompt,
    });
    if (joined) return joined;
  }
  const text = dedupe.promptText ?? promptText(asked.question);
  if (!text) {
    console.error("POST /api/ask: no prompt text passed the guard, not routed");
    return { routedTo: 0 };
  }
  const routed = await route(client, {
    question: questionId,
    prompt_text: text,
  });
  if (!routed) throw new ApiFailure("unavailable");
  return routed;
}

// The seat's open demand prompts, for the asker's waiting question; none when the function fails (0008 not applied
// yet, say), so the question starts a prompt of its own.
async function openPrompts(
  client: SupabaseClient,
  questionId: string,
): Promise<OpenPrompt[]> {
  const { data, error } = await client.rpc("open_demand_prompts", {
    question: questionId,
  });
  if (error) {
    logFailure("POST /api/ask open_demand_prompts", dbFailure(error));
    return [];
  }
  return OpenPrompts.safeParse(data).data ?? [];
}

// route_question(), joining a prompt or starting one. Undefined when the prompt to join is no longer open (retired or
// gone since it was read: 22023), so the caller can start one instead.
async function route(
  client: SupabaseClient,
  args:
    | { question: string; join_prompt: string }
    | {
        question: string;
        prompt_text: string;
      },
): Promise<Routing | undefined> {
  const { data, error } = await client.rpc("route_question", args);
  if (error?.code === "22023" && "join_prompt" in args) return undefined;
  if (error) throw dbFailure(error);
  const routed = Routed.safeParse(Array.isArray(data) ? data[0] : data);
  if (!routed.success) throw new ApiFailure("unavailable");
  const { prompt_id: promptId, routed_to: routedTo } = routed.data;
  return { ...(promptId && { promptId }), routedTo };
}
