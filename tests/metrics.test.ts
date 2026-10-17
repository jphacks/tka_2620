// metrics/latest.json is committed and read by the console's leak counter (app/console/page.tsx) and the README. A file
// that doesn't match the contract would make the counter say the test never ran, so check it here. Skipped until
// `pnpm metrics` (F4.5) writes the file.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Metrics } from "@/lib/contracts";

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
