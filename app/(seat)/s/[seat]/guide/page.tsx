import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HandoverGuide } from "@/components/HandoverGuide";
import { VerbTabs } from "@/components/VerbTabs";
import { seatNames } from "@/lib/seat-title";

export async function generateMetadata({
  params,
}: PageProps<"/s/[seat]/guide">): Promise<Metadata> {
  const { seat } = await params;
  const [t, names] = await Promise.all([
    getTranslations("meta"),
    seatNames(seat),
  ]);
  return { title: names ? t("guide", names) : t("guidePlain") };
}

// /s/[seat]/guide: the handover guide 引き継ぎ書, opened from 聞く and from /me. Not a fourth verb: the verb tabs stay,
// none of them current. On mocks it reads as a26; on real data as the account signed in on this device, or the
// login screen in place (components/SignInGate.tsx).
export default async function GuidePage({
  params,
}: PageProps<"/s/[seat]/guide">) {
  const { seat } = await params;
  return (
    <>
      <main
        className="dd-pad dd-with-verbs"
        style={{ maxWidth: "640px", marginInline: "auto" }}
      >
        <HandoverGuide slug={seat} />
      </main>
      <VerbTabs seat={seat} />
    </>
  );
}
