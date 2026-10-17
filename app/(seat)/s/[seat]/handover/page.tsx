import { InboxPanel } from "@/components/InboxPanel";
import { SeatSignIn } from "@/components/SeatSignIn";
import { USE_MOCKS } from "@/lib/mocks";

export default async function HandoverPage({
  params,
}: PageProps<"/s/[seat]/handover">) {
  const { seat } = await params;
  return (
    <main
      className="dd-pad"
      style={{ maxWidth: "640px", marginInline: "auto" }}
    >
      {/* On mocks as a25; on real data as the persona in #key=…&as=… (components/SeatSignIn.tsx). */}
      {USE_MOCKS ? (
        <InboxPanel slug={seat} />
      ) : (
        <SeatSignIn slug={seat} panel="inbox" />
      )}
    </main>
  );
}
