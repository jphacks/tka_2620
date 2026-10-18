// The pure side of 「＋ 追加」 (docs/SPEC.md → adding knowledge, steps 1–5): what a piece of text is, and how the
// redaction preview shows what will be sent. No React, so tests/add-panel.test.ts runs it on the seed files. What a
// chat keeps (step 2: the last 12 months, what matters, the request's cap) is lib/redact's redactChat.
import type { RedactionCounts } from "@/lib/contracts";
import type { FileType } from "@/lib/ingest/types";
import {
  type ChatMessage,
  type ChatPlatform,
  isChatHeader,
  parseLine,
  parsePaste,
  speakers,
} from "@/lib/redact/parse";
import { PLACEHOLDER } from "@/lib/redact/redact";

// What the preview redacts and the request sends. A chat keeps its messages, so each speaker can get a role.
export type Source =
  | { kind: "text"; text: string }
  | {
      kind: "file";
      fileType: FileType;
      text: string;
      name: string;
      pages?: number;
    }
  | { kind: "chat"; platform: ChatPlatform; messages: ChatMessage[] };

// What a piece of text turned out to be. A chat that can't be read safely is refused, never sent as text: its speakers
// are names that only the role step hides. A chat found in what came as a doc keeps that doc (`doc`), so the role step
// can offer 「トークではなく資料として読む」 when the guess is wrong.
export type Read =
  | { kind: "text"; text: string }
  | {
      kind: "chat";
      platform: ChatPlatform;
      messages: ChatMessage[];
      doc?: string;
    }
  | { kind: "whatsapp" } // no reader yet (#32)
  | { kind: "notChat" } // chat-shaped, but not a form lib/redact reads
  | { kind: "noSpeakers" }; // on トーク履歴, nobody speaking was found

// Where text goes, wherever it arrives (pasted, dropped on any tab, picked as any file type):
// - A LINE export is a chat, so its speaker column gets roles: redactText alone doesn't know that a speaker is a name.
// - A WhatsApp export is refused until it has a reader (#32); parsePaste would take it as one message with no speaker.
// - A LINE row copied without its date line (21:03⇥名前⇥本文) is refused: parseLine needs the date line.
// - On トーク履歴, pasted messages need someone speaking.
// - On 貼り付け, copied messages are a chat when someone speaks twice (名前: 本文) or a line has a chat's header
//   (Slack 名前␣␣21:03, Discord 名前 — 日時, [21:03] 名前:). A doc's field labels each appear once (the seed docs'
//   部費, 学祭, 提出期限), so they stay a doc. Two people saying one thing each, as 名前: 本文, can't be told from two
//   labels: the preview shows those names, for the person to hide.
// Blank text is undefined.
export function readSource(
  raw: string,
  tab: "text" | "chat",
): Read | undefined {
  if (!raw.trim()) return undefined;
  const line = parseLine(raw);
  if (line.length > 0)
    return { kind: "chat", platform: "line", messages: line };
  const lines = raw.split(/\r\n|\r|\n/).filter((row) => row.trim());
  if (isWhatsApp(lines, tab)) return { kind: "whatsapp" };
  if (lines.some((row) => LINE_ROW.test(row))) return { kind: "notChat" };
  const pasted = parsePaste(raw);
  const people = speakers(pasted);
  if (tab === "chat") {
    if (pasted.length === 0) return { kind: "notChat" };
    return people.length > 0
      ? { kind: "chat", platform: "paste", messages: pasted }
      : { kind: "noSpeakers" };
  }
  const talking = people.some(({ count }) => count >= 2);
  return people.length > 0 && (talking || lines.some(isChatHeader))
    ? { kind: "chat", platform: "paste", messages: pasted, doc: raw }
    : { kind: "text", text: raw };
}

// A LINE message row, as lib/redact/parse.ts reads it after a date line: 21:03⇥名前⇥本文 (午後9:03, 9:03 PM). The
// tabs make it a LINE copy, never a doc.
const LINE_ROW =
  /^(?:(?:午前|午後|AM|PM)\s?)?\d{1,2}:\d{2}(?:\s?[AP]M)?\t[^\t\n]+\t/i;

// A WhatsApp message line: 16/10/2025, 17:03 - 名前: (Android), [16/10/2025, 17:03:12] 名前: (iPhone), with any date
// order, 5:03 PM, and the direction mark iPhones put first.
const WHATSAPP_LINE =
  /^[\u200e\u200f\ufeff]?\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?(?:\]\s*|\s+[-–]\s+)[^:\n]{1,40}:/;

