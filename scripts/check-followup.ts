// F6.3 acceptance with the real models: an answer without a date gets one follow-up that asks for it, the reply round
// gets the dated card and no second question, and complete answers get none. Then the live-loop answer, timed: the
// follow-up runs beside the drafting, so it adds to the draft only when Haiku is the slower. Calls Sonnet and Haiku,
// no database; not part of `pnpm test`. Run with
// `node --env-file-if-exists=.env.local --import tsx scripts/check-followup.ts`.
// Prints the follow-up questions and the cards' kinds and dates: the answers are made up here or synthetic seed text,
// never pass real answers through this script.
import { readFile } from "node:fs/promises";
import { haiku, sonnet } from "@/lib/ai";
import type { Followup } from "@/lib/contracts";
import { draftAnswer, draftCards } from "@/lib/engine/draft";
import { followupFor } from "@/lib/engine/followup";
import { mockQuestions } from "@/lib/mocks";

const seat = { name: "会計", seatType: "club_role" } as const;
const today = "2026-10-18";
const deadlinePrompt = "模擬店の保健所申請は、いつまでに出せばいいですか？";
const noDate = "学祭の前までに出す。";
const RUNS = 3;

const checks: [string, boolean][] = [];
function check(name: string, ok: boolean) {
  checks.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}`);
}

// A date follow-up that asks for the day the thing is due, not for the day of the festival it counts from: a reply to
// 「学祭は何月何日ですか？」 would date the deadline card on the festival.
function asksDueDate(followup: Followup | undefined): boolean {
  return (
    followup?.missing === "date" &&
    /締切|期限|いつまで/.test(followup.question) &&
    !followup.question.includes("学祭")
  );
}

// 1. No date: one follow-up, asking for the date it is due, every run.
for (let run = 1; run <= RUNS; run += 1) {
  const followup = await followupFor({
    model: haiku(),
    question: deadlinePrompt,
    answer: noDate,
  });
  console.log(`  run ${run}:`, JSON.stringify(followup));
  check(
    `「${noDate}」 asks for the date it is due (run ${run})`,
    asksDueDate(followup),
  );
}

// 2. The whole round through draftAnswer: the first draft asks once, the reply round never asks again.
let followupModels = 0;
const models = {
  draft: sonnet,
  followup: () => {
    followupModels += 1;
    return haiku();
  },
};
const first = await draftAnswer({
  models,
  question: deadlinePrompt,
  answer: noDate,
  seat,
  today,
});
console.log(
  "  first draft:",
  JSON.stringify({
    cards: first.cards.map(({ kind, deadline_date }) => ({
      kind,
      deadline_date,
    })),
    followup: first.followup,
  }),
);
check(
  "the first draft asks one follow-up, for the date it is due",
  asksDueDate(first.followup),
);
check(
  "the first draft's cards can be published as they are (no undated deadline)",
  first.cards.length > 0 &&
    first.cards.every((card) => card.kind !== "deadline" || card.deadline_date),
);
const before = followupModels;
const second = await draftAnswer({
  models,
  question: deadlinePrompt,
  answer: noDate,
  followup: {
    question: first.followup?.question ?? "締切は何月何日ですか？",
    answer: "10月20日です。",
  },
  seat,
  today,
});
console.log(
  "  reply round:",
  JSON.stringify(
    second.cards.map(({ kind, deadline_date }) => ({ kind, deadline_date })),
  ),
);
check(
  "the reply round asks nothing, and never calls Haiku",
  second.followup === undefined && followupModels === before,
);
check(
  "the reply gives a deadline card dated 2026-10-20",
  second.cards.some(
    (card) => card.kind === "deadline" && card.deadline_date === "2026-10-20",
  ),
);

// 3. Complete answers: no follow-up.
const complete: [string, string][] = [
  [deadlinePrompt, "10月20日までに、学生課の窓口に申請書を出す。"],
  [
    "口座の代表者を変えるとき、銀行に何を持っていけばいいですか？",
    "新旧の代表者の学生証と、通帳と届出印を持って、銀行の窓口に行く。",
  ],
  [
    "部室の鍵はどうやって借りますか？",
    "鍵は学生課の施設係で借りる。借りるときに団体名を書いて、その日のうちに返す。",
  ],
];
for (const [question, answer] of complete) {
  for (let run = 1; run <= 2; run += 1) {
    const followup = await followupFor({ model: haiku(), question, answer });
    if (followup) console.log("  asked:", JSON.stringify(followup));
    check(
      `complete 「${answer.slice(0, 14)}…」 asks nothing (run ${run})`,
      !followup,
    );
  }
}

// 4. The live-loop answer (seed/live-answer.txt), timed: Sonnet and Haiku side by side, as draftAnswer runs them.
// The cards wait at most 1.5 s past the drafting for the follow-up (FOLLOWUP_GRACE_MS), so a later one costs the
// follow-up, never the live loop.
const live = (await readFile("seed/live-answer.txt", "utf8")).trim();
for (let run = 1; run <= RUNS; run += 1) {
  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  const [draftS, followup] = await Promise.all([
    draftCards({
      model: sonnet(),
      question: mockQuestions.q04,
      answer: live,
      seat,
      today,
    }).then(() => seconds()),
    followupFor({
      model: haiku(),
      question: mockQuestions.q04,
      answer: live,
    }).then((asked) => ({ asked, seconds: seconds() })),
  ]);
  console.log(
    `  live answer, run ${run}: drafted in ${draftS.toFixed(1)} s, follow-up in ${followup.seconds.toFixed(1)} s:`,
    JSON.stringify(followup.asked ?? null),
  );
  check(
    `on the live answer the follow-up comes within the drafting's time plus the grace (run ${run})`,
    followup.seconds <= draftS + 1.5,
  );
}

const failed = checks.filter(([, ok]) => !ok).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
