// POST /api/handover/draft: a predecessor's spoken or typed answer to a prompt → drafted cards (F3.7, F6).
// Nothing is stored; publishing is POST /api/handover/publish.
import { z } from "zod";
import { sonnet } from "@/lib/ai";
import { DraftRequest, DraftResponse, SeatType } from "@/lib/contracts";
import { draftCards } from "@/lib/engine/draft";
import { apiError, callerClient } from "@/lib/engine/route";

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
  try {
    const db = await callerClient(request);
    if (!db) return apiError("unauthorized");
    const parsed = DraftRequest.safeParse(
      await request.json().catch(() => undefined),
    );
    if (!parsed.success) return apiError("invalid_request");
    const { seat, promptId, answer } = parsed.data;

    // As the caller: RLS shows a prompt only to holders of its seat, and a demand prompt (a newcomer's question)
    // only to the predecessors it was routed to. Anything else looks like a missing prompt.
    const { data, error } = await db
      .from("prompts")
      .select("text, seats!inner(name, seat_type)")
      .eq("id", promptId)
      .eq("seats.slug", seat)
      .maybeSingle();
    if (error) throw error;
    if (!data) return apiError("not_found");
    const prompt = PromptRow.parse(data);

    const cards = await draftCards({
      model: sonnet(),
      question: prompt.text,
      answer,
      seat: { name: prompt.seats.name, seatType: prompt.seats.seat_type },
      today: today(),
    });
    return Response.json(DraftResponse.parse({ cards }));
  } catch (error) {
    // The error's name only: its message can quote the answer, the prompt or the model's reply.
    console.error(
      `POST /api/handover/draft failed: ${error instanceof Error ? error.name : typeof error}`,
    );
    return apiError("unavailable");
  }
}
