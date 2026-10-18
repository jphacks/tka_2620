// POST /api/ask (F2, F3.5): the newcomer asks at a seat. The notes they may read answer it, every sentence citing one
// (docs/SPEC.md → F2); when they can't, the question becomes a demand prompt that reaches the seat's reachable
// predecessors (docs/SPEC.md → F3). Either way the question is saved with its lang.
//
// Everything here runs as the caller (lib/engine/route.ts), so the database does the scope work: search_notes (0004)
// finds only notes the asker may read, questions and answers are the asker's own rows, and ask_question() (0012) saves
// an unanswered question and routes it in one transaction, so a routing that fails leaves no question behind. It
// creates the prompt and the prompt_routes rows, and routes nowhere, creating no prompt, when the asker holds no seat
// at the seat they asked or nobody but the asker could receive it. Before that, open_demand_prompts_at() (0012) gives
// a holder the seat's open demand prompts, so Haiku can join one that asks the same thing (F2.5). For the rule-change
// flag, superseded_deadlines() (0010) gives the deadline notes the found ones replaced, again as the asker.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { haiku, sonnet } from "@/lib/ai";
import {
  type AbstainedResult,
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
import { findNotes, replacedDeadlines } from "@/lib/engine/retrieve";
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

// ask_question()'s OUT parameters (0012): PostgREST answers with its one row, as an object or a one-item array.
const Asked = z.object({
  question_id: Uuid,
  prompt_id: Uuid.nullable(),
  routed_to: z.number().int().nonnegative(),
});

// open_demand_prompts_at()'s rows (0012).
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
  // The deadlines the found notes replaced (superseded_deadlines(), 0010) are only the rule-change flag's history: if
  // they can't be read, the answer goes on without them.
  const replaced = await replacedDeadlines(client, notes, seat.id).catch(
    (error: unknown) => {
      logFailure("POST /api/ask: replaced deadlines", error);
      return [];
    },
  );
  const answer =
    notes.length > 0
      ? await answerFromNotes({
          model: models.answer(),
          question: request.question,
          notes,
          seatId: seat.id,
          replaced,
        })
      : undefined;

  if (answer) {
    const { data: question, error: questionError } = await client
      .from("questions")
      .insert({
        asker_user_id: askerUserId,
        seat_id: seat.id,
        text: request.question,
        lang: questionLang(request.question),
        status: "answered",
      })
      .select("id")
      .single();
    if (questionError || !question) throw dbFailure(questionError);

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
  return askPredecessors(client, seat, request.question, models);
}

// Dedupe (F2.5): Haiku joins the question to an open prompt of the seat that asks the same thing, or words it as a new
// prompt about the seat. Both are best effort, so the live loop never waits on them: with no open prompts, or no
// Haiku, the question starts a new prompt as typed. A prompt text the guard refuses (contact details, a credential, a
// name) is never sent, so a question with none to send routes nowhere. Only a prompt in Haiku's words is offered to
// the seat's later askers (listed): one as typed reaches the routed predecessors and nobody else.
// Then one call saves the question and routes it (ask_question(), 0012). It joins the prompt Haiku picked while that is
// still open and otherwise starts one from the text, so a prompt retired in the meantime needs no second call, and a
// call that fails saves nothing: asking again doesn't save the question twice.
async function askPredecessors(
  client: SupabaseClient,
  seat: { id: string; name: string },
  question: string,
  models: AskModels,
): Promise<AbstainedResult> {
  const prompts = await openPrompts(client, seat.id);
  let dedupe: Dedupe = { errors: [] };
  try {
    dedupe = await dedupeQuestion({
      model: models.dedupe(),
      seatName: seat.name,
      question,
      prompts,
    });
  } catch (error) {
    dedupe = { errors: [error] };
  }
  for (const error of dedupe.errors) {
    logFailure("POST /api/ask dedupe", error);
  }

  const text = dedupe.promptText ?? promptText(question);
  const { data, error } = await client.rpc("ask_question", {
    seat: seat.id,
    question,
    lang: questionLang(question),
    ...(dedupe.joinPrompt && { join_prompt: dedupe.joinPrompt }),
    ...(text && { prompt_text: text, listed: text === dedupe.promptText }),
  });
  if (error) throw dbFailure(error);
  const asked = Asked.safeParse(Array.isArray(data) ? data[0] : data);
  if (!asked.success) throw new ApiFailure("unavailable");
  const {
    question_id: questionId,
    prompt_id: promptId,
    routed_to: routedTo,
  } = asked.data;
  if (!text && !promptId) {
    console.error("POST /api/ask: no prompt text passed the guard, not routed");
  }
  return {
    status: "abstained",
    questionId,
    // Absent when nothing was routed (the asker holds no seat at that seat, or nobody but the asker could receive it),
    // so no prompt exists to name.
    ...(promptId && { promptId }),
    routedTo,
  };
}

// The seat's open demand prompts, for a holder about to ask there; none when the function fails, so the question
// starts a prompt of its own.
async function openPrompts(
  client: SupabaseClient,
  seatId: string,
): Promise<OpenPrompt[]> {
  const { data, error } = await client.rpc("open_demand_prompts_at", {
    seat: seatId,
  });
  if (error) {
    logFailure("POST /api/ask open_demand_prompts_at", dbFailure(error));
    return [];
  }
  return OpenPrompts.safeParse(data).data ?? [];
}
