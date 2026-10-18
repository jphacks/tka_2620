import { MyNotesPanel } from "@/components/MyNotesPanel";
import { VerbTabs } from "@/components/VerbTabs";
import { SeatSlug } from "@/lib/contracts";

export default async function MyNotesPage({
  searchParams,
}: PageProps<"/me/notes">) {
  // 自分のメモ isn't under a seat: the verb tabs bring the seat along (?seat=), so 聞く and 残す link back to it.
  const seat = SeatSlug.safeParse((await searchParams).seat).data;
  return (
    <>
      <main
        className={`dd-pad${seat ? " dd-with-verbs" : ""}`}
        style={{ maxWidth: "640px", marginInline: "auto" }}
      >
        {/* On mocks as a25; on real data as this tab's or this device's user (components/useSeatApi.ts). */}
        <MyNotesPanel seat={seat} />
      </main>
      {seat && <VerbTabs seat={seat} current="myNotes" />}
    </>
  );
}
