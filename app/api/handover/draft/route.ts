// POST /api/handover/draft: a predecessor's spoken or typed answer to a prompt → drafted cards, and at most one
// follow-up when the answer leaves out a date, a contact or a threshold (F3.7, F6). Nothing is stored; publishing is
// POST /api/handover/publish.
import { z } from "zod";
import { haiku, sonnet } from "@/lib/ai";
import { DraftRequest, DraftResponse, SeatType } from "@/lib/contracts";
import { draftAnswer } from "@/lib/engine/draft";
import {
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
} from "@/lib/engine/route";

const PromptRow = z.object({
  text: z.string(),
  seats: z.object({ name: z.string(), seat_type: SeatType }),
});

// The day of the answer in Japan: a date said without a year takes this year.
function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

export async function POST(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = DraftRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");
  const { seat, promptId, answer, followup } = parsed.data;

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");

    // As the caller: RLS shows a prompt only to holders of its seat, and a demand prompt (a newcomer's question)
    // only to the predecessors it was routed to. Anything else looks like a missing prompt.
    const { data, error } = await caller.db
      .from("prompts")
      .select("text, seats!inner(name, seat_type)")
      .eq("id", promptId)
      .eq("seats.slug", seat)
      .maybeSingle();
    if (error) throw dbFailure(error);
    if (!data) return apiError("not_found");
    const prompt = PromptRow.parse(data);

    // A request with the follow-up's reply is the reply round: it never gets another follow-up.
    const drafted = await draftAnswer({
      models: { draft: sonnet, followup: haiku },
      question: prompt.text,
      answer,
      followup,
      seat: { name: prompt.seats.name, seatType: prompt.seats.seat_type },
      today: today(),
    });
    return Response.json(DraftResponse.parse(drafted));
  } catch (error) {
    // The code and the error's class only: a message can quote the answer, the prompt or the model's reply.
    return failed("POST /api/handover/draft", error);
  }
}
