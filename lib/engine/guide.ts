// The handover guide (引き継ぎ書, GET /api/seats/[slug]/guide): what the caller may read at a seat, on one page they can
// print or export. Runs as the caller (lib/engine/route.ts), so the database decides everything here (0002, 0003): the
// notes policy returns only the notes they may read, seat_holders only their own rows, the prompts policy the seat's
// handover prompts to its holders alone, and questions and answers only the asker's own. The caller's questions and
// their answers come from lib/engine/asked.ts, as GET /api/seats/[slug]/asked lists them. Reads only, and nothing is
// logged but a code: the page holds note bodies, prompts and the caller's own questions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type GuideNote,
  type GuideOpen,
  type GuideView,
  IsoDate,
  Lang,
  NoteId,
  NoteKind,
  PromptKind,
  Uuid,
} from "@/lib/contracts";
import { ownQuestions, QuestionRows, withAnswers } from "@/lib/engine/asked";
import { tokyoToday } from "@/lib/engine/notes";
import { answeredPrompts, byRank, coveredByNotes } from "@/lib/engine/prompts";
import { ApiFailure, dbFailure, logFailure } from "@/lib/engine/route";

const ROUTE = "GET /api/seats/[slug]/guide";
// The seat's open gap, required and core prompts read at most, as GET /api/handover/prompts reads them.
const OPEN_PROMPTS = 100;

export type GuideDeps = {
  embed: (texts: string[]) => Promise<number[][]>;
  today?: string; // Tokyo's date, YYYY-MM-DD: a note past its valid_until is left out
};

const SeatRow = z.object({ id: Uuid });

// The note as the page shows it, signed by seat and term: never its author, scope, provenance or embedding.
const NoteRow = z.object({
  id: NoteId,
  kind: NoteKind,
  title: z.string(),
  body: z.string(),
  deadline_date: IsoDate.nullable(),
  term_order: z.number().int(),
  byline: z.string(),
  lang: Lang,
});

const HeldRows = z.array(z.object({ term_order: z.number().int() }));

const PromptRows = z.array(
  z.object({
    id: Uuid,
    kind: PromptKind.exclude(["demand"]),
    text: z.string(),
    seq: z.number().int(),
  }),
);

const KINDS = NoteKind.options; // deadline, contact, rule_of_thumb, pitfall, unwritten_rule

export async function guideAsCaller(
  client: SupabaseClient,
  slug: string,
  deps: GuideDeps,
): Promise<GuideView> {
  const today = deps.today ?? tokyoToday();
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.safeParse(seatRow);
  if (!seat.success) throw new ApiFailure("unavailable");
  const seatId = seat.data.id;

  // One read per table at once. The notes filters leave out a note that isn't live (an author still reads their own
  // withdrawn ones), one a later note replaced (「更新する」, 0010) and one past its valid_until on Tokyo's date, as
  // search_notes (0004) leaves them out of answers. seat_holders and questions give the caller's own rows only.
  const [notes, held, questions] = await Promise.all([
    client
      .from("notes")
      .select("id, kind, title, body, deadline_date, term_order, byline, lang")
      .eq("seat_id", seatId)
      .eq("status", "live")
      .is("superseded_by", null)
      .or(`valid_until.is.null,valid_until.gte.${today}`),
    client
      .from("seat_holders")
      .select("term_order")
      .eq("seat_id", seatId)
      .limit(1),
    ownQuestions(client, seatId),
  ]);
  if (notes.error) throw dbFailure(notes.error);
  if (held.error) throw dbFailure(held.error);
  if (questions.error) throw dbFailure(questions.error);
  const rows = z.array(z.unknown()).safeParse(notes.data);
  const holds = HeldRows.safeParse(held.data ?? []);
  const own = QuestionRows.safeParse(questions.data ?? []);
  if (!rows.success || !holds.success || !own.success) {
    throw new ApiFailure("unavailable");
  }

  const open =
    holds.data.length > 0
      ? await notWrittenYet(client, { id: seatId, slug }, today, deps.embed)
      : { open: [], openChecked: true };
  return {
    notes: guideNotes(rows.data),
    ...open,
    asked: await withAnswers(client, own.data, today),
  };
}

// Each row on its own: one that doesn't read (a holder can insert straight through PostgREST, e.g. a deadline in the
// year 10000) drops out, and the page still opens. Newest term first, then by kind as NoteKind lists them, then by id in
// code-point order, so the page reads the same wherever the server runs.
function guideNotes(rows: unknown[]): GuideNote[] {
  return rows
    .flatMap((row) => {
      const note = NoteRow.safeParse(row);
      return note.success ? [note.data] : [];
    })
    .sort(
      (a, b) =>
        b.term_order - a.term_order ||
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map(({ deadline_date, term_order, ...note }) => ({
      ...note,
      ...(deadline_date && { deadlineDate: deadline_date }),
      termOrder: term_order,
    }));
}

// What isn't written yet, for a holder of the seat (the prompts policy gives nobody else any): its open gap, required
// and core prompts, never a demand prompt, whose text can be a newcomer's question as typed. A prompt goes when a live
// note the caller reads names it (notes.prompt_id, 0011) or covers it (coveredByNotes(), the handover's own check), from
// any term: the guide lists what nobody has written, not what this holder is still to be asked. Each text once, the
// first in rank order (gap, required, core, then seq). A failed check (Ollama stopped, a failed search) is logged by its
// code and lists nothing, with openChecked false, so the page says it couldn't check rather than that all is written.
async function notWrittenYet(
  client: SupabaseClient,
  seat: { id: string; slug: string },
  today: string,
  embed: GuideDeps["embed"],
): Promise<Pick<GuideView, "open" | "openChecked">> {
  const { data, error } = await client
    .from("prompts")
    .select("id, kind, text, seq")
    .eq("seat_id", seat.id)
    .eq("retired", false)
    .in("kind", ["gap", "required", "core"])
    .order("seq")
    .limit(OPEN_PROMPTS);
  if (error) throw dbFailure(error);
  const rows = PromptRows.safeParse(data ?? []);
  if (!rows.success) throw new ApiFailure("unavailable");
  const named = await answeredPrompts(client, {
    seatId: seat.id,
    promptIds: rows.data.map((row) => row.id),
    today,
  });
  const texts = new Set<string>();
  const unnamed = rows.data
    .filter((row) => !named.has(row.id))
    .toSorted(byRank)
    .filter((row) => {
      if (texts.has(row.text)) return false;
      texts.add(row.text);
      return true;
    });
  if (unnamed.length === 0) return { open: [], openChecked: true };

  const covered = await coveredByNotes(client, {
    seat,
    prompts: unnamed,
    embed,
  }).catch((error: unknown) => {
    logFailure(`${ROUTE}: covered topics`, error);
    return undefined;
  });
  if (!covered) return { open: [], openChecked: false };
  return {
    open: unnamed
      .filter((_, i) => !covered[i])
      .map(
        (row): GuideOpen => ({ id: row.id, text: row.text, reason: row.kind }),
      ),
    openChecked: true,
  };
}
