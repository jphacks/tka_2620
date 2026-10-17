// #29 acceptance check (docs/SPEC.md → "Numbers for the README", F4.5): one command produces every number the README
// shows and writes them to metrics/latest.json (committed) for the README and for the console's leak counter.
//
//   pnpm dev            (in another terminal, with Ollama and the Claude key)
//   pnpm metrics        (about six minutes; ends with pnpm demo:reset, see below)
//
// Each number comes from the check that measures it (docs/README-SECTIONS.md → "How measured"), run here one after
// another. The numbers are that check's, never typed in:
//
//   leaks      scripts/check-leak.ts         F4.4 (#28)   pnpm test:leak
//   withdraw   scripts/check-withdraw.ts     F4.2 (#26)   pnpm test:withdraw, ten runs
//   citations  scripts/check-citations.ts    F4.5 (#29)   seed/questions.csv
//   redaction  scripts/check-redact.ts       F5.8 (#38)   pnpm test:redact
//   loop       scripts/check-loop.ts         F3.9 (#11)   pnpm test:loop
//
// The loop check runs last on purpose: it ends with `pnpm demo:reset`, which puts the demo data back and recreates the
// demo users, so every phone and console pane signs in again afterwards. The others need the seed state it leaves
// (the leak and citations checks refuse to start otherwise), and each removes what it created.
// A check that isn't built yet, or that can't reach what it measures (no dev server, no Ollama), is left out on
// purpose: the README then says "not measured". A missing number is honest; a 0 is not.
//
// A check reports what it measured on one line, `METRICS {...}` (scripts/metrics-line.ts), and this command merges
// those lines in SPEC order and validates the result against Metrics (lib/contracts.ts), so metrics/latest.json
// always matches the contract the console and the README read. Counts and seconds only: never note, chat or
// canary text.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Metrics } from "@/lib/contracts";
import { MARKER, readMetricsLine, Sections } from "@/scripts/metrics-line";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILE = path.join(ROOT, "metrics", "latest.json");

// One check per row of the README's Numbers table, in the order the table lists them (the loop last, see above).
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
    does: "10 withdrawal runs, pnpm test:withdraw (F4.2, #26)",
  },
  {
    section: "citations",
    file: "check-citations.ts",
    does: "seed/questions.csv (F4.5, #29)",
  },
  {
    section: "redaction",
    file: "check-redact.ts",
    does: "pnpm test:redact (F5.8, #38)",
  },
  {
    section: "loop",
    file: "check-loop.ts",
    does: "pnpm test:loop (F3.9, #11), then pnpm demo:reset",
  },
];

// Runs one check with this repo's own env, as `pnpm test:ask` does, and shows its output as it comes (the leak and
// loop checks take minutes), except the METRICS line: that number is shown in the table at the end. Both streams are
// shown: a failing check still reports the numbers it measured (a leak count above 0 is a number the README must
// show), and anything it printed explains the failure. The METRICS line is read from stdout only, and each stream has
// its own line buffer, so a line cut between two chunks is never mixed with the other stream's output.
let running: ChildProcess | undefined;
function run(file: string): Promise<{ stdout: string; failed: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env.local", "--import", "tsx", file],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    running = child;
    let stdout = "";
    const relay = (stream: Readable, keep: boolean) => {
      let pending = "";
      stream.setEncoding("utf8"); // a character cut between two chunks stays whole
      stream.on("data", (text: string) => {
        if (keep) stdout += text;
        pending += text;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith(`${MARKER} `)) console.log(line);
        }
      });
      stream.on("end", () => {
        if (pending && !pending.startsWith(`${MARKER} `)) console.log(pending);
      });
    };
    relay(child.stdout, true);
    relay(child.stderr, false);
    child.on("error", () => resolve({ stdout, failed: true }));
    child.on("close", (code) => {
      running = undefined;
      resolve({ stdout, failed: code !== 0 });
    });
  });
}

// Ctrl-C reaches the running check as well (same terminal): every check stops after what it has in flight and cleans
// up. This command waits for it, starts nothing more, and leaves metrics/latest.json as it was. A SIGTERM reaches
// only this process, so it is passed on.
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!interrupted) {
      console.log(
        `\n${signal}: stopping after the check that is running (it cleans up first); latest.json stays as it was`,
      );
    }
    interrupted = true;
    if (signal === "SIGTERM") running?.kill(signal);
  });
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
  let missing = 0; // built checks that measured nothing
  let failures = 0; // checks that measured their section but failed something else (see their output)

  console.log(
    "pnpm metrics: the checks below run one after another; the last one resets the demo (pnpm demo:reset).",
  );
  for (const check of CHECKS) {
    if (interrupted) break;
    const file = path.join(ROOT, "scripts", check.file);
    if (!existsSync(file)) {
      console.log(
        `\n— ${check.section}: not measured — scripts/${check.file} isn't built yet (${check.does})`,
      );
      rows.push([check.section, "not measured (check not built yet)"]);
      continue;
    }

    console.log(
      `\n=== ${check.section} — scripts/${check.file} (${check.does}) ===`,
    );
    const { stdout, failed } = await run(file);
    const reported = readMetricsLine(stdout);
    const parsed = Sections.safeParse(reported);
    if (!parsed.success || !(check.section in parsed.data)) {
      missing += 1;
      console.log(
        `— ${check.section}: not measured — the check ${
          failed ? "failed" : "printed no METRICS line for this section"
        }, so it has no numbers for it`,
      );
      rows.push([
        check.section,
        failed ? "not measured (check failed)" : "not measured (no numbers)",
      ]);
      continue;
    }
    // Only the section this check owns: a check can't overwrite another's numbers.
    Object.assign(measured, { [check.section]: parsed.data[check.section] });
    if (failed) failures += 1;
    rows.push([
      check.section,
      `${shown(check.section, parsed.data[check.section])}${failed ? " (the check failed: see above)" : ""}`,
    ]);
  }

  if (interrupted) {
    console.log("\nStopped: metrics/latest.json is as it was.");
    process.exitCode = 1;
    return;
  }

  // SPEC order, whether or not every section is there. measuredAt is now, in UTC.
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
    'A section left out is one no check measured here: the README says "not measured", never 0.',
  );
  // 0 only when every check that exists measured its section and passed; a check not built yet doesn't fail the run.
  // A check that measured but failed keeps its numbers in the file (a leak count is the truth), and fails the run.
  if (failures > 0) {
    console.log(
      `${failures} check(s) measured their numbers but failed something else: see their output above.`,
    );
  }
  process.exitCode = missing === 0 && failures === 0 && count > 0 ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
