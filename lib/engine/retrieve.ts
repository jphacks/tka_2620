// F2.1: the notes an answer may use (docs/SPEC.md → F2). The question is embedded with bge-m3 and searched with
// search_notes (0004) as the asker, so the notes policy decides what can be found at all; this file only decides
// what is close enough to answer from. Nothing here logs or throws text: errors carry a code only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { IsoDate, Lang, NoteKind } from "@/lib/contracts";
import { embed } from "@/lib/embed";

// Cosine similarity, measured with bge-m3 on seed/questions.csv against title-and-body embeddings (lib/embed.ts).
// One threshold can't do it: q01's 2025 deadline note scores 0.589, but q04's closest note, about receipts without
// answering it, scores 0.626. So a question finds notes only when its best note is a clear match, and then notes
// on the same topic come along, so the other year's deadline reaches the answer and the rule-change flag (F2.3).
//   best note, must reach MATCH:  q01 0.771, q02 0.723, q05 0.709; q04 after the live loop's card 0.743
//   best note, must not:          q04 0.626 (reworded up to 0.635), q06 0.374
//   along with it, must reach RELATED: q01's 2025 note 0.589; the next unrelated note in an answered question 0.48
// A Japanese sentence and its English translation score 0.72–0.77, so an English question over Japanese notes stays
// under MATCH (q01 in English: 0.56) and abstains.
export const MATCH = 0.66;
export const RELATED = 0.5;
// More notes than a seat holds on one topic; the ranking is exact (0004), so k only bounds what reaches the model.
export const SEARCH_K = 8;

// A row of search_notes. Bodies are untrusted: F2.2 wraps them in <note> tags.
export const FoundNote = z.object({
  id: z.string(),
  seat_id: z.string(),
  term_order: z.number().int(),
  term_label: z.string(),
  byline: z.string(),
  kind: NoteKind,
  title: z.string(),
  body: z.string(),
  deadline_date: IsoDate.nullable(),
  lang: Lang,
  similarity: z.number(),
});
export type FoundNote = z.infer<typeof FoundNote>;

// The notes this asker may read that are close enough to answer the question from, best first; none means abstain.
// `client` must act as the asker (a route's caller client), never as the service role.
export async function findNotes(
  client: SupabaseClient,
  seat: string,
  question: string,
  embedTexts: (texts: string[]) => Promise<number[][]> = embed,
): Promise<FoundNote[]> {
  const [vector] = await embedTexts([question]);
  const { data, error } = await client.rpc("search_notes", {
    seat,
    query_embedding: JSON.stringify(vector),
    k: SEARCH_K,
  });
  if (error) throw new Error(`search_notes failed: ${error.code}`);
  return closeEnough(z.array(FoundNote).parse(data ?? []));
}

// The cut, apart from the search so it can be tested offline. No notes at all is -Infinity, under MATCH.
export function closeEnough(notes: FoundNote[]): FoundNote[] {
  const best = Math.max(...notes.map((note) => note.similarity));
  if (best < MATCH) return [];
  return notes
    .filter((note) => note.similarity >= RELATED)
    .sort((a, b) => b.similarity - a.similarity);
}
