// A seat's page (GET /api/seats/[slug]): the seat, the viewer's own terms there, its lineage and the deadlines coming
// up. Runs as the caller (lib/engine/route.ts), so the database decides (0003): seats, groups and institutions are
// readable by everyone, seat_holders returns only the caller's own rows, seat_lineage() gives the terms without who
// held them, and the notes policy returns only the deadline notes the caller may read. Opening the page joins
// nothing: everything here is a read.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  IsoDate,
  Lang,
  NoteId,
  SeatType,
  type SeatView,
  Uuid,
} from "@/lib/contracts";
import { tokyoToday } from "@/lib/engine/notes";
import { ApiFailure, dbFailure } from "@/lib/engine/route";
import { SIMILAR } from "@/lib/engine/similar";

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

// pgvector comes back from PostgREST as text ("[0.01,-0.02,…]"). A note without an embedding, or with one that doesn't
// read as numbers, matches no other note.
const Vector = z
  .string()
  .nullable()
  .transform((text) => {
    if (!text) return null;
    try {
      const numbers = z.array(z.number()).safeParse(JSON.parse(text));
      return numbers.success ? numbers.data : null;
    } catch {
      return null;
    }
  });

const DeadlineNote = z.object({
  id: NoteId,
  title: z.string(),
  deadline_date: IsoDate,
  term_order: z.number().int(),
  byline: z.string(),
  lang: Lang,
  superseded_by: NoteId.nullable(),
  embedding: Vector,
});
export type DeadlineNote = z.infer<typeof DeadlineNote>;

export async function seatViewAsCaller(
  client: SupabaseClient,
  slug: string,
  today: string = tokyoToday(),
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

  // RLS returns the caller's own rows only; nobody else's term at this seat reaches the page. Of the notes, the policy
  // returns the ones the caller may read, and the filters leave out a note that isn't live (an author still reads
  // their own withdrawn ones) and one past its valid_until on Tokyo's date, as search_notes (0004) does. A note that a
  // later one replaced (0010) comes along as history for upcomingDeadlines(). The embeddings serve it only and stay
  // here.
  const [held, lineage, deadlines] = await Promise.all([
    client
      .from("seat_holders")
      .select("term_label, term_order")
      .eq("seat_id", seat.data.id),
    client.rpc("seat_lineage", { seat: seat.data.id }),
    client
      .from("notes")
      .select(
        "id, title, deadline_date, term_order, byline, lang, superseded_by, embedding",
      )
      .eq("seat_id", seat.data.id)
      .eq("kind", "deadline")
      .eq("status", "live")
      .or(`valid_until.is.null,valid_until.gte.${today}`),
  ]);
  if (held.error) throw dbFailure(held.error);
  if (lineage.error) throw dbFailure(lineage.error);
  if (deadlines.error) throw dbFailure(deadlines.error);
  const own = Terms.safeParse(held.data);
  const terms = Terms.safeParse(lineage.data);
  const rows = z.array(z.unknown()).safeParse(deadlines.data);
  if (!own.success || !terms.success || !rows.success) {
    throw new ApiFailure("unavailable");
  }
  // A row that doesn't read (a holder can insert straight through PostgREST, e.g. a deadline in the year 10000) drops
  // out on its own: it shows nothing and hides nothing, and the page still opens for everyone else.
  const notes = rows.data.flatMap((row) => {
    const note = DeadlineNote.safeParse(row);
    return note.success ? [note.data] : [];
  });

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
    upcoming: upcomingDeadlines(notes, today),
  };
}

// The deadlines coming up, soonest first. A deadline comes back every year and each holder writes it down again in
// their own words, so a note gives way to a later term's note that says the same: bge-m3 similarity of at least
// SIMILAR, the line at which 「更新する」 offers to update a note (lib/engine/similar.ts). 2025's 10/20 stands and 2024's
// 10/27 doesn't (0.72 between them). Only notes the caller reads take part, so a note they can't read never hides one
// they can, and notes of the same term all stay. A note that a later one replaced (「更新する」, 0010) shows no more but
// still stands for the terms before it: once 2026's notice replaced the 2025 note, a25, who can't read the notice,
// doesn't get 2024's 10/27 back. Each shows at its next occurrence: a predecessor's 2025-10-20 as 2026-10-20.
export function upcomingDeadlines(
  notes: DeadlineNote[],
  today: string,
): SeatView["upcoming"] {
  return notes
    .filter(
      (note) =>
        note.superseded_by === null &&
        !notes.some(
          (later) =>
            later.term_order > note.term_order && sameDeadline(note, later),
        ),
    )
    .map((note) => ({ note, date: nextOccurrence(note.deadline_date, today) }))
    .sort(
      (a, b) =>
        compare(a.date, b.date) ||
        b.note.term_order - a.note.term_order ||
        compare(a.note.id, b.note.id),
    )
    .map(({ note, date }) => ({
      noteId: note.id,
      title: note.title,
      date,
      byline: note.byline,
      lang: note.lang,
    }));
}

// A deadline's next occurrence on or after today (both YYYY-MM-DD, Tokyo's date): the date itself while it is still
// ahead, otherwise its month and day this year, or next year once that day has passed. 29 February falls on the 28th
// in a common year.
export function nextOccurrence(date: string, today: string): string {
  if (date >= today) return date;
  const [, month, day] = date.split("-");
  const year = Number(today.slice(0, 4));
  const thisYear = onDay(year, month, day);
  return thisYear >= today ? thisYear : onDay(year + 1, month, day);
}

function onDay(year: number, month: string, day: string): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${year}-${month}-${month === "02" && day === "29" && !leap ? "28" : day}`;
}

function sameDeadline(a: DeadlineNote, b: DeadlineNote): boolean {
  return (
    a.embedding !== null &&
    b.embedding !== null &&
    cosine(a.embedding, b.embedding) >= SIMILAR
  );
}

// Cosine similarity, as 1 - <=> gives it in the database; vectors of different lengths, or a zero vector, match nothing.
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}

// Code-point order, so the list reads the same wherever the server runs.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
