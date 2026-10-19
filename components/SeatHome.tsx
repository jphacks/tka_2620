"use client";
// 聞く (/s/[seat]): the club-room key and its notebook. Top to bottom:
// 1. the key tag
// 2. the lineage, then the deadlines coming up, above the ask field (Nico's call)
// 3. the ask field
// 4. right under it, the way into the whole handover guide (引き継ぎ書): a cover that opens it as a reading sheet over
//    the page (GuideSheet), so 聞く itself never moves. Under the field rather than above it, so the field stays above
//    the verb tabs on a 664px phone.
// 5. the answers
// It all appears once, in its place: until the seat has loaded the panel is there but unseen, so nothing jumps under a
// finger. AskPanel loads the seat view (as a26 on mocks, as the signed-in persona on real data) and hands it up, so the
// page reads GET /api/seats/[slug] once.
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { GuideSheet } from "@/components/GuideSheet";
import { LineageRail } from "@/components/LineageRail";
import { SeatHeader } from "@/components/SeatHeader";
import { UpcomingList } from "@/components/UpcomingList";
import type { Api, SeatView } from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";

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
  const t = useTranslations("guide");
  const [view, setView] = useState<SeatView>();
  const guideApi = useMemo(() => api ?? createMockApi("a26"), [api]);
  // The seat didn't load: the panel shows anyway, with its error and retry.
  const [seatFailed, setSeatFailed] = useState(false);
  const onSeatFailed = useCallback(() => setSeatFailed(true), []);
  const ready = view !== undefined || seatFailed;
  return (
    <div className="dd-col dd-seat-home" style={{ gap: "var(--s-6)" }}>
      {view && (
        <>
          <SeatHeader seat={view.seat} />
          <LineageRail view={view} />
          <UpcomingList items={view.upcoming} />
        </>
      )}
      {!ready && <output className="dd-cap">{t("loading")}</output>}
      <div
        style={ready ? undefined : { visibility: "hidden" }}
        aria-hidden={ready ? undefined : true}
      >
        <AskPanel
          slug={slug}
          api={api}
          mockShortcuts={mockShortcuts}
          onSeat={setView}
          onSeatFailed={onSeatFailed}
          belowField={
            view && (
              <GuideSheet
                slug={slug}
                api={guideApi}
                seatName={view.seat.name}
              />
            )
          }
        />
      </div>
    </div>
  );
}
