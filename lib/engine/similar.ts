// Similar notes (F5.6, docs/SPEC.md → F5 step 9) for POST /api/import: each drafted card is compared with the seat's
// live notes, and a close one of the same kind is offered with 「更新する」 (publishing the card with supersedes replaces
// it, 0010) or 「別のメモとして残す」. search_notes (0004) runs as the importer, so the notes policy decides which notes
// can match at all; this file only decides which one a card would update. Errors carry a code only, never a card.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type ImportedCard, type ImportResponse, Scope } from "@/lib/contracts";
import { noteText } from "@/lib/embed";
import { FoundNote } from "@/lib/engine/retrieve";
import { ApiFailure, dbFailure } from "@/lib/engine/route";

// Cosine similarity, measured with bge-m3 (title and body, lib/embed.ts) between the cards Sonnet drafted from the seed
// samples (8 runs of seed/notice-2026.sample.pdf, 2 to 3 of the others) and the seed notes:
//   must reach: the notice's deadline card vs smash-2025-hokenjo 0.732–0.772 (vs smash-2024-hokenjo 0.779–0.808);
//               the old handover's and the chat's receipts card vs smash-2025-ryoshusho 0.796–0.894
//   must not:   every other card vs a note of its kind, at most 0.59 at the seat and 0.61 at another seat
// The spec's first guess, 0.88, matched none of them. A wrong match costs the author one tap on 「別のメモとして残す」, a
// missed one leaves last year's note beside the new one, so the line sits a little under the middle.
export const SIMILAR = 0.68;
// More notes of one kind near one card than a seat holds; the ranking is exact (0004), so k only bounds the reply.
const SEARCH_K = 20;

export type Duplicate = ImportResponse["duplicates"][number];

export type SimilarInput = {
  seat: { id: string; slug: string };
  term: number; // the importer's latest term at the seat, which a publish signs with
  cards: ImportedCard[];
  embed: (texts: string[]) => Promise<number[][]>;
};

// The note each card would update, at most one per card, with its scope: 「更新する」 publishes at that scope or wider
// (0010). `client` must act as the importer (a route's caller client), never as the service role; the notes policy
// lets them read the scope of a note they can find.
export async function similarNotes(
  client: SupabaseClient,
  input: SimilarInput,
): Promise<Duplicate[]> {
  if (input.cards.length === 0) return [];
  const vectors = await input.embed(input.cards.map(noteText));
  if (vectors.length !== input.cards.length) {
    throw new ApiFailure("unavailable");
  }
  const found = await Promise.all(
    vectors.map(async (vector) => {
      const { data, error } = await client.rpc("search_notes", {
        seat: input.seat.slug,
        query_embedding: JSON.stringify(vector),
        k: SEARCH_K,
      });
      if (error) throw dbFailure(error);
      return z.array(FoundNote).parse(data ?? []);
    }),
  );
  const matches = input.cards.flatMap((card, i) => {
    const note = noteToUpdate(card, found[i], input.seat.id, input.term);
    return note ? [{ card: i, note }] : [];
  });
  if (matches.length === 0) return [];

  const { data, error } = await client
    .from("notes")
    .select("id, scope")
    .in("id", [...new Set(matches.map(({ note }) => note.id))]);
  if (error) throw dbFailure(error);
  const scopes = new Map(
    z
      .array(z.object({ id: z.string(), scope: Scope }))
      .parse(data ?? [])
      .map((row) => [row.id, row.scope]),
  );
  return matches.flatMap(({ card, note }): Duplicate[] => {
    const scope = scopes.get(note.id);
    // Gone between the search and this read (withdrawn just now): nothing to update.
    if (!scope) return [];
    return [
      {
        card,
        noteId: note.id,
        title: note.title,
        byline: note.byline,
        similarity: Math.min(note.similarity, 1),
        scope,
      },
    ];
  });
}

// Of the seat's own notes of the card's kind that reach SIMILAR, the latest term's, then the closest. An update replaces
// the seat's current version of a rule; the earlier years stay live as its history (the rule-change flag reads them),
// so the 2026 notice updates the 2025 note even though the 2024 one scores higher. Only notes 0010 lets the importer
// update: never another seat's (an institution-wide one search_notes also finds), never a later term's than theirs.
export function noteToUpdate(
  card: Pick<ImportedCard, "kind">,
  notes: FoundNote[],
  seatId: string,
  term: number,
): FoundNote | undefined {
  return notes
    .filter(
      (note) =>
        note.seat_id === seatId &&
        note.kind === card.kind &&
        note.term_order <= term &&
        note.similarity >= SIMILAR,
    )
    .sort(
      (a, b) => b.term_order - a.term_order || b.similarity - a.similarity,
    )[0];
}
