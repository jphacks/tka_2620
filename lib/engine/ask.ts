// POST /api/ask (F3.5): the newcomer asks at a seat. The question is saved with its lang and, when nobody could
// answer it, it becomes a demand prompt that reaches the seat's reachable predecessors (docs/SPEC.md → F3).
//
// Everything here runs as the caller (lib/engine/route.ts), so the database does the scope work: questions and answers
// are the asker's own rows, and route_question() (0003) creates the prompt and the prompt_routes rows, refusing
// anyone who holds no seat at the seat they asked — their question routes nowhere and no prompt is created.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AskRequest, type AskResult, Uuid } from "@/lib/contracts";
import { questionLang } from "@/lib/engine/lang";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
} from "@/lib/engine/route";

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
      await askAsCaller(caller.db, caller.userId, parsed.data),
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

// The flow, as the asker. Split from the handler so a test can drive it with a client of its own.
// F2 puts retrieval and the grounded answer here; until it lands, every question abstains and takes the live loop.
export async function askAsCaller(
  client: SupabaseClient,
  askerUserId: string,
  request: AskRequest,
): Promise<AskResult> {
  const { data: seat, error: seatError } = await client
    .from("seats")
    .select("id")
    .eq("slug", request.seat)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seat) throw new ApiFailure("not_found");

  const { data: question, error: questionError } = await client
    .from("questions")
    .insert({
      asker_user_id: askerUserId,
      seat_id: seat.id,
      text: request.question,
      lang: questionLang(request.question),
    })
    .select("id")
    .single();
  if (questionError || !question) throw dbFailure(questionError);

  // Nobody knew: the question becomes a new demand prompt of the seat, worded as the newcomer asked it. Joining an
  // open prompt that asks the same thing (route_question's join_prompt) and rewording the question about the seat
  // come with dedupe (F2.5).
  const { data, error } = await client.rpc("route_question", {
    question: question.id,
    prompt_text: request.question,
  });
  if (error) throw dbFailure(error);
  const routed = Routed.safeParse(Array.isArray(data) ? data[0] : data);
  if (!routed.success) throw new ApiFailure("unavailable");
  const { prompt_id: promptId, routed_to: routedTo } = routed.data;
  return {
    status: "abstained",
    questionId: question.id,
    // Absent when the asker holds no seat at that seat: nothing was routed, so no prompt exists to name.
    ...(promptId && { promptId }),
    routedTo,
  };
}
