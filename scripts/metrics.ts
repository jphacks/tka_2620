// #29 acceptance check (docs/SPEC.md → "Numbers for the README", F4.5): one command produces every number the README
// shows and writes them to metrics/latest.json (committed) for the README and for the console's leak counter.
//
//   pnpm metrics        (needs the seeded database; the checks that ask also need `pnpm dev` with Ollama and the key)
//
// Each number comes from the check that measures it (docs/README-SECTIONS.md → "How measured"), run here one after
// another. The numbers are that check's, never typed in:
//
//   leaks      scripts/check-leak.ts        F4.4 (#28)   pnpm test:leak
//   withdraw   scripts/check-withdraw.ts     F4.5 (#29)   pnpm metrics
//   citations  scripts/check-citations.ts    F4.5 (#29)   seed/questions.csv
//   redaction  scripts/check-redact.ts       F5           pnpm test:redact
//   loop       scripts/check-loop.ts         F3.9 (#11)   pnpm test:loop
//
// A check that isn't built yet, or that can't reach what it measures (no dev server, no Ollama), is left out on
// purpose: the README then says "not measured". A missing number is honest; a 0 is not.
//
// A check reports what it measured on one line, `METRICS {...}` (scripts/metrics-line.ts), and this command merges
// those lines in SPEC order and validates the result against Metrics (lib/contracts.ts), so metrics/latest.json
// always matches the contract the console and the README read. Counts and seconds only: never note, chat or
// canary text.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Metrics } from "@/lib/contracts";
import { MARKER, readMetricsLine, Sections } from "@/scripts/metrics-line";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILE = path.join(ROOT, "metrics", "latest.json");

// One check per row of the README's Numbers table, in the order the table lists them.
type Check = { section: keyof Sections; file: string; does: string };
const CHECKS: Check[] = [
  {
    section: "leaks",
    file: "check-leak.ts",
    does: "pnpm test:leak (F4.4, #28)",
  },
  {
    section: "withdraw",
    file: "check-withdraw.ts",
    does: "10 withdrawal runs (F4.5, #29)",
  },
  {
    section: "citations",
    file: "check-citations.ts",
    does: "seed/questions.csv (F4.5, #29)",
  },
  {
    section: "redaction",
    file: "check-redact.ts",
    does: "pnpm test:redact (F5)",
  },
  {
    section: "loop",
    file: "check-loop.ts",
    does: "pnpm test:loop (F3.9, #11)",
  },
];

// Runs one check with this repo's own env, as `pnpm test:ask` does. Its stdout and stderr are both kept: a failing
// check still reports the numbers it measured (a leak count above 0 is a number the README must show), and anything
// it printed before the METRICS line explains the failure.
function run(file: string): { output: string; failed: boolean } {
  const result = spawnSync(
    process.execPath,
    ["--env-file-if-exists=.env.local", "--import", "tsx", file],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    failed: (result.status ?? 1) !== 0,
  };
}

// The numbers of a section, for the table at the end: never the note or chat text behind them.
function shown(section: keyof Sections, value: unknown): string {
  const found = Sections.shape[section].safeParse(value);
  if (!found.success) return "reported, but not in the contract (left out)";
  const numbers = JSON.stringify(found.data).slice(1, -1);
  return numbers.replaceAll('"', "");
}

async function main(): Promise<void> {
  const measured: Partial<Sections> = {};
  const rows: [keyof Sections, string][] = [];

  for (const check of CHECKS) {
    const file = path.join(ROOT, "scripts", check.file);
    if (!existsSync(file)) {
      console.log(
        `— ${check.section}: not measured — scripts/${check.file} isn't built yet (${check.does})`,
      );
      rows.push([check.section, "not measured (check not built)"]);
      continue;
    }

    console.log(
      `\n=== ${check.section} — scripts/${check.file} (${check.does}) ===`,
    );
    const { output, failed } = run(file);
    // The check's own output, without the METRICS line (that number is shown in the table below).
    const prose = output
      .split(/\r?\n/)
      .filter((line) => !line.startsWith(`${MARKER} `))
      .join("\n")
      .trim();
    if (prose) console.log(prose);

    const reported = readMetricsLine(output);
    const parsed = Sections.safeParse(reported);
    if (!parsed.success) {
      console.log(
        `— ${check.section}: not measured — the check ${
          failed ? "failed" : "printed no valid METRICS line"
        }, so it has no numbers for this section`,
      );
      rows.push([
        check.section,
        failed ? "not measured (check failed)" : "not measured (no numbers)",
      ]);
      continue;
    }
    if (!(check.section in parsed.data)) {
      console.log(
        `— ${check.section}: not measured — the check reported other sections, not this one`,
      );
      rows.push([check.section, "not measured (check reported nothing)"]);
      continue;
    }
    Object.assign(measured, parsed.data);
    rows.push([
      check.section,
      shown(check.section, parsed.data[check.section]),
    ]);
  }

  // SPEC order, whether or not every section is there. measuredAt is now, with this laptop's offset.
  const metrics = Metrics.parse({
    measuredAt: new Date().toISOString(),
    ...measured,
  });
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

  const count = Object.keys(measured).length;
  console.log(`\nmetrics/latest.json — ${count} of ${CHECKS.length} sections:`);
  for (const [section, detail] of rows) {
    console.log(`  ${section.padEnd(10)} ${detail}`);
  }
  console.log(
    count === 0
      ? "Nothing could be measured: the file holds only measuredAt. Bring up the dev server with Ollama, or run a check that needs less."
      : 'A section left out is one no check measured here: the README says "not measured", never 0.',
  );
  process.exitCode = count === 0 ? 1 : 0;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
