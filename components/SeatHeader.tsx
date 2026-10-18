"use client";
// docs/DESIGN.md → SeatHeader: the club-room key on its tag. The seat name in Yusei Magic on the tag is the page's
// heading, with a ring through the punched hole; beside it the seat type's line icon, the group and the institution
// in UI text. Seat types get an icon, never a colour; the label pack names it (seatTypes.<type>.seat).
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { SeatType, SeatView } from "@/lib/contracts";

// club = flag, exchange = route, lab = flask, drawn on a 24px grid in the line's colour.
const icons: Record<SeatType, ReactNode> = {
  club_role: (
    <>
      <path d="M6 21V3.5" />
      <path d="M6 4h11.5l-2.5 4 2.5 4H6" />
    </>
  ),
  exchange_route: (
    <>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16" />
    </>
  ),
  lab_duty: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6.5L4.6 18.8A1.5 1.5 0 0 0 5.9 21h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3" />
      <path d="M7.3 15h9.4" />
    </>
  ),
};

export function SeatHeader({ seat }: { seat: SeatView["seat"] }) {
  const t = useTranslations();
  return (
    <header className="dd-seat-head">
      <div className="dd-tag">
        <span className="dd-tag-ring" aria-hidden="true" />
        <h1 className="dd-tag-name">{seat.name}</h1>
      </div>
      <div className="dd-seat-where">
        <svg
          role="img"
          aria-label={t(`seatTypes.${seat.seatType}.seat`)}
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icons[seat.seatType]}
        </svg>
        <p>
          <span className="dd-seat-group">{seat.group}</span>
          <span className="dd-cap">{seat.institution}</span>
        </p>
      </div>
    </header>
  );
}
