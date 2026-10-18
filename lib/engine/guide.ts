// The handover guide (引き継ぎ書, GET /api/seats/[slug]/guide): what the caller may read at a seat, on one page they can
// print or export. Runs as the caller (lib/engine/route.ts), so the database decides everything here (0002, 0003): the
// notes policy returns only the notes they may read, seat_holders only their own rows, the prompts policy the seat's
// handover prompts to its holders alone, and questions and answers only the asker's own. Reads only, and nothing is
// logged but a code: the page holds note bodies, prompts and the caller's own questions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AnsweredResult,
  type GuideAsked,
  type GuideNote,
  type GuideOpen,
  type GuideView,
  IsoDate,
  Lang,
  NoteId,
  NoteKind,
  PromptKind,
  Timestamp,
  Uuid,
} from "@/lib/contracts";
import { tokyoToday } from "@/lib/engine/notes";
import { answeredPrompts, byRank, coveredByNotes } from "@/lib/engine/prompts";
import { ApiFailure, dbFailure, logFailure } from "@/lib/engine/route";

const ROUTE = "GET /api/seats/[slug]/guide";
// The seat's open gap, required and core prompts read at most, as GET /api/handover/prompts reads them.
const OPEN_PROMPTS = 100;
const ASKED = 20; // the caller's latest questions at the seat

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

const QuestionRows = z.array(
  z.object({
    id: Uuid,
    text: z.string(),
    lang: Lang,
    status: z.enum(["answered", "waiting"]),
    created_at: Timestamp,
  }),
);
type QuestionRow = z.infer<typeof QuestionRows>[number];

const AnswerRows = z.array(
  z.object({ question_id: Uuid, payload: z.unknown() }),
);
const BylineRows = z.array(z.object({ id: NoteId, byline: z.string() }));

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
    client
      .from("questions")
      .select("id, text, lang, status, created_at")
      .eq("seat_id", seatId)
      .order("created_at", { ascending: false })
      .limit(ASKED),
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

// The caller's own questions at the seat, newest first, each with its saved answer as the caller may read it now
// (standing()). A waiting question has none yet, and neither has one whose saved payload isn't an answer (an abstain).
async function withAnswers(
  client: SupabaseClient,
  questions: QuestionRow[],
  today: string,
): Promise<GuideAsked[]> {
  const answeredIds = questions
    .filter((question) => question.status === "answered")
    .map((question) => question.id);
  const saved = new Map<string, AnsweredResult>();
  if (answeredIds.length > 0) {
    const { data, error } = await client
      .from("answers")
      .select("question_id, payload")
      .in("question_id", answeredIds);
    if (error) throw dbFailure(error);
    const rows = AnswerRows.safeParse(data ?? []);
    if (!rows.success) throw new ApiFailure("unavailable");
    for (const row of rows.data) {
      const answer = AnsweredResult.safeParse(row.payload);
      if (answer.success) saved.set(row.question_id, answer.data);
    }
  }

  const cited = new Set(
    [...saved.values()].flatMap((answer) =>
      answer.sentences.flatMap((sentence) =>
        sentence.citations.map((citation) => citation.noteId),
      ),
    ),
  );
  const bylines = await citedBylines(client, [...cited], today);
  return questions.map((question): GuideAsked => {
    const stored = saved.get(question.id);
    const answer = stored && standing(stored, question.id, bylines);
    return {
      questionId: question.id,
      text: question.text,
      lang: question.lang,
      askedAt: question.created_at,
      ...(answer && { answer }),
    };
  });
}

// The cited notes the caller reads now, of any seat (an answer may cite an institution-wide note of another seat), in
// one query: live, not replaced and not past valid_until, as search_notes (0004) finds notes for answers. A note the
// caller may not read comes back as no row, the same as one that is gone.
async function citedBylines(
  client: SupabaseClient,
  ids: string[],
  today: string,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("notes")
    .select("id, byline")
    .in("id", ids)
    .eq("status", "live")
    .is("superseded_by", null)
    .or(`valid_until.is.null,valid_until.gte.${today}`);
  if (error) throw dbFailure(error);
  const rows = BylineRows.safeParse(data ?? []);
  if (!rows.success) throw new ApiFailure("unavailable");
  return new Map(rows.data.map((row) => [row.id, row.byline]));
}

// A saved answer as the guide shows it. The payload is the asker's own row, which they can write themselves (0003), so
// only its words are taken as written: the question id is the row's, a sentence stays only while every note it cites
// came back from citedBylines(), and each citation carries that note's byline as it is now. Once a sentence goes, so
// does the rule change, which may rest on it (as the answers trigger does, 0006); `live` always goes, since the guide
// isn't the moment the answer arrived. With no sentence left there is no answer, and the question reads as unanswered.
function standing(
  answer: AnsweredResult,
  questionId: string,
  bylines: Map<string, string>,
): AnsweredResult | undefined {
  const sentences = answer.sentences.flatMap((sentence) => {
    const citations = sentence.citations.flatMap((citation) => {
      const byline = bylines.get(citation.noteId);
      return byline === undefined ? [] : [{ ...citation, byline }];
    });
    return citations.length === sentence.citations.length
      ? [{ ...sentence, citations }]
      : [];
  });
  if (sentences.length === 0) return undefined;
  const { live: _live, ruleChange, ...rest } = answer;
  const whole = sentences.length === answer.sentences.length;
  return {
    ...rest,
    questionId,
    sentences,
    ...(ruleChange && whole && { ruleChange }),
  };
}
