"use client";
// 聞く (/s/[seat]): the club-room key and its notebook. The key tag, then the ask panel, the way into the whole handover
// guide (引き継ぎ書) as a slip that says what it is, the deadlines coming up and the lineage. The field comes first: a tap
// on the key is for asking, and on a phone the start of an answer stays above the verb tabs. It appears once, in its
// place: until the seat has loaded the panel is there but unseen, so nothing jumps under a finger. AskPanel loads the
// seat view (as a26 on mocks, as the signed-in persona on real data) and hands it up, so the page reads
// GET /api/seats/[slug] once.
import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, useRef, useState } from "react";
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
  // The handover guide opens here, under its cover, instead of on its own page: one screen less (Nico's call).
  const [guideOpen, setGuideOpen] = useState(false);
  const guideApi = useMemo(() => api ?? createMockApi("a26"), [api]);
  // The seat didn't load: the panel shows anyway, with its error and retry.
  const [seatFailed, setSeatFailed] = useState(false);
  const onSeatFailed = useCallback(() => setSeatFailed(true), []);
  const ready = view !== undefined || seatFailed;
  // The cover is the guide's disclosure button and, opened, its header: focus stays on it and the guide follows it for
  // the keyboard. Once the guide has loaded, the cover moves up to the top of the screen, so the guide fills it under
  // its header, with 「閉じる」 in reach.
  const cover = useRef<HTMLButtonElement>(null);
  // Loaded, the guide lists the deadlines at its top, and only then does the page's own list step aside: while it
  // loads (or if it fails), the deadlines stay on screen.
  const [guideLoaded, setGuideLoaded] = useState(false);
  const guideReady = useCallback(() => {
    setGuideLoaded(true);
    cover.current?.scrollIntoView({ block: "start" });
  }, []);
  const toggleGuide = (open: boolean) => {
    setGuideOpen(open);
    if (!open) setGuideLoaded(false);
  };
  const coverTitle = useId();
  const coverLead = useId();
  const coverAct = useId();
  return (
    <div className="dd-col dd-seat-home" style={{ gap: "var(--s-6)" }}>
      {view && <SeatHeader seat={view.seat} />}
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
      {view && (
        <>
          {/* Asking one question, or reading everything: the two ways in, side by side */}
          <div className="dd-col dd-guide-wrap">
            <button
              ref={cover}
              type="button"
              className="dd-slip dd-guide-cover"
              aria-expanded={guideOpen}
              aria-controls={guideOpen ? "seat-guide" : undefined}
              aria-labelledby={`${coverTitle} ${coverAct}`}
              aria-describedby={coverLead}
              onClick={() => toggleGuide(!guideOpen)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 6.5C10.5 5.3 8.3 4.8 4 5v13c4.3-.2 6.5.3 8 1.5 1.5-1.2 3.7-1.7 8-1.5V5c-4.3-.2-6.5.3-8 1.5Z" />
                <path d="M12 6.5v13" />
              </svg>
              <span className="dd-guide-cover-text">
                <span id={coverTitle} className="dd-guide-cover-title">
                  {t("title", { seat: view.seat.name })}
                </span>
                <span id={coverLead} className="dd-cap dd-phrase">
                  {t("coverLead")}
                </span>
              </span>
              <span className="dd-guide-cover-act">
                <span id={coverAct}>{t(guideOpen ? "fold" : "read")}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>
            {guideOpen && (
              <section
                id="seat-guide"
                className="dd-col dd-guide-inline"
                aria-label={t("titlePlain")}
              >
                <Guide slug={slug} api={guideApi} inline onReady={guideReady} />
                {/* The end of a long guide: fold it from here too, and land back on the cover */}
                <button
                  type="button"
                  className="dd-link dd-guide-close dd-noprint"
                  onClick={() => {
                    cover.current?.focus();
                    toggleGuide(false);
                  }}
                >
                  {t("close")}
                </button>
              </section>
            )}
          </div>
          {/* Opened and loaded, the guide lists the deadlines at its top, so the page doesn't show them twice */}
          {!(guideOpen && guideLoaded) && (
            <UpcomingList items={view.upcoming} />
          )}
          <LineageRail view={view} />
        </>
      )}
    </div>
  );
}
