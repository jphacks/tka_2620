// POST /api/ask (F3.5): the newcomer asks at a seat. The question is saved with its lang and, when nobody could
// answer it, it becomes a demand prompt that reaches the seat's reachable predecessors (docs/SPEC.md → F3).
//
// Everything here runs as the caller (lib/engine/http.ts), so the database does the scope work: questions and answers
// are the asker's own rows, and route_question() (0003) creates the prompt and the prompt_routes rows, refusing
// anyone who holds no seat at the seat they asked — their question routes nowhere and no prompt is created.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AskRequest, type AskResult } from "@/lib/contracts";
import {
  ApiFailure,
  apiError,
  callerClient,
  callerToken,
  dbFailure,
} from "@/lib/engine/http";
import { questionLang } from "@/lib/engine/lang";

export async function handleAsk(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) return apiError("unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_request");
  }
  const parsed = AskRequest.safeParse(body);
  if (!parsed.success) return apiError("invalid_request");

  let code: ApiFailure["code"] = "unavailable";
  try {
    const client = callerClient(token);
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) return apiError("unauthorized");
    return Response.json(await askAsCaller(client, user.id, parsed.data));
  } catch (error) {
    if (error instanceof ApiFailure) code = error.code;
    // The code only: no question text, ever (docs/SPEC.md → Scope rules).
    console.error(`POST /api/ask: ${code}`);
    return apiError(code);
  }
}

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

  // Nobody knew: the question becomes a demand prompt of the seat, or joins an open one asking the same thing (F2.5).
  const { data, error } = await client.rpc("route_question", {
    question: question.id,
    prompt_text: request.question,
  });
  if (error) throw dbFailure(error);

  // A function with OUT parameters answers with one row, as an object or a one-item array.
  const routed = (Array.isArray(data) ? data[0] : data) as {
    prompt_id: string | null;
    routed_to: number | null;
  } | null;
  return {
    status: "abstained",
    questionId: question.id,
    // Absent when the asker holds no seat at that seat: nothing was routed, so no prompt exists to name.
    ...(routed?.prompt_id ? { promptId: routed.prompt_id } : {}),
    routedTo: routed?.routed_to ?? 0,
  };
}
