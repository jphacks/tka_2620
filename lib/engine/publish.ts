// POST /api/handover/publish (F3.8, and later F5 and F6): the predecessor publishes drafted cards as notes, and for a
// prompt, every question waiting on it is answered again from the new notes its asker may read, signed with the
// publisher's byline (docs/SPEC.md → F3).
//
// Everything runs as the caller (lib/engine/route.ts), so the database decides: the notes policy (0003) lets a holder
// publish only into a term they held, signed with that term; a 「更新する」 card replaces only a live note of the same
// seat and kind that the publisher may read, from their term or an earlier one, within the same insert (0010); a
// demand prompt is readable only by the predecessors it was routed to; waiting_questions() gives each waiting question
// the new notes its asker may read (the asker's rings, never the publisher's); deliver_answer() checks every citation
// again, writes the asker's answers row (Realtime brings it to them alone), marks the question answered and retires
// the prompt once nothing waits on it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createTranslator } from "next-intl";
import { z } from "zod";
import { sonnet } from "@/lib/ai";
import {
  IsoDate,
  Lang,
  LiveAnswer,
  NoteId,
  NoteKind,
  PromptKind,
  type PublishCard,
  PublishRequest,
  type PublishResponse,
  SeatType,
  Uuid,
} from "@/lib/contracts";
import { embed, noteText } from "@/lib/embed";
import { type Answer, answerFromNotes } from "@/lib/engine/answer";
import { blockReason } from "@/lib/engine/guard";
import type { FoundNote } from "@/lib/engine/retrieve";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
  logFailure,
} from "@/lib/engine/route";
import ja from "@/messages/ja.json";

// The models behind publishing, passed in so a test can fake them: bge-m3 for the notes, Sonnet for the answers.
export type PublishModels = {
  embed: (texts: string[]) => Promise<number[][]>;
  answer: () => LanguageModel;
};

const ROUTE = "POST /api/handover/publish";
// Provenance is the chip under an added note (「LINEグループ・2024年10月」): a few words, never a name or a contact.
const PROVENANCE_MAX = 80;

export async function handlePublish(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = PublishRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(
      await publishAsCaller(caller.db, caller.userId, parsed.data, {
        embed,
        answer: sonnet,
      }),
    );
  } catch (error) {
    // The code and the error's class only: never a card, a note or a question.
    return failed(ROUTE, error);
  }
}

// A stored byline is Japanese whatever the publisher's language, as scripts/seed.ts writes the seed's.
const labelPack = createTranslator({ locale: "ja", messages: ja });

const SeatRow = z.object({ id: Uuid, name: z.string(), seat_type: SeatType });
const TermRow = z.object({
  term_label: z.string(),
  term_order: z.number().int(),
});
const PromptRow = z.object({ id: Uuid, kind: PromptKind, text: z.string() });
// The inserted notes as the caller reads them back: enough to answer from, without trusting the input order.
const InsertedNotes = z.array(
  z.object({
    id: NoteId,
    seat_id: Uuid,
    term_order: z.number().int(),
    byline: z.string(),
    kind: NoteKind,
    title: z.string(),
    body: z.string(),
    deadline_date: IsoDate.nullable(),
    lang: Lang,
  }),
);
// waiting_questions()'s rows: a question waiting on the prompt, with the new notes its asker may read.
const WaitingRows = z.array(
  z.object({
    question_id: Uuid,
    lang: Lang,
    readable_note_ids: z.array(NoteId),
  }),
);

