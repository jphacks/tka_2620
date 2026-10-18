"use client";
// 聞く (/s/[seat]): the club-room key and its notebook. The key tag, the lineage, the deadlines coming up, then the
// ask panel. AskPanel loads the seat view (as a26 on mocks, as the signed-in persona on real data) and hands it up, so
// the page reads GET /api/seats/[slug] once.
import { useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { LineageRail } from "@/components/LineageRail";
import { SeatHeader } from "@/components/SeatHeader";
import { UpcomingList } from "@/components/UpcomingList";
import type { Api, SeatView } from "@/lib/contracts";

export function SeatHome({
  slug,
  api,
  mockShortcuts,
}: {
  slug: string;
  /** The signed-in persona's client; mocks as a26 when left out. */
  api?: Api;
  mockShortcuts?: boolean;
}) {
  const [view, setView] = useState<SeatView>();
  return (
    <div className="dd-col" style={{ gap: "var(--s-6)" }}>
      {view && (
        <>
          <SeatHeader seat={view.seat} />
          <LineageRail view={view} />
          <UpcomingList items={view.upcoming} />
        </>
      )}
      <AskPanel
        slug={slug}
        api={api}
        mockShortcuts={mockShortcuts}
        onSeat={setView}
      />
    </div>
  );
}
