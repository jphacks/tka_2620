// A seat's page (GET /api/seats/[slug]): the seat, the viewer's own terms there, and its lineage. Runs as the caller
// (lib/engine/route.ts), so the database decides (0003): seats, groups and institutions are readable by everyone,
// seat_holders returns only the caller's own rows, and seat_lineage() gives the terms without who held them. Opening
// the page joins nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SeatType, type SeatView, Uuid } from "@/lib/contracts";
import { ApiFailure, dbFailure } from "@/lib/engine/route";

// seats.settings holds only the flags a seat type turns on (scripts/seed.ts); the page gets every flag, off when unset.
const Flag = z.boolean().catch(false);
const Settings = z
  .object({
    noteExpiry: Flag,
    groupOwnsCriticalNotes: Flag,
    requiredPrompts: Flag,
  })
  .catch({
    noteExpiry: false,
    groupOwnsCriticalNotes: false,
    requiredPrompts: false,
  });

const SeatRow = z.object({
  id: Uuid,
  slug: z.string(),
  name: z.string(),
  seat_type: SeatType,
  settings: Settings,
  groups: z.object({
    name: z.string(),
    institutions: z.object({ name: z.string() }),
  }),
});

const Terms = z.array(
  z.object({ term_label: z.string(), term_order: z.number().int() }),
);

export async function seatViewAsCaller(
  client: SupabaseClient,
  slug: string,
): Promise<SeatView> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select(
      "id, slug, name, seat_type, settings, groups(name, institutions(name))",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.safeParse(seatRow);
  if (!seat.success) throw new ApiFailure("unavailable");

  // RLS returns the caller's own rows only; nobody else's term at this seat reaches the page.
  const [held, lineage] = await Promise.all([
    client
      .from("seat_holders")
      .select("term_label, term_order")
      .eq("seat_id", seat.data.id),
    client.rpc("seat_lineage", { seat: seat.data.id }),
  ]);
  if (held.error) throw dbFailure(held.error);
  if (lineage.error) throw dbFailure(lineage.error);
  const own = Terms.safeParse(held.data);
  const terms = Terms.safeParse(lineage.data);
  if (!own.success || !terms.success) throw new ApiFailure("unavailable");

  const latest = own.data.reduce<(typeof own.data)[number] | undefined>(
    (best, term) => (!best || term.term_order > best.term_order ? term : best),
    undefined,
  );
  const viewerTerms = new Set(own.data.map((term) => term.term_order));

  return {
    seat: {
      slug: seat.data.slug,
      name: seat.data.name,
      seatType: seat.data.seat_type,
      group: seat.data.groups.name,
      institution: seat.data.groups.institutions.name,
      settings: seat.data.settings,
    },
    viewer: latest
      ? { isHolder: true, termLabel: latest.term_label }
      : { isHolder: false },
    lineage: terms.data.map((term) => ({
      termLabel: term.term_label,
      termOrder: term.term_order,
      isViewer: viewerTerms.has(term.term_order),
    })),
    // The deadline list is F7, first on the cut list (docs/WORKFLOW.md → 7). The ask panel doesn't show it, so it
    // stays empty until F7 sets its rules (which deadlines, next occurrence).
    upcoming: [],
  };
}
