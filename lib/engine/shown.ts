// The output guard for what a reader of the seat will see (docs/SPEC.md → adding knowledge, step 8): a drafted card from
// an import (lib/engine/extract-notes.ts), an added card again when it is published after the review (lib/engine/publish.ts)
// and a gap prompt (lib/engine/gap.ts). Pure (the redaction's rules, the card guard and the label words), so the browser
// checks a reviewed card the same way before it is sent, and the mocks refuse what the routes refuse.
import type { BlockReason } from "@/lib/contracts";
import { blockReason } from "@/lib/engine/guard";
import { normalize, PLACEHOLDER, redactText } from "@/lib/redact/redact";
import en from "@/messages/en.json";
import ja from "@/messages/ja.json";

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The redaction's placeholders, [URL: forms.gle] too, and the default role of a speaker nobody picked one for
// (messages → import.member: メンバーA, Member A), which stands for a person, not a role.
const PLACEHOLDERS = new RegExp(
  [
    ...Object.values(PLACEHOLDER).map(literal),
    String.raw`\[URL:[^\]\n]*\]`,
  ].join("|"),
);
const MEMBER = [ja, en].map(
  ({ import: { member } }) =>
    new RegExp(
      `${literal(member).replace(literal("{letter}"), "[A-Z]")}(?![A-Za-z])`,
    ),
);

// Why a card can't become a note, in this order: a placeholder the redaction left, a credential next to its value,
// contact details, a name. The redaction's own rules find what it would hide (lib/redact/redact.ts), the card guard
// what publishing refuses (lib/engine/guard.ts). Not the redaction's [秘密] line rule: 「金庫の暗証番号は部長が知っている」
// says where it is kept, as a card should.
export function shownReason(
  text: string,
  secret = false,
): BlockReason | undefined {
  const plain = normalize(text);
  if (PLACEHOLDERS.test(plain) || MEMBER.some((label) => label.test(plain))) {
    return "placeholder";
  }
  const guarded = blockReason(plain);
  if (secret || guarded === "secret") return "secret";
  const { counts } = redactText(plain);
  const contact =
    counts.phones +
    counts.emails +
    counts.urls +
    counts.ids +
    counts.addresses +
    counts.accounts;
  if (guarded === "contact" || contact > 0) return "contact";
  if (guarded === "name" || counts.people + counts.names > 0) return "name";
  return undefined;
}
