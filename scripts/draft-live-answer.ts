// F3.7 acceptance with the real model: seed/live-answer.txt (what a25 says in the live loop) → one card like
// lib/mocks.ts's live card. Calls Sonnet once; not part of `pnpm test`. Run with
// `node --env-file-if-exists=.env.local --import tsx scripts/draft-live-answer.ts`.
// Prints the drafted card: the answer is synthetic seed text, never pass real answers through this script.
import { readFile } from "node:fs/promises";
import { sonnet } from "@/lib/ai";
import { draftCards } from "@/lib/engine/draft";
import { mockDraft, mockQuestions } from "@/lib/mocks";

const answer = (await readFile("seed/live-answer.txt", "utf8")).trim();
const [expected] = mockDraft.cards;

const started = performance.now();
const cards = await draftCards({
  model: sonnet(),
  question: mockQuestions.q04,
  answer,
  seat: { name: "会計", seatType: "club_role" },
  today: "2026-10-17",
});
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(JSON.stringify(cards, null, 2));

const [card] = cards;
const checks: [string, boolean][] = [
  ["exactly one card", cards.length === 1],
  [`kind ${expected.kind}`, card?.kind === expected.kind],
  ["lang ja", card?.lang === "ja"],
  ["suggested_scope successor", card?.suggested_scope === "successor"],
  [
    "no flags",
    card?.flags.person_verdict === false && card.flags.secret === false,
  ],
  [
    "no invented date",
    card?.deadline_date === undefined && card?.valid_until === undefined,
  ],
];
for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`drafted in ${seconds} s`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
