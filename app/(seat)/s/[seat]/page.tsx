import { AskPanel } from "@/components/AskPanel";
import { USE_MOCKS } from "@/lib/mocks";

export default async function SeatPage({ params }: PageProps<"/s/[seat]">) {
  const { seat } = await params;
  return (
    <main
      className="dd-pad"
      style={{ maxWidth: "640px", marginInline: "auto" }}
    >
      {/* The ask box runs on mocks until the real API client exists. */}
      {USE_MOCKS && <AskPanel slug={seat} />}
    </main>
  );
}
