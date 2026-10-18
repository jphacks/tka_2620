// Similar notes (F5.6, issue #36): which live note a drafted card would update. Offline, with a scripted search_notes;
// the scores are the bge-m3 ones measured for lib/engine/similar.ts (the 2026 notice's card against the seed notes).
// Who can be found at all is the database's job (0004, and 0010 for the update itself).
import { describe, expect, it } from "vitest";
import type { ImportedCard } from "@/lib/contracts";
import { noteText } from "@/lib/embed";
import type { FoundNote } from "@/lib/engine/retrieve";
import { noteToUpdate, SIMILAR, similarNotes } from "@/lib/engine/similar";
import { mockImport, mockImportNotice } from "@/lib/mocks";
import {
  GAKUSAI_MOGITEN,
  q01Notes,
  type Result,
  SMASH_KAIKEI,
  stubClient,
} from "./fakes";

const [hokenjo2024, gakusai2025, hokenjo2025] = q01Notes;
const notice = mockImportNotice.cards[0];
const receipts: ImportedCard = { ...mockImport.cards[2], source: "import" };
const seat = { id: SMASH_KAIKEI, slug: "smash-kaikei" };

const ok = (data: unknown): Result => ({ data, error: null });
const scored = (note: FoundNote, similarity: number): FoundNote => ({
  ...note,
  similarity,
});
const ryoshusho = scored(
  {
    ...hokenjo2025,
    id: "smash-2025-ryoshusho",
    kind: "rule_of_thumb",
    title: "領収書は月末にまとめて精算",
    deadline_date: null,
  },
  0.802,
);
// search_notes' rows for the notice's card, best first, as a26 finds them.
const forNotice = [
  scored(hokenjo2024, 0.779),
  scored(gakusai2025, 0.738),
  scored(hokenjo2025, 0.732),
];
// The scopes as seed/notes.csv gives them, as the importer reads them.
const scopes = ok([
  { id: "smash-2024-hokenjo", scope: "successor" },
  { id: "smash-2025-hokenjo", scope: "successor" },
  { id: "smash-2025-ryoshusho", scope: "group" },
]);

// One import's comparison: one search per card, answered in order, then one read of the matched notes' scopes.
async function compare(
  cards: ImportedCard[],
  searches: Result[],
  options: { term?: number; notes?: Result } = {},
) {
  const stub = stubClient(
    { notes: [options.notes ?? scopes] },
    { search_notes: searches },
  );
  const embedded: string[][] = [];
  const duplicates = await similarNotes(stub.client, {
    seat,
    term: options.term ?? 2026, // a26
    cards,
    embed: async (texts) => {
      embedded.push(texts);
      return texts.map((_, i) => [i + 1, 0.5]);
    },
  });
  return {
    duplicates,
    embedded,
    rpcCalls: stub.rpcCalls,
    notesQueries: stub.calls.notes,
  };
}

