// The caller's own questions at a seat and their answers (GET /api/seats/[slug]/asked): what 聞く lists after a reload
// or once the tab was closed, so "your question was answered" (docs/SPEC.md → One interface) outlasts the Realtime row
// that brought it. The handover guide (lib/engine/guide.ts) lists the same questions through ownQuestions() and
// withAnswers(). Runs as the caller (lib/engine/route.ts), so the database decides (0003): questions and answers give
// the asker's own rows only, the notes policy the cited notes they may read now, and seat_lineage() a seat's terms
// without who held them. Reads only, with no embedding (no Ollama), and nothing is logged but a code: the list holds
// the caller's own questions as typed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AnsweredResult,
  type AskedView,
  type Citation,
  type GuideAsked,
  Lang,
  NoteId,
  Timestamp,
  Uuid,
} from "@/lib/contracts";
import { tokyoToday } from "@/lib/engine/notes";
import { ApiFailure, dbFailure } from "@/lib/engine/route";

const ASKED = 20; // the caller's latest questions at the seat

const SeatRow = z.object({ id: Uuid });

export const QuestionRows = z.array(
  z.object({
    id: Uuid,
    text: z.string(),
    lang: Lang,
    status: z.enum(["answered", "waiting"]),
    created_at: Timestamp,
  }),
);
export type QuestionRow = z.infer<typeof QuestionRows>[number];

const AnswerRows = z.array(
  z.object({ question_id: Uuid, payload: z.unknown() }),
);
// A cited note as the caller reads it now: its byline, and its seat and term, which the seat's lineage labels.
const CitedRows = z.array(
  z.object({
    id: NoteId,
    byline: z.string(),
    seat_id: Uuid,
    term_order: z.number().int(),
  }),
);
const Terms = z.array(
  z.object({ term_label: z.string(), term_order: z.number().int() }),
);

// What a citation says about its note, from the database rather than from the saved answer.
type Stamp = Omit<Citation, "noteId">;

export async function askedAsCaller(
  client: SupabaseClient,
  slug: string,
  today: string = tokyoToday(),
): Promise<AskedView> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.safeParse(seatRow);
  if (!seat.success) throw new ApiFailure("unavailable");

  const { data, error } = await ownQuestions(client, seat.data.id);
  if (error) throw dbFailure(error);
  const own = QuestionRows.safeParse(data ?? []);
  if (!own.success) throw new ApiFailure("unavailable");
  return { asked: await withAnswers(client, own.data, today) };
}

// The caller's latest questions at the seat, newest first, read with QuestionRows: the questions policy returns the
// asker's own rows only, so nobody else's question comes back.
export function ownQuestions(client: SupabaseClient, seatId: string) {
  return client
    .from("questions")
    .select("id, text, lang, status, created_at")
    .eq("seat_id", seatId)
    .order("created_at", { ascending: false })
    .limit(ASKED);
}

// The caller's questions, in the order given, each with its saved answer as the caller may read it now (standing()). A
// waiting question has none yet, and neither has one whose saved payload isn't an answer (an abstain).
export async function withAnswers(
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
  const stamps = await citedStamps(client, [...cited], today);
  return questions.map((question): GuideAsked => {
    const stored = saved.get(question.id);
    const answer = stored && standing(stored, question.id, stamps);
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
// caller may not read comes back as no row, the same as one that is gone. Each stamp is the note's as it is now: its
// byline, and its term as its seat's lineage labels it (the term's number when the lineage has none), as search_notes
// labels the notes an answer cites. One seat_lineage() call per seat the notes come from.
async function citedStamps(
  client: SupabaseClient,
  ids: string[],
  today: string,
): Promise<Map<string, Stamp>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("notes")
    .select("id, byline, seat_id, term_order")
    .in("id", ids)
    .eq("status", "live")
    .is("superseded_by", null)
    .or(`valid_until.is.null,valid_until.gte.${today}`);
  if (error) throw dbFailure(error);
  const rows = CitedRows.safeParse(data ?? []);
  if (!rows.success) throw new ApiFailure("unavailable");
  const seats = [...new Set(rows.data.map((row) => row.seat_id))];
  const lineages = new Map(
    await Promise.all(
      seats.map(async (seat) => [seat, await lineageOf(client, seat)] as const),
    ),
  );
  return new Map(
    rows.data.map((row): [string, Stamp] => {
      // The first label of the term, oldest first, as search_notes takes it.
      const term = lineages
        .get(row.seat_id)
        ?.find((entry) => entry.term_order === row.term_order);
      return [
        row.id,
        {
          byline: row.byline,
          termLabel: term?.term_label ?? String(row.term_order),
        },
      ];
    }),
  );
}

// A seat's terms, oldest first: seat_lineage() (0003) gives them to anyone, never who held them.
async function lineageOf(
  client: SupabaseClient,
  seat: string,
): Promise<z.infer<typeof Terms>> {
  const { data, error } = await client.rpc("seat_lineage", { seat });
  if (error) throw dbFailure(error);
  const terms = Terms.safeParse(data ?? []);
  if (!terms.success) throw new ApiFailure("unavailable");
  return terms.data;
}

// A saved answer as the caller may read it now. The payload is the asker's own row, which they can write themselves
// (0003), so only its words are taken as written: the question id is the row's, a sentence stays only while every note
// it cites came back from citedStamps(), and each citation carries that note's byline and term label as they are now.
// Once a sentence goes, so does the rule change, which may rest on it (as the answers trigger does, 0006); `live`
// always goes, since this isn't the moment the answer arrived. With no sentence left there is no answer, and the
// question reads as unanswered.
function standing(
  answer: AnsweredResult,
  questionId: string,
  stamps: Map<string, Stamp>,
): AnsweredResult | undefined {
  const sentences = answer.sentences.flatMap((sentence) => {
    const citations = sentence.citations.flatMap((citation) => {
      const stamp = stamps.get(citation.noteId);
      return stamp === undefined ? [] : [{ noteId: citation.noteId, ...stamp }];
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