// On トーク履歴 one such line is enough. A doc may hold one (2025/10/16 17:00 - 学生課: 提出), so on 貼り付け it takes
// two, or a paste that starts with one (a message and its continuation lines).
function isWhatsApp(lines: string[], tab: "text" | "chat"): boolean {
  const headers = lines.filter((line) => WHATSAPP_LINE.test(line)).length;
  if (tab === "chat") return headers >= 1;
  return headers >= 2 || (lines.length > 0 && WHATSAPP_LINE.test(lines[0]));
}

// The placeholders lib/redact writes, drawn as black bars with their type inside (docs/DESIGN.md → Blackout). The type
// is a kind the screen words from the messages (import.bars), so an English page reads "Phone"; [人] and [名前] are
// both a name to the person adding. A URL may keep a service's host, [URL: forms.gle]. Any other bracket ([こちら]),
// and a [URL: …] holding more than a host name, stays text: it isn't hidden, so it must not look hidden.
export type BarKind =
  | "phone"
  | "email"
  | "url"
  | "id"
  | "studentId"
  | "address"
  | "account"
  | "card"
  | "secret"
  | "name";

const BAR_KINDS = {
  [PLACEHOLDER.phone]: "phone",
  [PLACEHOLDER.email]: "email",
  [PLACEHOLDER.url]: "url",
  [PLACEHOLDER.id]: "id",
  [PLACEHOLDER.studentId]: "studentId",
  [PLACEHOLDER.address]: "address",
  [PLACEHOLDER.account]: "account",
  [PLACEHOLDER.card]: "card",
  [PLACEHOLDER.secret]: "secret",
  [PLACEHOLDER.person]: "name",
  [PLACEHOLDER.name]: "name",
} satisfies Record<(typeof PLACEHOLDER)[keyof typeof PLACEHOLDER], BarKind>;

const LABELS = Object.keys(BAR_KINDS)
  .filter((placeholder) => placeholder !== PLACEHOLDER.url)
  .map((placeholder) => placeholder.slice(1, -1));
const PLACEHOLDERS = new RegExp(
  `\\[(?:(${LABELS.join("|")})|URL(?:: ([A-Za-z0-9.-]+))?)\\]`,
  "g",
);

export type Segment =
  | { at: number; text: string }
  | { at: number; bar: BarKind; host?: string };

export function blackoutSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const match of text.matchAll(PLACEHOLDERS)) {
    if (match.index > at) {
      segments.push({ at, text: text.slice(at, match.index) });
    }
    const [, label, host] = match;
    segments.push(
      label === undefined
        ? { at: match.index, bar: "url", ...(host && { host }) }
        : {
            at: match.index,
            bar: BAR_KINDS[`[${label}]` as keyof typeof BAR_KINDS],
          },
    );
    at = match.index + match[0].length;
  }
  if (at < text.length) segments.push({ at, text: text.slice(at) });
  return segments;
}

// The counts line names only what was found, in this order. A speaker who became a role and anyone else named
// ([人]) are both 名前 to the person adding.
const SHOWN = [
  "names",
  "phones",
  "emails",
  "accounts",
  "secrets",
  "ids",
  "addresses",
  "urls",
] as const;
export type HiddenKind = (typeof SHOWN)[number];

export function hiddenKinds(
  counts: RedactionCounts,
): { kind: HiddenKind; count: number }[] {
  return SHOWN.map((kind) => ({
    kind,
    count: kind === "names" ? counts.names + counts.people : counts[kind],
  })).filter(({ count }) => count > 0);
}

// メンバーA … Z, then AA, AB: the default role of the speaker at this place (messages → import.member).
export function memberLetter(index: number): string {
  let letters = "";
  for (let rest = index; rest >= 0; rest = Math.floor(rest / 26) - 1) {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
  }
  return letters;
}

// A label pack's roles are one string (seatTypes.<type>.roles: 「部長・副部長・会計」, "President, Treasurer"), and
// the words to hide are typed the same way; both split on ・、, and spaces where a list allows them.
export function splitRoles(list: string): string[] {
  return unique(list.split(/\s*[・、,，]\s*/));
}

export function hideWords(input: string): string[] {
  return unique(input.split(/[\s、,，・]+/));
}

function unique(words: string[]): string[] {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}
