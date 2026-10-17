import { readFile } from "node:fs/promises";
import path from "node:path";
import { TrustConsole } from "@/components/TrustConsole";
import { Metrics } from "@/lib/contracts";
import { USE_MOCKS } from "@/lib/mocks";

// The leak counter shows what the leak test measured (`pnpm metrics` → metrics/latest.json, committed), never a
// number typed into the screen. No file yet, or one that doesn't match the contract: the counter says the test hasn't
// run.
async function measuredLeaks(): Promise<Metrics["leaks"]> {
  try {
    const file = path.join(process.cwd(), "metrics", "latest.json");
    return Metrics.parse(JSON.parse(await readFile(file, "utf8"))).leaks;
  } catch {
    return undefined;
  }
}

export default async function ConsolePage() {
  const leaks = await measuredLeaks();
  return (
    <main>
      {/* The three persona panes and the trust proof run on mocks until the real clients exist. */}
      {USE_MOCKS && <TrustConsole leaks={leaks} />}
    </main>
  );
}
