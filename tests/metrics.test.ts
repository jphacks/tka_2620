// metrics/latest.json is committed and read by the console's leak counter (app/console/page.tsx) and the README. A file
// that doesn't match the contract would make the counter say the test never ran, so check it here. Skipped until
// `pnpm metrics` (F4.5) writes the file.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Metrics } from "@/lib/contracts";
import { readMetricsLine, Sections } from "@/scripts/metrics-line";

const file = path.join(process.cwd(), "metrics", "latest.json");

describe("metrics/latest.json", () => {
  it.skipIf(!existsSync(file))("matches the Metrics contract", () => {
    const parsed = Metrics.safeParse(JSON.parse(readFileSync(file, "utf8")));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("accepts the leak test's numbers and nothing else yet", () => {
    expect(
      Metrics.parse({
        measuredAt: "2026-10-18T09:00:00+09:00",
        leaks: { outsiderAttempts: 50, totalAttempts: 250, found: 0 },
      }).leaks,
    ).toEqual({ outsiderAttempts: 50, totalAttempts: 250, found: 0 });
    expect(
      Metrics.safeParse({
        measuredAt: "2026-10-18T09:00:00+09:00",
        leaks: { outsiderAttempts: 50, totalAttempts: 250, found: -1 },
      }).success,
    ).toBe(false);
  });
});

// pnpm metrics (scripts/metrics.ts) puts the file together from each check's METRICS line, so a line it misreads would
// put a wrong number in the README, or leave out a right one.
describe("the METRICS line a check prints (scripts/metrics-line.ts)", () => {
  it("reads the check's last METRICS line, whatever else it printed", () => {
    const output = [
      "✓ run 1: 0.31 s",
      'METRICS {"withdraw":{"runs":1,"medianS":9,"maxS":9}}',
      "✓ run 10: 0.29 s",
      'METRICS {"withdraw":{"runs":10,"medianS":0.3,"maxS":0.41}}',
      "✓ #26 check: 25 checks, all passed",
    ].join("\n");
    expect(readMetricsLine(output)).toEqual({
      withdraw: { runs: 10, medianS: 0.3, maxS: 0.41 },
    });
  });

  it("reads nothing from a check that printed no line, or a broken one", () => {
    expect(readMetricsLine("✗ withdrawing answered HTTP 503")).toBeUndefined();
    expect(readMetricsLine('METRICS {"leaks":')).toBeUndefined();
    // Not at the start of a line: a log that happens to mention the marker isn't a report.
    expect(readMetricsLine('  see METRICS {"leaks":{}}')).toBeUndefined();
  });

  it("keeps a section only when it matches the contract", () => {
    const leaks = { outsiderAttempts: 95, totalAttempts: 556, found: 0 };
    expect(Sections.parse({ leaks }).leaks).toEqual(leaks);
    // A misspelt section is dropped, so metrics.ts finds no numbers for it and says "not measured".
    expect(Sections.parse({ leak: leaks })).toEqual({});
    expect(
      Sections.safeParse({ citations: { sentences: 4, cited: 4.5 } }).success,
    ).toBe(false);
  });
});
