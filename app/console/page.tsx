import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConsoleSignIn } from "@/components/ConsoleSignIn";
import { Metrics } from "@/lib/contracts";

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
      {/* Three persona panes, each signed in on its own client (or the mocks), and the trust proof. */}
      <ConsoleSignIn leaks={leaks} />
    </main>
  );
}
