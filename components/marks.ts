import type { NoteKind } from "@/lib/contracts";

// docs/DESIGN.md → Marks and signs: a Japanese mark per kind, its word read from messages/kinds.*.
export const kindMarks: Record<NoteKind, string> = {
  deadline: "〆",
  contact: "℡",
  rule_of_thumb: "◎",
  pitfall: "㊟",
  unwritten_rule: "※",
};
