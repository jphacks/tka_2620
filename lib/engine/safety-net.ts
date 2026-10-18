// The server's safety net for an import (docs/SPEC.md → adding knowledge, step 6). The browser already redacted the
// text, so /api/import runs the same rules again (lib/redact/redact.ts) and refuses a text that still holds a phone
// number, an email or a canary planted in the seed (seed/chat-canaries.txt). Whatever else the second pass hides stays
// hidden in what the model gets. Only counts leave this module: the text is never stored or logged, and neither is a
// canary.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, redactText } from "@/lib/redact/redact";

export type Screened =
  // text: the second pass's output, what the model may read; rehidden: how many items it hid on top of the browser.
  | { ok: true; text: string; rehidden: number }
  // What got past the browser: phone numbers, emails, and how many of the canaries.
  | { ok: false; phones: number; emails: number; canaries: number };

export function screenImport(
  text: string,
  canaries: readonly string[],
): Screened {
  // Normalized first, which the rules do anyway: a request holds no WhatsApp mention marks (the browser's
  // redaction dropped them), and a crafted one with thousands would build one huge pattern (lib/redact/redact.ts).
  const again = redactText(normalize(text));
  const found = canaryCount(text, canaries);
  if (again.counts.phones > 0 || again.counts.emails > 0 || found > 0) {
    return {
      ok: false,
      phones: again.counts.phones,
      emails: again.counts.emails,
      canaries: found,
    };
  }
  const rehidden = Object.values(again.counts).reduce((a, b) => a + b, 0);
  return { ok: true, text: again.text, rehidden };
}

// How many canaries a text holds, however it is written. Both sides are compared the way the leak test compares
// (tests/leak-judge.ts), and stricter: NFKC with invisible characters removed (redact.ts normalize), kanji digits as
// digits, upper case, and no spaces, dashes, dots, slashes or underscores, so 「ｓｍａｓｈ　２４６８」, 「中村​健」
// and 「二四六八」 still match. A canary of digits alone (a PIN, an account number) needs a digit on neither side, so
// 2024-08-21 never holds 0821.
export function canaryCount(text: string, canaries: readonly string[]): number {
  const plain = squash(text);
  let found = 0;
  for (const canary of new Set(canaries.map(squash))) {
    if (canary.length < 2) continue; // a line of dashes would match every text
    const hit = /^\d+$/.test(canary)
      ? new RegExp(`(?<!\\d)${canary}(?!\\d)`).test(plain)
      : plain.includes(canary);
    if (hit) found += 1;
  }
  return found;
}

const KANJI_DIGITS = "〇一二三四五六七八九";

function squash(text: string): string {
  return normalize(text)
    .replace(/[〇一二三四五六七八九]/g, (digit) =>
      String(KANJI_DIGITS.indexOf(digit)),
    )
    .toUpperCase()
    .replace(/[\s\p{Pd}・･._/]/gu, "");
}

// seed/chat-canaries.txt: one string per line, # for comments.
export function parseCanaries(file: string): string[] {
  return file
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// Read once per server process, from the project root (where next dev runs). Without the file or with nothing in it,
// as in a deployment without the seed, this throws and the import answers unavailable: the check is never silently
// off.
let canaries: string[] | undefined;

export function seedCanaries(root = process.cwd()): string[] {
  if (!canaries) {
    const found = parseCanaries(
      readFileSync(join(root, "seed", "chat-canaries.txt"), "utf8"),
    );
    if (found.length === 0) throw new Error("seed/chat-canaries.txt is empty");
    canaries = found;
  }
  return canaries;
}
