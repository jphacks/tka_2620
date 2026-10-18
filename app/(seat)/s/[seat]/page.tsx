import { SeatHome } from "@/components/SeatHome";
import { SeatSignIn } from "@/components/SeatSignIn";
import { VerbTabs } from "@/components/VerbTabs";
import { USE_MOCKS } from "@/lib/mocks";

export default async function SeatPage({ params }: PageProps<"/s/[seat]">) {
  const { seat } = await params;
  return (
    <>
      <main
        className="dd-pad dd-with-verbs"
        style={{ maxWidth: "640px", marginInline: "auto" }}
      >
        {/* On mocks as a26; on real data as the account signed in on this device, or the login screen in place
            (components/SeatSignIn.tsx). 聞く: the key tag, the lineage and the deadlines coming up, then the ask field. */}
        {USE_MOCKS ? (
          <SeatHome slug={seat} />
        ) : (
          <SeatSignIn slug={seat} panel="ask" />
        )}
      </main>
      <VerbTabs seat={seat} current="ask" />
    </>
  );
}
