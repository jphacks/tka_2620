// F5.5 (#35): the acceptance check for /api/import's engine, on the real model (docs/SPEC.md → F5). The seed samples go
// the way the browser sends them (lib/ingest for the files, lib/redact) and then through the server's safety net and
// note extraction (lib/engine/safety-net.ts, lib/engine/extract-notes.ts) with Sonnet, as POST /api/import runs them.
// No database: no sign-in, nothing written.
//
//   pnpm test:import                   old-handover.sample.md 3 times; the Word file, the chat and the notice once
//   pnpm test:import --runs 5          the old handover 5 times
//   pnpm test:import --show            also print the drafts (the samples are made up)
//
// Each sample must pass the safety net as sent, and its drafts must hold nothing the redaction hides. The handover
// (md and Word) and the chat must give dated cards and 「保健所申請の締切が書かれていません」; the 2026 notice, a deadline
// card on 2026-10-19. What the model is sent is checked too: no canary, no phone number, no email. A failure names
// its check, never a text; without --show, only counts, kinds and dates are printed. Needs ANTHROPIC_API_KEY and
// ANSWER_MODEL (.env.local); a run is a few cents.
import { readFile } from "node:fs/promises";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { sonnet } from "@/lib/ai";
import type { ImportRequest } from "@/lib/contracts";
import { type Extracted, extractNotes } from "@/lib/engine/extract-notes";
import { blockReason } from "@/lib/engine/guard";
import {
  canaryCount,
  parseCanaries,
  screenImport,
} from "@/lib/engine/safety-net";
import { extractDocx } from "@/lib/ingest/docx";
import { extractPdf } from "@/lib/ingest/pdf";
import { parseLine, speakers } from "@/lib/redact/parse";
import { redactChat, redactText } from "@/lib/redact/redact";
import ja from "@/messages/ja.json";

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1]) || 3;
const show = args.includes("--show");
const HOKENJO = "保健所申請の締切が書かれていません";

const seed = (name: string) => new URL(`../seed/${name}`, import.meta.url);
const bytes = async (name: string) => new Blob([await readFile(seed(name))]);

type Sample = {
  label: string;
  kind: ImportRequest["kind"];
  text: string; // as the browser sends it
  runs: number;
  expect: (result: Extracted) => [check: string, ok: boolean][];
};

// Dated cards, every deadline dated, and the missing 保健所 deadline: the cold start (SPEC → F5).
const coldStart = (result: Extracted): [string, boolean][] => [
  ["a dated card", result.cards.some((card) => card.deadline_date)],
  [
    "every deadline card dated",
    result.cards.every(
      (card) => card.kind !== "deadline" || card.deadline_date,
    ),
  ],
  [
    `「${HOKENJO}」`,
    result.missing.some(({ topic }) =>
      ja.import.missingItem.replace("{topic}", topic).includes(HOKENJO),
    ),
  ],
];

async function samples(): Promise<Sample[]> {
  const chat = parseLine(await readFile(seed("chat-line.sample.txt"), "utf8"));
  // The sample's three speakers, as the demo picks their roles.
  const roles = Object.fromEntries(
    speakers(chat).map(({ name }, i) => [name, ["会計", "副会計", "部長"][i]]),
  );
  return [
    {
      label: "old-handover.sample.md (pasted)",
      kind: "text",
      text: redactText(await readFile(seed("old-handover.sample.md"), "utf8"))
        .text,
      runs,
      expect: coldStart,
    },
    {
      label: "handover-2024.sample.docx",
      kind: "file",
      text: redactText(
        (await extractDocx(await bytes("handover-2024.sample.docx"))).text,
      ).text,
      runs: 1,
      expect: coldStart,
    },
    {
      label: "chat-line.sample.txt",
      kind: "chat",
      text: redactChat(chat, { roles }).text,
      runs: 1,
      expect: coldStart,
    },
    {
      label: "notice-2026.sample.pdf",
      kind: "file",
      text: redactText(
        (await extractPdf(await bytes("notice-2026.sample.pdf"))).text,
      ).text,
      runs: 1,
      expect: (result) => [
        [
          "a deadline card on 2026-10-19",
          result.cards.some(
            (card) =>
              card.kind === "deadline" && card.deadline_date === "2026-10-19",
          ),
        ],
      ],
    },
  ];
}

