// The rule-change flag (F2.3, issue #21): computed from the cited deadline notes' dates, never by the model.
import { describe, expect, it } from "vitest";
import type { AnswerSentence } from "@/lib/contracts";
import type { FoundNote } from "@/lib/engine/retrieve";
import { ruleChange } from "@/lib/engine/rule-change";
import { mockAnswer } from "@/lib/mocks";
import { GAKUSAI_MOGITEN, q01Notes, SMASH_KAIKEI } from "./fakes";

const [hokenjo2024, gakusai2025, hokenjo2025] = q01Notes;

// One sentence citing every given note.
function citing(...notes: FoundNote[]): AnswerSentence[] {
  return [
    {
      text: "締切は10月20日です。",
      citations: notes.map((note) => ({
        noteId: note.id,
        byline: note.byline,
        termLabel: note.term_label,
      })),
    },
  ];
}

// A deadline note of Smash's 会計 (or of another seat) in some term.
function deadline(
  id: string,
  term: number,
  date: string,
  seatId = SMASH_KAIKEI,
): FoundNote {
  return {
    ...hokenjo2024,
    id,
    seat_id: seatId,
    term_order: term,
    term_label: String(term),
    byline: `${term}年度 会計`,
    deadline_date: date,
  };
}

// Asked at Smash's 会計, as q01 is.
const atSmash = (notes: FoundNote[], sentences: AnswerSentence[]) =>
  ruleChange(notes, sentences, SMASH_KAIKEI);

describe("ruleChange", () => {
  it("flags q01's change in 2025, 10/27 → 10/20, as the mock shows it", () => {
    const change = atSmash(q01Notes, mockAnswer.sentences);
    expect(change).toEqual({ termLabel: "2025", summary: "10/27 → 10/20" });
    expect(change).toEqual(mockAnswer.ruleChange);
  });

  it("sees no change when the deadline comes back on the same day", () => {
    const sameDay = deadline("smash-2025-same", 2025, "2025-10-27");
    expect(
      atSmash([hokenjo2024, sameDay], citing(hokenjo2024, sameDay)),
    ).toBeUndefined();
  });

  it("needs two terms", () => {
    expect(atSmash(q01Notes, citing(hokenjo2025))).toBeUndefined();
  });

  it("counts only the notes the answer cites", () => {
    expect(atSmash(q01Notes, citing(hokenjo2025, gakusai2025))).toBeUndefined();
  });

  it("ignores notes that aren't deadlines or have no date", () => {
    const tip: FoundNote = {
      ...deadline("smash-2025-tip", 2025, "2025-10-20"),
      kind: "rule_of_thumb",
    };
    const undated: FoundNote = {
      ...deadline("smash-2025-undated", 2025, "2025-10-20"),
      deadline_date: null,
    };
    expect(
      atSmash([hokenjo2024, tip, undated], citing(hokenjo2024, tip, undated)),
    ).toBeUndefined();
  });

  it("follows only the asked seat's lineage", () => {
    // Another seat's deadline that moved: an institution-wide note, a different rule.
    const other = [
      deadline("gakusai-2024-deadline", 2024, "2024-10-15", GAKUSAI_MOGITEN),
      deadline("gakusai-2025-deadline", 2025, "2025-10-10", GAKUSAI_MOGITEN),
    ];
    const sameDay = deadline("smash-2025-same", 2025, "2025-10-27");
    const notes = [hokenjo2024, sameDay, ...other];
    const sentences = citing(...notes);

    expect(atSmash(notes, sentences)).toBeUndefined();
    expect(ruleChange(notes, sentences, GAKUSAI_MOGITEN)).toEqual({
      termLabel: "2025",
      summary: "10/15 → 10/10",
    });
    // Never across seats: Smash's 2024 note against the other seat's 2025 one.
    expect(
      atSmash([hokenjo2024, other[1]], citing(hokenjo2024, other[1])),
    ).toBeUndefined();
  });

  it("gives no flag when one term has two different deadlines", () => {
    const report = deadline("smash-2025-report", 2025, "2026-03-31");
    expect(
      atSmash([...q01Notes, report], citing(hokenjo2024, hokenjo2025, report)),
    ).toBeUndefined();
  });

  it("names the term the deadline last changed in", () => {
    const notes = [
      deadline("d2023", 2023, "2023-10-27"),
      deadline("d2024", 2024, "2024-10-20"),
      deadline("d2025", 2025, "2025-10-20"),
    ];
    expect(atSmash(notes, citing(...notes))).toEqual({
      termLabel: "2024",
      summary: "10/27 → 10/20",
    });

    const twice = [...notes, deadline("d2026", 2026, "2026-10-19")];
    expect(atSmash(twice, citing(...twice))).toEqual({
      termLabel: "2026",
      summary: "10/20 → 10/19",
    });
  });
});
