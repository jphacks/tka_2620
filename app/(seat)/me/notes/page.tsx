import { MyNotesPanel } from "@/components/MyNotesPanel";
import { VerbTabs } from "@/components/VerbTabs";
import { SeatSlug } from "@/lib/contracts";
import { USE_MOCKS } from "@/lib/mocks";

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
        {/* 自分のメモ runs on mocks until the real API client exists. */}
        {USE_MOCKS && <MyNotesPanel />}
      </main>
      {seat && <VerbTabs seat={seat} current="myNotes" />}
    </>
  );
}
