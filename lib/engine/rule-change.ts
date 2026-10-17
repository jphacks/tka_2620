// The rule-change flag (docs/SPEC.md → F2): when the deadline notes an answer cites give a different month and day in a
// later term of the asked seat, the answer says the rule changed (「2025年にルールが変わりました」). Computed here from
// deadline_date, never by the model. The summary is the two dates as month/day with an arrow (10/27 → 10/20): numbers
// only, so it holds no copy and reads the same in either language. The screen words the headline from termLabel
// (answer.ruleChange in messages).
import type { AnsweredResult, AnswerSentence } from "@/lib/contracts";
import type { FoundNote } from "@/lib/engine/retrieve";

export type RuleChange = NonNullable<AnsweredResult["ruleChange"]>;

// A rule changes within one seat's lineage, and the headline names no seat, so only the asked seat's deadlines count:
// another seat's (an institution-wide note) is a different rule. Only month and day count, since a deadline comes back
// every year (2024-10-27, then 2025-10-20). A term with two different deadlines is ambiguous, so there's no flag:
// better none than a wrong one. The flag names the latest term whose deadline differs from the term before it.
export function ruleChange(
  notes: FoundNote[],
  sentences: AnswerSentence[],
  seatId: string,
): RuleChange | undefined {
  const cited = new Set(
    sentences.flatMap((sentence) =>
      sentence.citations.map((citation) => citation.noteId),
    ),
  );
  const terms = new Map<number, { label: string; monthDay: string }>();
  for (const note of notes) {
    if (
      !cited.has(note.id) ||
      note.seat_id !== seatId ||
      note.kind !== "deadline" ||
      !note.deadline_date
    ) {
      continue;
    }
    const term = {
      label: note.term_label,
      monthDay: monthDay(note.deadline_date),
    };
    const known = terms.get(note.term_order);
    if (known && known.monthDay !== term.monthDay) return undefined;
    terms.set(note.term_order, term);
  }

  const ordered = [...terms.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, term]) => term);
  for (let i = ordered.length - 1; i > 0; i--) {
    const before = ordered[i - 1];
    const after = ordered[i];
    if (after.monthDay !== before.monthDay) {
      return {
        termLabel: after.label,
        summary: `${before.monthDay} → ${after.monthDay}`,
      };
    }
  }
  return undefined;
}

// 2025-10-20 → 10/20 (deadline_date is a checked YYYY-MM-DD).
function monthDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}
