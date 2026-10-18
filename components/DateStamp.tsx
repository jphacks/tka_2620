"use client";
// docs/DESIGN.md → Date stamp (日付印): the byline as a red ring in three tiers, the role on top (会計), the year in the
// middle band (figures) and the group at the bottom (Smash). Authorship only. land: the stamp lands, as on publish
// (instantly under prefers-reduced-motion, styles/components.css).
import { useTranslations } from "next-intl";
import { stampGroup, stampYear } from "@/components/review";
import type { SeatView } from "@/lib/contracts";

export function DateStamp({
  seat,
  termLabel,
  land = false,
}: {
  seat: SeatView["seat"];
  termLabel: string;
  land?: boolean;
}) {
  const t = useTranslations();
  const byline = t(`seatTypes.${seat.seatType}.byline`, {
    term: termLabel,
    seat: seat.name,
  });
  return (
    <span
      role="img"
      aria-label={t("live.stamp", { byline })}
      className={`dd-stamp${land ? " is-landing" : ""}`}
    >
      <span aria-hidden="true">{seat.name}</span>
      <span aria-hidden="true" className="dd-stamp-year">
        {stampYear(termLabel)}
      </span>
      <span aria-hidden="true">{stampGroup(seat.group)}</span>
    </span>
  );
}
