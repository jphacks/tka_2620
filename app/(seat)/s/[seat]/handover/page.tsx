import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HandoverColumn } from "@/components/HandoverColumn";
import { SeatSignIn } from "@/components/SeatSignIn";
import { VerbTabs } from "@/components/VerbTabs";
import { USE_MOCKS } from "@/lib/mocks";
import { seatNames } from "@/lib/seat-title";

export async function generateMetadata({
  params,
}: PageProps<"/s/[seat]/handover">): Promise<Metadata> {
  const { seat } = await params;
  const [t, names] = await Promise.all([
    getTranslations("meta"),
    seatNames(seat),
  ]);
  return { title: names ? t("handover", names) : t("handoverPlain") };
}

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
            (components/SeatSignIn.tsx). 残す: newcomers' questions, the handover prompts, then 「＋ 追加」 for text,
            files and chats. */}
        {USE_MOCKS ? (
          <HandoverColumn slug={seat} />
        ) : (
          <SeatSignIn slug={seat} panel="inbox" />
        )}
      </main>
      <VerbTabs seat={seat} current="handover" />
    </>
  );
}