// The model, with what each call is sent kept for the checks: the user message's text.
function recording(model: LanguageModel, sent: string[]): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      transformParams: async ({ params }) => {
        for (const message of params.prompt) {
          if (message.role !== "user") continue;
          for (const part of message.content) {
            if (part.type === "text") sent.push(part.text);
          }
        }
        return params;
      },
    },
  });
}

function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

async function main(): Promise<void> {
  const canaries = parseCanaries(
    await readFile(seed("chat-canaries.txt"), "utf8"),
  );
  let failures = 0;
  const seconds: number[] = [];
  for (const sample of await samples()) {
    const screened = screenImport(sample.text, canaries);
    if (!screened.ok) {
      failures += 1;
      console.log(
        `✗ ${sample.label}: the safety net refused it (phones ${screened.phones}, emails ${screened.emails}, canaries ${screened.canaries})`,
      );
      continue;
    }
    for (let run = 1; run <= sample.runs; run++) {
      const sent: string[] = [];
      const started = performance.now();
      let result: Extracted;
      try {
        result = await extractNotes({
          model: recording(sonnet(), sent),
          text: screened.text,
          kind: sample.kind,
          seat: { name: "会計", seatType: "club_role" },
          checklist: [],
          asked: [],
          today: today(),
        });
      } catch (error) {
        failures += 1;
        const name = error instanceof Error ? error.name : typeof error;
        console.log(
          `✗ ${sample.label} run ${run}: extraction failed (${name})`,
        );
        continue;
      }
      const took = (performance.now() - started) / 1000;
      seconds.push(took);
      const shown = [
        ...result.cards.flatMap((card) => [card.title, card.body]),
        ...result.missing.flatMap((item) => [
          item.topic,
          item.reason,
          item.prompt,
        ]),
      ].join("\n");
      const checks: [string, boolean][] = [
        ...sample.expect(result),
        ["no date the text doesn't state", result.datesDropped === 0],
        [
          "every missing item says 「が書かれていません」 once",
          result.missing.every(
            ({ topic }) => !/書かれて|書いて|not written/i.test(topic),
          ),
        ],
        [
          "no canary sent to the model",
          canaryCount(sent.join("\n"), canaries) === 0,
        ],
        [
          "no phone or email sent to the model",
          screenImport(sent.join("\n"), []).ok,
        ],
        ["no canary in a draft", canaryCount(shown, canaries) === 0],
        [
          "no contact, credential or name in a draft",
          result.cards.every(
            (card) => !blockReason(`${card.title}\n${card.body}`),
          ),
        ],
      ];
      const failed = checks.filter(([, ok]) => !ok);
      failures += failed.length;
      const dated = result.cards.filter((card) => card.deadline_date).length;
      console.log(
        `${failed.length ? "✗" : "✓"} ${sample.label} run ${run}: ${result.cards.length} cards (${dated} dated), ` +
          `${result.missing.length} missing, ${result.blocked.length} blocked, ` +
          `${result.datesFixed} dates put back in the text's year, ${took.toFixed(1)} s`,
      );
      for (const [check, ok] of checks)
        console.log(`    ${ok ? "✓" : "✗"} ${check}`);
      console.log(
        `    kinds: ${result.cards.map((card) => card.kind + (card.deadline_date ? ` ${card.deadline_date}` : "")).join(", ")}`,
      );
      if (result.blocked.length) {
        console.log(
          `    blocked: ${result.blocked.map(({ reason }) => reason).join(", ")}`,
        );
      }
      if (show) {
        for (const card of result.cards) {
          console.log(
            `    [${card.kind}${card.deadline_date ? ` ${card.deadline_date}` : ""}] ${card.title}: ${card.body}`,
          );
        }
        for (const { topic, prompt } of result.missing) {
          console.log(
            `    − ${ja.import.missingItem.replace("{topic}", topic)}（${prompt}）`,
          );
        }
        for (const { title, reason } of result.blocked) {
          console.log(`    ⊘ ${title || "(title hidden)"}: ${reason}`);
        }
      }
    }
  }
  const sorted = [...seconds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(
    failures === 0
      ? `✓ every check passed (${seconds.length} extractions, median ${median.toFixed(1)} s)`
      : `✗ ${failures} check(s) failed (${seconds.length} extractions, median ${median.toFixed(1)} s)`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  // The class only: a message could quote a sample or the model's reply.
  console.log(
    `✗ check-import stopped: ${error instanceof Error ? error.name : typeof error}`,
  );
  process.exitCode = 1;
});
