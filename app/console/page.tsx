import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConsoleSignIn } from "@/components/ConsoleSignIn";
import { Metrics } from "@/lib/contracts";

// The leak counter and 「測定の内訳」 show what the checks measured (`pnpm metrics` → metrics/latest.json, committed), never
// a number typed into the screen. No file yet, or one that doesn't match the contract: they say the tests haven't run.
async function measured(): Promise<Metrics | undefined> {
  try {
    const file = path.join(process.cwd(), "metrics", "latest.json");
    return Metrics.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined;
  }
}

export default async function ConsolePage() {
  const metrics = await measured();
  return (
    <main>
      {/* Three persona panes, each signed in on its own client (or the mocks), and the trust proof. */}
      <ConsoleSignIn metrics={metrics} />
    </main>
  );
}
