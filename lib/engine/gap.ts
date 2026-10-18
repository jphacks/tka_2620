// POST /api/handover/prompts (F5.7): 「先輩に聞く」 on the import review. What an added text leaves out (a missing item's
// prompt) becomes a gap prompt of the seat, which every holder of the seat reads among the handover prompts (F6), so
// the predecessors who know the answer see it (docs/SPEC.md → adding knowledge). The same open text again is the same
// prompt. Nothing is logged but a code.
//
// Everything runs as the caller (lib/engine/route.ts): the seat is read as they see it, and add_gap_prompt() (0009)
// writes the prompt for a holder of the seat only. Every holder reads the text, so before anything is written it gets
// the guard an imported card gets (lib/engine/extract-notes.ts) and the safety net's canaries: a name, contact details,
// a secret, a placeholder or a canary is refused (unredacted), never repaired.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GapRequest, GapResponse, Uuid } from "@/lib/contracts";
import { shownReason } from "@/lib/engine/extract-notes";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
} from "@/lib/engine/route";
import { canaryCount, seedCanaries } from "@/lib/engine/safety-net";

const ROUTE = "POST /api/handover/prompts";

// The canaries the guard looks for, passed in so a test can set its own.
export type GapDeps = { canaries: readonly string[] };

export async function handleGap(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = GapRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(
      await gapAsCaller(caller.db, parsed.data, { canaries: seedCanaries() }),
    );
  } catch (error) {
    // The code and the error's class only: a message can quote the prompt.
    return failed(ROUTE, error);
  }
}

const SeatRow = z.object({ id: Uuid });

export async function gapAsCaller(
  client: SupabaseClient,
  request: GapRequest,
  deps: GapDeps,
): Promise<GapResponse> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id")
    .eq("slug", request.seat)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.parse(seatRow);

  // The text as the seat's holders would read it: checked before the call, so a refused text is never sent on.
  if (
    canaryCount(request.text, deps.canaries) > 0 ||
    shownReason(request.text)
  ) {
    throw new ApiFailure("unredacted");
  }

  // A holder of the seat only (42501, forbidden otherwise); the open gap prompt with the same text, or a new one.
  const { data, error } = await client.rpc("add_gap_prompt", {
    seat: seat.id,
    prompt_text: request.text,
  });
  if (error) throw dbFailure(error);
  const promptId = Uuid.safeParse(data);
  if (!promptId.success) throw new ApiFailure("unavailable");
  return GapResponse.parse({ promptId: promptId.data });
}
