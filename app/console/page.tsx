import { TrustConsole } from "@/components/TrustConsole";
import { USE_MOCKS } from "@/lib/mocks";

export default function ConsolePage() {
  return (
    <main>
      {/* The three persona panes and the trust proof run on mocks until the real clients exist. */}
      {USE_MOCKS && <TrustConsole />}
    </main>
  );
}