// The flow, as the publisher. Everything is checked before the first write, so a refused card, a stopped Ollama or a
// prompt the caller can't see saves nothing.
export async function publishAsCaller(
  client: SupabaseClient,
  userId: string,
  request: PublishRequest,
  models: PublishModels,
): Promise<PublishResponse> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id, name, seat_type")
    .eq("slug", request.seat)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.parse(seatRow);

  // The caller signs with their latest term at the seat; someone who never held it can't publish there.
  const { data: terms, error: termError } = await client
    .from("seat_holders")
    .select("term_label, term_order")
    .eq("seat_id", seat.id)
    .eq("user_id", userId)
    .order("term_order", { ascending: false })
    .limit(1);
  if (termError) throw dbFailure(termError);
  const term = TermRow.safeParse(terms?.[0]);
  if (!term.success) throw new ApiFailure("forbidden");

  let prompt: z.infer<typeof PromptRow> | undefined;
  if (request.promptId) {
    const { data, error } = await client
      .from("prompts")
      .select("id, kind, text")
      .eq("id", request.promptId)
      .eq("seat_id", seat.id)
      .maybeSingle();
    if (error) throw dbFailure(error);
    if (!data) throw new ApiFailure("not_found");
    prompt = PromptRow.parse(data);
  }

  // One note is updated by one card: the database would refuse the second, but the request is wrong as sent.
  const superseded = request.cards.flatMap((card) => card.supersedes ?? []);
  if (new Set(superseded).size !== superseded.length) {
    throw new ApiFailure("invalid_request");
  }
  for (const card of request.cards) {
    if ((card.provenance?.length ?? 0) > PROVENANCE_MAX) {
      throw new ApiFailure("invalid_request");
    }
    // Drafting only advises: the output guard runs again here, on everything a reader will see.
    const shown = [card.title, card.body, card.provenance ?? ""].join("\n");
    if (card.flags.secret || blockReason(shown)) {
      throw new ApiFailure("unredacted");
    }
  }

  const vectors = await models.embed(request.cards.map(noteText));
  if (vectors.length !== request.cards.length) {
    throw new ApiFailure("unavailable");
  }
  const byline = labelPack(`seatTypes.${seat.seat_type}.byline`, {
    term: term.data.term_label,
    seat: seat.name,
  });
  const { data: insertedRows, error: insertError } = await client
    .from("notes")
    .insert(
      request.cards.map((card, i) => ({
        seat_id: seat.id,
        term_order: term.data.term_order,
        author_user_id: userId,
        byline,
        kind: card.kind,
        title: card.title,
        body: card.body,
        deadline_date: card.deadline_date ?? null,
        lang: card.lang,
        scope: card.scope,
        critical: card.critical,
        valid_until: card.valid_until ?? null,
        source: sourceOf(card, prompt),
        provenance: card.provenance ?? null,
        embedding: JSON.stringify(vectors[i]),
        // Only on a 「更新する」 card, so publishing anything else never names the column. The trigger turns it into
        // the old note's superseded_by and stores nothing here (0010).
        ...(card.supersedes && { supersedes: card.supersedes }),
      })),
    )
    .select(
      "id, seat_id, term_order, byline, kind, title, body, deadline_date, lang",
    );
  if (insertError) throw dbFailure(insertError);
  const inserted = InsertedNotes.safeParse(insertedRows);
  if (!inserted.success || inserted.data.length !== request.cards.length) {
    throw new ApiFailure("unavailable");
  }

  const notes: FoundNote[] = inserted.data.map((note) => ({
    ...note,
    term_label: term.data.term_label,
    similarity: 1, // not found by a search: the publisher just wrote them for this prompt
  }));
  return {
    noteIds: notes.map((note) => note.id),
    reanswered: prompt
      ? await answerWaiting(client, prompt, notes, byline, seat.id, models)
      : [],
  };
}

// An added card says where it came from; otherwise a demand prompt is the live loop, and anything else the handover.
function sourceOf(
  card: PublishCard,
  prompt: z.infer<typeof PromptRow> | undefined,
): string {
  return card.source ?? (prompt?.kind === "demand" ? "live" : "handover");
}

// Every question waiting on the prompt, answered from the new notes its asker may read and signed with the publisher's
// byline; one model call per distinct set of readable notes. A question nothing answers, or whose answer fails, keeps
// waiting: the notes are published either way, so the request reports them and never needs repeating.
async function answerWaiting(
  client: SupabaseClient,
  prompt: z.infer<typeof PromptRow>,
  notes: FoundNote[],
  byline: string,
  seatId: string,
  models: PublishModels,
): Promise<string[]> {
  const { data, error } = await client.rpc("waiting_questions", {
    prompt: prompt.id,
    note_ids: notes.map((note) => note.id),
  });
  const waiting = WaitingRows.safeParse(data);
  if (error || !waiting.success) {
    logFailure(
      `${ROUTE}: waiting questions`,
      error ? dbFailure(error) : new ApiFailure("unavailable"),
    );
    return [];
  }

  const answers = new Map<string, Promise<Answer | undefined>>();
  const reanswered: string[] = [];
  for (const question of waiting.data) {
    const readable = notes.filter((note) =>
      question.readable_note_ids.includes(note.id),
    );
    if (readable.length === 0) continue;
    const key = readable
      .map((note) => note.id)
      .sort()
      .join(" ");
    try {
      let answer = answers.get(key);
      if (!answer) {
        answer = answerFromNotes({
          model: models.answer(),
          question: prompt.text,
          notes: readable,
          seatId,
        });
        answers.set(key, answer);
      }
      const found = await answer;
      if (!found) continue;
      const payload = LiveAnswer.parse({
        status: "answered",
        questionId: question.question_id,
        ...found,
        live: { byline },
      });
      const { error: deliverError } = await client.rpc("deliver_answer", {
        question: question.question_id,
        answer: payload,
      });
      if (deliverError) throw dbFailure(deliverError);
      reanswered.push(question.question_id);
    } catch (failure) {
      logFailure(`${ROUTE}: answering a waiting question`, failure);
    }
  }
  return reanswered;
}
