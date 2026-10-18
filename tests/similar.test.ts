// Similar notes (F5.6, issue #36): which live note a drafted card would update. Offline, with a scripted search_notes;
// the scores are the bge-m3 ones measured for lib/engine/similar.ts (the 2026 notice's card against the seed notes).
// Who can be found at all is the database's job (0004, and 0009 for the update itself).
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
// search_notes' rows for the notice's card, best first, as a26 finds them.
const forNotice = [
  scored(hokenjo2024, 0.779),
  scored(gakusai2025, 0.738),
  scored(hokenjo2025, 0.732),
];

// One import's comparison: one search per card, answered in order.
async function compare(cards: ImportedCard[], searches: Result[]) {
  const stub = stubClient({}, { search_notes: searches });
  const embedded: string[][] = [];
  const duplicates = await similarNotes(stub.client, {
    seat,
    cards,
    embed: async (texts) => {
      embedded.push(texts);
      return texts.map((_, i) => [i + 1, 0.5]);
    },
  });
  return { duplicates, embedded, rpcCalls: stub.rpcCalls };
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

  it("gives each card its own match, by its index", async () => {
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
    const { duplicates } = await compare(
      [receipts, notice],
      [ok([ryoshusho, ...forNotice]), ok(forNotice)],
    );
    expect(duplicates.map(({ card, noteId }) => [card, noteId])).toEqual([
      [0, "smash-2025-ryoshusho"],
      [1, "smash-2025-hokenjo"],
    ]);
  });

  it("asks nothing when there's no card", async () => {
    const { duplicates, embedded, rpcCalls } = await compare([], []);
    expect(duplicates).toEqual([]);
    expect(embedded).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("fails by its code when the search fails, or the embeddings don't match the cards", async () => {
    await expect(
      compare([notice], [{ data: null, error: { code: "PGRST202" } }]),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "unavailable" });

    const stub = stubClient({}, {});
    await expect(
      similarNotes(stub.client, {
        seat,
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
      noteToUpdate(notice, [otherSeat, otherKind, under], SMASH_KAIKEI),
    ).toBeUndefined();
    expect(
      noteToUpdate(notice, [scored(hokenjo2025, SIMILAR)], SMASH_KAIKEI)?.id,
    ).toBe("smash-2025-hokenjo");
  });

  it("takes the latest term, then the closest note within it", () => {
    const also2025 = scored({ ...hokenjo2025, id: "smash-2025-other" }, 0.75);
    expect(
      noteToUpdate(
        notice,
        [scored(hokenjo2024, 0.9), scored(hokenjo2025, 0.7), also2025],
        SMASH_KAIKEI,
      )?.id,
    ).toBe("smash-2025-other");
  });
});
