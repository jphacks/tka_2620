"use client";
// docs/DESIGN.md → UpcomingList: the deadlines coming up as a planner column (GET /api/seats/[slug] → upcoming, soonest
// first): the date boxed in figures (「10/20 火」), the note's title, and the mini stamp of whose note it is. Dates
// within a week of Tokyo's today carry the highlighter. Nothing at all when the viewer reads no deadline here (an
// outsider): no heading over an empty list.
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import {
  isSoon,
  plannerDate,
  stampDigits,
  tokyoToday,
} from "@/components/seat-page";
import type { SeatView } from "@/lib/contracts";

export function UpcomingList({ items }: { items: SeatView["upcoming"] }) {
  const t = useTranslations();
  const locale = useLocale();
  const headingId = useId();
  if (items.length === 0) return null;
  const today = tokyoToday();

  return (
    <section aria-labelledby={headingId} className="dd-col">
      <h2 id={headingId} className="dd-h">
        {t("seat.upcoming")}
      </h2>
      <ol className="dd-planner">
        {items.map((item) => {
          const { monthDay, weekday } = plannerDate(item.date, locale);
          return (
            <li key={item.noteId} className="dd-planner-row">
              <time dateTime={item.date} className="dd-date">
                <span
                  className={isSoon(item.date, today) ? "dd-marker" : undefined}
                >
                  {t("seat.upcomingDate", { date: monthDay, weekday })}
                </span>
              </time>
              <span className="dd-planner-title" lang={item.lang}>
                {item.title}
              </span>
              <span
                role="img"
                aria-label={t("live.stamp", { byline: item.byline })}
                className="dd-mini"
              >
                {stampDigits(item.byline)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
