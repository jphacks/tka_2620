"use client";
// docs/DESIGN.md → LineageRail (歴代の札): one small key tag per term, oldest left, newest right, each labelled
// vertically in Yusei Magic (「24 会計」); the viewer's own term is the dashed blank tag 「あなた」. Terms only, never who
// held them (seat_lineage, 0003). Someone who holds no term at the seat gets no tag: opening the page joins nothing.
import { useTranslations } from "next-intl";
import { useId } from "react";
import { stampRole } from "@/components/review";
import { tagLabel } from "@/components/seat-page";
import type { SeatView } from "@/lib/contracts";

export function LineageRail({ view }: { view: SeatView }) {
  const t = useTranslations();
  const headingId = useId();
  const { seat, lineage } = view;
  if (lineage.length === 0) return null;
  const role = stampRole(seat.name);
  // A Latin role of up to three letters (TUM) stands upright as one unit; a longer one runs sideways, as Latin does in
  // vertical text.
  const upright = /^[A-Za-z]{1,3}$/.test(role);
  // The seat's current term reads in full ink, unless it is the viewer's own tag.
  const newest = lineage[lineage.length - 1];

  return (
    <section aria-labelledby={headingId} className="dd-col">
      <h2 id={headingId} className="dd-h">
        {t(`seatTypes.${seat.seatType}.lineage`, { seat: seat.name })}
      </h2>
      <ol className="dd-rail">
        {lineage.map((term) => {
          const name = t(`seatTypes.${seat.seatType}.term`, {
            term: term.termLabel,
          });
          if (term.isViewer) {
            return (
              <li key={`${term.termOrder}-${term.termLabel}`}>
                <span
                  role="img"
                  aria-label={t("seat.youAt", { term: name })}
                  className="dd-ltag is-you"
                >
                  <span aria-hidden="true" className="dd-ltag-label">
                    {t("seat.you")}
                  </span>
                </span>
              </li>
            );
          }
          const { digits, rest } = tagLabel(term.termLabel);
          return (
            <li key={`${term.termOrder}-${term.termLabel}`}>
              <span
                role="img"
                aria-label={name}
                className={`dd-ltag${term === newest ? " is-current" : ""}`}
              >
                <span aria-hidden="true" className="dd-ltag-label">
                  {/* The digits in the figures face, as on the date stamp: Yusei Magic's combined digits sit off-centre. */}
                  {digits && <span className="tcy dd-fig">{digits}</span>}
                  {rest} {upright ? <span className="tcy">{role}</span> : role}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
