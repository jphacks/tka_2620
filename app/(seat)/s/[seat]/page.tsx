import { LiveAnswerDemo } from "@/components/LiveAnswerDemo";
import { USE_MOCKS } from "@/lib/mocks";

export default function SeatPage() {
  // F3.1 (#3) turns this page into the real AskField + AbstainEntry screen; until then, with
  // NEXT_PUBLIC_USE_MOCKS=1 the newcomer half of the live loop (#6) runs in a demo harness.
  if (!USE_MOCKS) return <main />;
  return (
    <main className="dd-pad">
      <LiveAnswerDemo />
    </main>
  );
}
