import { HandoverGuide } from "@/components/HandoverGuide";
import { VerbTabs } from "@/components/VerbTabs";

// /s/[seat]/guide: the handover guide 引き継ぎ書, opened from 聞く and from /me. Not a fourth verb: the verb tabs stay,
// none of them current. On mocks it reads as a26; on real data as this tab's or this device's user
// (components/useSeatApi.ts).
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
