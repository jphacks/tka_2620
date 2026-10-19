import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SeatHome } from "@/components/SeatHome";
import { SeatSignIn } from "@/components/SeatSignIn";
import { VerbTabs } from "@/components/VerbTabs";
import { USE_MOCKS } from "@/lib/mocks";
import { seatNames } from "@/lib/seat-title";

// 「会計（テニスサークル Smash）｜代々」: the seat's name and group, or the verb alone when the seat isn't known.
export async function generateMetadata({
  params,
}: PageProps<"/s/[seat]">): Promise<Metadata> {
  const { seat } = await params;
  const [t, names] = await Promise.all([
    getTranslations("meta"),
    seatNames(seat),
  ]);
  return names
    ? { title: t("seat", names), description: t("seatDescription", names) }
    : { title: t("ask") };
}

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
