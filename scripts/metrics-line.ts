// The line a check prints for `pnpm metrics` (scripts/metrics.ts, F4.5 #29). One command produces every number the
// README shows, so each check reports the numbers it measured on one line and metrics/latest.json is put together
// from those lines — never from prose and never from a typed-in number:
//
//   reportMetrics({ leaks: { outsiderAttempts: 50, totalAttempts: 250, found: 0 } });
//   → METRICS {"leaks":{"outsiderAttempts":50,"totalAttempts":250,"found":0}}
//
// Sections is a partial Metrics: report only the sections the check measured. metrics.ts validates every line against
// it before writing, so a typo leaves that section out (the README then says "not measured") instead of putting a
// wrong number on a slide. Every check that feeds the README makes one reportMetrics call: scripts/check-leak.ts
// (F4.4), check-withdraw.ts (F4.2), check-citations.ts (F4.5), check-loop.ts (F3.9), and check-redact.ts once F5.8
// (#38) builds it.
import { Metrics } from "@/lib/contracts";

export const MARKER = "METRICS";

// A partial Metrics, without measuredAt: the sections one check owns.
export const Sections = Metrics.omit({ measuredAt: true });
export type Sections = Omit<Metrics, "measuredAt">;

export function reportMetrics(sections: Sections): void {
  console.log(`${MARKER} ${JSON.stringify(sections)}`);
}

// The last METRICS line in a check's output, parsed; undefined when it printed none. metrics.ts reads stdout through
// this, so a check may log whatever it likes before and after.
export function readMetricsLine(output: string): unknown {
  const lines = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${MARKER} `));
  const last = lines.at(-1);
  if (!last) return undefined;
  try {
    return JSON.parse(last.slice(MARKER.length + 1));
  } catch {
    return undefined;
  }
}
