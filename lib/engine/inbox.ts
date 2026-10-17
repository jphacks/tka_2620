// The predecessor's inbox (F3.6): GET /api/inbox?seat= and POST /api/inbox/seen. Both run as the caller
// (lib/engine/route.ts), so the database decides what they reach: inbox() (0003) returns only the open demand prompts
// routed to the caller, with the first asker's term at the seat and never who asked, and the recipient may set
// nothing but seen_at, on their own prompt_routes rows.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type InboxResponse,
  Lang,
  SeatType,
  SeenResponse,
  Timestamp,
  Uuid,
} from "@/lib/contracts";
import { ApiFailure, dbFailure } from "@/lib/engine/route";

// The seat type's byline from the label pack (messages/*.json → seatTypes.<type>.byline): 「2026年度 会計」.
export type Byline = (seatType: SeatType, term: string, seat: string) => string;

const SeatRow = z.object({ id: Uuid, name: z.string(), seat_type: SeatType });

// inbox()'s rows, oldest first. asked_by_term is the first asker's latest term at the seat.
const InboxRows = z.array(
  z.object({
    prompt_id: Uuid,
    question: z.string(),
    ask_count: z.number().int().positive(),
    asked_at: Timestamp,
    lang: Lang,
    asked_by_term: z.string().nullable(),
  }),
);

export async function inboxAsCaller(
  client: SupabaseClient,
  slug: string,
  byline: Byline,
): Promise<InboxResponse> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id, name, seat_type")
    .eq("slug", slug)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.safeParse(seatRow);
  if (!seat.success) throw new ApiFailure("unavailable");

  const { data, error } = await client.rpc("inbox", { seat: seat.data.id });
  if (error) throw dbFailure(error);
  const rows = InboxRows.safeParse(data);
  if (!rows.success) throw new ApiFailure("unavailable");

  const { name, seat_type: seatType } = seat.data;
  return {
    items: rows.data.map((row) => ({
      promptId: row.prompt_id,
      question: row.question,
      // Only holders' questions are routed, so the term is there; the seat name stands in if it ever isn't.
      askedBy: row.asked_by_term
        ? byline(seatType, row.asked_by_term, name)
        : name,
      askCount: row.ask_count,
      askedAt: row.asked_at,
      lang: row.lang,
    })),
  };
}

// The predecessor opened a slip: prompt_routes.seen_at, set once. Opening it again answers the first time; a prompt
// that wasn't routed to the caller isn't found.
export async function markSeen(
  client: SupabaseClient,
  userId: string,
  promptId: string,
): Promise<SeenResponse> {
  const { data: opened, error } = await client
    .from("prompt_routes")
    .update({ seen_at: new Date().toISOString() })
    .eq("prompt_id", promptId)
    .eq("user_id", userId)
    .is("seen_at", null)
    .select("seen_at");
  if (error) throw dbFailure(error);

  let seenAt: unknown = opened?.[0]?.seen_at;
  if (!seenAt) {
    const { data: route, error: readError } = await client
      .from("prompt_routes")
      .select("seen_at")
      .eq("prompt_id", promptId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw dbFailure(readError);
    seenAt = route?.seen_at;
  }
  if (!seenAt) throw new ApiFailure("not_found");
  const seen = SeenResponse.safeParse({ seenAt });
  if (!seen.success) throw new ApiFailure("unavailable");
  return seen.data;
}
