// The strings that must never leave the browser (seed/chat-canaries.txt). leaked() says which of them a text still
// holds by their line in that file, so a failing test prints line numbers, never a canary.
import { readFileSync } from "node:fs";

const canaries = readFileSync(
  new URL("../seed/chat-canaries.txt", import.meta.url),
  "utf8",
)
  .split("\n")
  .map((text, index) => ({ line: index + 1, text: text.trim() }))
  .filter(({ text }) => text && !text.startsWith("#"));

export const canaryCount = canaries.length;

export const leaked = (text: string) =>
  canaries
    .filter(({ text: canary }) => text.includes(canary))
    .map(({ line }) => line);

// RedactionCounts with nothing hidden.
export const nothing = {
  names: 0,
  phones: 0,
  emails: 0,
  urls: 0,
  ids: 0,
  addresses: 0,
  accounts: 0,
  secrets: 0,
  people: 0,
};
