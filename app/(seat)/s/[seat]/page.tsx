import { AskPanel } from "@/components/AskPanel";
import { SeatSignIn } from "@/components/SeatSignIn";
import { USE_MOCKS } from "@/lib/mocks";

export default async function SeatPage({ params }: PageProps<"/s/[seat]">) {
  const { seat } = await params;
  return (
    <main
      className="dd-pad"
      style={{ maxWidth: "640px", marginInline: "auto" }}
    >
      {/* On mocks as a26; on real data as the persona in #key=…&as=… (components/SeatSignIn.tsx). */}
      {USE_MOCKS ? (
        <AskPanel slug={seat} />
      ) : (
        <SeatSignIn slug={seat} panel="ask" />
      )}
    </main>
  );
}