describe("similarNotes", () => {
  it("offers the 2025 note for the 2026 notice, though the 2024 one scores higher", async () => {
    const { duplicates } = await compare([notice], [ok(forNotice)]);
    expect(duplicates).toEqual([
      {
        card: 0,
        noteId: "smash-2025-hokenjo",
        title: hokenjo2025.title,
        byline: "2025年度 会計",
        similarity: 0.732,
        scope: "successor",
      },
    ]);
  });

  it("embeds the cards once, as notes are, and searches each with its own vector, as the caller", async () => {
    const { embedded, rpcCalls } = await compare(
      [notice, receipts],
      [ok(forNotice), ok([])],
    );
    expect(embedded).toEqual([[noteText(notice), noteText(receipts)]]);
    expect(rpcCalls).toEqual([
      [
        "search_notes",
        { seat: "smash-kaikei", query_embedding: "[1,0.5]", k: 20 },
      ],
      [
        "search_notes",
        { seat: "smash-kaikei", query_embedding: "[2,0.5]", k: 20 },
      ],
    ]);
  });

  it("gives each card its own match, by its index, with the old note's scope", async () => {
    const { duplicates, notesQueries } = await compare(
      [receipts, notice, { ...notice, title: "もう一枚" }],
      [ok([ryoshusho, ...forNotice]), ok(forNotice), ok(forNotice)],
    );
    expect(
      duplicates.map(({ card, noteId, scope }) => [card, noteId, scope]),
    ).toEqual([
      [0, "smash-2025-ryoshusho", "group"],
      [1, "smash-2025-hokenjo", "successor"],
      [2, "smash-2025-hokenjo", "successor"],
    ]);
    // One read for the matched notes, each once.
    expect(notesQueries).toHaveLength(1);
    expect(notesQueries?.[0]).toContainEqual([
      "in",
      "id",
      ["smash-2025-ryoshusho", "smash-2025-hokenjo"],
    ]);
  });

  it("leaves out a match whose scope it can't read any more (withdrawn since the search)", async () => {
    const { duplicates } = await compare([notice], [ok(forNotice)], {
      notes: ok([]),
    });
    expect(duplicates).toEqual([]);
  });

  it("asks nothing when there's no card, and reads no scope without a match", async () => {
    const none = await compare([], []);
    expect(none.duplicates).toEqual([]);
    expect(none.embedded).toEqual([]);
    expect(none.rpcCalls).toEqual([]);

    const unmatched = await compare([notice], [ok([])]);
    expect(unmatched.duplicates).toEqual([]);
    expect(unmatched.notesQueries).toBeUndefined();
  });

  it("offers an earlier term's holder no later term's note", async () => {
    // a25 adding the notice: the 2026 note a26 published is closer, but 0010 wouldn't let a25 update it.
    const by2026 = scored(
      { ...hokenjo2025, id: "notice-2026", term_order: 2026 },
      0.95,
    );
    const { duplicates } = await compare(
      [notice],
      [ok([by2026, ...forNotice])],
      { term: 2025 },
    );
    expect(duplicates.map(({ noteId }) => noteId)).toEqual([
      "smash-2025-hokenjo",
    ]);
  });

  it("fails by its code when a read fails, or the embeddings don't match the cards", async () => {
    await expect(
      compare([notice], [{ data: null, error: { code: "PGRST202" } }]),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "unavailable" });
    await expect(
      compare([notice], [ok(forNotice)], {
        notes: { data: null, error: { code: "42501" } },
      }),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "forbidden" });

    const stub = stubClient({}, {});
    await expect(
      similarNotes(stub.client, {
        seat,
        term: 2026,
        cards: [notice, receipts],
        embed: async () => [[1]],
      }),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "unavailable" });
    expect(stub.rpcCalls).toEqual([]);
  });

  it("keeps a similarity within the contract's 0 to 1", async () => {
    const { duplicates } = await compare(
      [notice],
      [ok([scored(hokenjo2025, 1.0000002)])],
    );
    expect(duplicates[0].similarity).toBe(1);
  });
});

describe("noteToUpdate", () => {
  it("needs the card's kind, the seat's own note and SIMILAR", () => {
    const otherSeat = scored(
      { ...hokenjo2025, id: "gakusai-2025-deadline", seat_id: GAKUSAI_MOGITEN },
      0.95,
    );
    const otherKind = scored({ ...hokenjo2025, kind: "rule_of_thumb" }, 0.95);
    const under = scored(hokenjo2025, SIMILAR - 0.001);
    expect(
      noteToUpdate(notice, [otherSeat, otherKind, under], SMASH_KAIKEI, 2026),
    ).toBeUndefined();
    expect(
      noteToUpdate(notice, [scored(hokenjo2025, SIMILAR)], SMASH_KAIKEI, 2026)
        ?.id,
    ).toBe("smash-2025-hokenjo");
  });

  it("takes the latest term up to the importer's, then the closest note within it", () => {
    const also2025 = scored({ ...hokenjo2025, id: "smash-2025-other" }, 0.75);
    const notes = [
      scored(hokenjo2024, 0.9),
      scored(hokenjo2025, 0.7),
      also2025,
    ];
    expect(noteToUpdate(notice, notes, SMASH_KAIKEI, 2026)?.id).toBe(
      "smash-2025-other",
    );
    expect(noteToUpdate(notice, notes, SMASH_KAIKEI, 2025)?.id).toBe(
      "smash-2025-other",
    );
    expect(noteToUpdate(notice, notes, SMASH_KAIKEI, 2024)?.id).toBe(
      "smash-2024-hokenjo",
    );
  });
});
