import { ProfilePanel } from "@/components/ProfilePanel";
import { VerbTabs } from "@/components/VerbTabs";
import { SeatSlug } from "@/lib/contracts";

// /me: who you are at the seat you came from (SeatBar's 「あなた」 brings it along as ?seat=). Not a fourth verb: the verb
// tabs stay, with none of them current.
export default async function ProfilePage({ searchParams }: PageProps<"/me">) {
  const seat = SeatSlug.safeParse((await searchParams).seat).data;
  return (
    <>
      <main
        className={`dd-pad${seat ? " dd-with-verbs" : ""}`}
        style={{ maxWidth: "640px", marginInline: "auto" }}
      >
        <ProfilePanel seat={seat} />
      </main>
      {seat && <VerbTabs seat={seat} />}
    </>
  );
}
