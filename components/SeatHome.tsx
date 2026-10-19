"use client";
// 聞く (/s/[seat]): the club-room key and its notebook. The key tag, the lineage, the deadlines coming up and the way to
// the whole handover guide (引き継ぎ書), then the ask panel, and the guide below it when opened. The ask field appears
// once, in its place: until the seat has loaded the panel is there but unseen, so nothing jumps under a finger. AskPanel loads the seat view (as a26 on mocks, as the signed-in persona on real data) and hands it up, so
// the page reads GET /api/seats/[slug] once.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { Guide } from "@/components/HandoverGuide";
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
  // The handover guide opens here, below the ask panel, instead of on its own page: one screen less (Nico's call).
  const [guideOpen, setGuideOpen] = useState(false);
  const guideApi = useMemo(() => api ?? createMockApi("a26"), [api]);
  // The seat didn't load: the panel shows anyway, with its error and retry.
  const [seatFailed, setSeatFailed] = useState(false);
  const onSeatFailed = useCallback(() => setSeatFailed(true), []);
  const ready = view !== undefined || seatFailed;
  // Opened, the guide takes focus (and its title comes into view), so a keyboard or screen reader lands on it, not the
  // page top. Once loaded, its top moves up to the top of the screen: under a long answer history, focus alone leaves
  // only the title showing, just above the verb tabs, and while loading the page isn't tall enough to scroll that far.
  const guide = useRef<HTMLElement>(null);
  useEffect(() => {
    if (guideOpen) guide.current?.focus();
  }, [guideOpen]);
  const guideReady = useCallback(
    () => guide.current?.scrollIntoView({ block: "start" }),
    [],
  );
  return (
    <div className="dd-col dd-seat-home" style={{ gap: "var(--s-6)" }}>
      {view && (
        <>
          <SeatHeader seat={view.seat} />
          <LineageRail view={view} />
          {/* The way to the whole guide belongs to the deadlines above it, not to the ask field below */}
          <div className="dd-col dd-guide-wrap" style={{ gap: "var(--s-2)" }}>
            <UpcomingList items={view.upcoming} />
            <button
              type="button"
              className="dd-link dd-guide-link"
              aria-expanded={guideOpen}
              aria-controls={guideOpen ? "seat-guide" : undefined}
              onClick={() => setGuideOpen((open) => !open)}
            >
              {t(guideOpen ? "close" : "open")}
            </button>
          </div>
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
        />
      </div>
      {/* The guide opens below the ask panel, so the field stays near the top and comes before it for the keyboard */}
      {guideOpen && view && (
        <section
          id="seat-guide"
          ref={guide}
          tabIndex={-1}
          className="dd-guide-inline"
          aria-label={t("titlePlain")}
        >
          <Guide slug={slug} api={guideApi} inline onReady={guideReady} />
        </section>
      )}
    </div>
  );
}
