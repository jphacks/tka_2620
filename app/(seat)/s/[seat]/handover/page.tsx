import { InboxPanel } from "@/components/InboxPanel";
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
      {/* The inbox runs on mocks until the real API client exists. */}
      {USE_MOCKS && <InboxPanel slug={seat} />}
    </main>
  );
}
