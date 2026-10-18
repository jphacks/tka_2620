import { AddPanel } from "@/components/AddPanel";
import { InboxPanel } from "@/components/InboxPanel";
import { SeatSignIn } from "@/components/SeatSignIn";
import { VerbTabs } from "@/components/VerbTabs";
import { USE_MOCKS } from "@/lib/mocks";

export default async function HandoverPage({
  params,
}: PageProps<"/s/[seat]/handover">) {
  const { seat } = await params;
  return (
    <>
      <main
        className="dd-pad dd-with-verbs"
        style={{ maxWidth: "640px", marginInline: "auto" }}
      >
        {/* On mocks as a25; on real data as the account signed in on this device, or the login screen in place
            (components/SeatSignIn.tsx). 残す: newcomers' questions, then 「＋ 追加」 for text, files and chats. */}
        {USE_MOCKS ? (
          <div className="dd-col" style={{ gap: "var(--s-7)" }}>
            <InboxPanel slug={seat} />
            <AddPanel slug={seat} />
          </div>
        ) : (
          <SeatSignIn slug={seat} panel="inbox" />
        )}
      </main>
      <VerbTabs seat={seat} current="handover" />
    </>
  );
}
