import { MyNotesPanel } from "@/components/MyNotesPanel";
import { USE_MOCKS } from "@/lib/mocks";

export default function MyNotesPage() {
  return (
    <main
      className="dd-pad"
      style={{ maxWidth: "640px", marginInline: "auto" }}
    >
      {/* 自分のメモ runs on mocks until the real API client exists. */}
      {USE_MOCKS && <MyNotesPanel />}
    </main>
  );
}
