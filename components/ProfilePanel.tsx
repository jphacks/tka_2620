"use client";
// /me (docs/DESIGN.md → Profile): who you are at this seat, in the seat's words and never by name: your term as the
// dashed 「あなた」 tag of the lineage rail, your byline (「2026年度 会計」), the group and institution, which holder of
// the seat you are, and your notes here with the way to them. Identity only: the display switches are in SeatBar, and
// there is nothing to set. On mocks the page plays the newcomer (a26).
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { stampRole } from "@/components/review";
import { tagLabel } from "@/components/seat-page";
import { useSeatApi } from "@/components/useSeatApi";
import type { MyNote, SeatView } from "@/lib/contracts";

export function ProfilePanel({ seat: slug }: { seat?: string }) {
  const t = useTranslations();
  const signed = useSeatApi("a26");
  const [view, setView] = useState<SeatView>();
  const [notes, setNotes] = useState<MyNote[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (signed.state !== "ready" || !slug) return;
    let alive = true;
    Promise.all([signed.api.seat(slug), signed.api.myNotes()]).then(
      ([seatView, mine]) => {
        if (!alive) return;
        setView(seatView);
        setNotes(mine.notes.filter((note) => note.seat === slug));
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [signed, slug]);

  const title = (
    <h1 className="dd-h" style={{ fontSize: "var(--text-l)", lineHeight: 1.3 }}>
      {t("profile.title")}
    </h1>
  );
  const calm = (message: string, link?: boolean) => (
    <section className="dd-col" style={{ gap: "var(--s-4)" }}>
      {title}
      <p style={{ margin: 0, color: "var(--ink-2)" }}>{message}</p>
      {link && slug && (
        <Link
          className="dd-btn"
          style={{
            justifySelf: "start",
            display: "inline-grid",
            placeItems: "center",
            textDecoration: "none",
          }}
          href={`/s/${encodeURIComponent(slug)}`}
        >
          {t("profile.toSeat")}
        </Link>
      )}
    </section>
  );

  if (!slug) return calm(t("profile.noSeat"));
  if (signed.state === "signedOut") return calm(t("profile.signedOut"), true);
  if (signed.state === "failed" || failed) return calm(t("profile.failed"));
  if (!view || !notes) {
    return (
      <section className="dd-col" style={{ gap: "var(--s-4)" }}>
        {title}
        <output className="dd-cap">{t("profile.loading")}</output>
      </section>
    );
  }

  const { seat, viewer, lineage } = view;
  const byline =
    viewer.isHolder && viewer.termLabel
      ? t(`seatTypes.${seat.seatType}.byline`, {
          term: viewer.termLabel,
          seat: seat.name,
        })
      : undefined;
  // Which holder of the seat you are: your latest term's place in the lineage, oldest first.
  const place = lineage.findLastIndex((term) => term.isViewer) + 1;
  const live = notes.filter((note) => note.status === "live").length;
  const withdrawn = notes.length - live;
  const digits = viewer.termLabel ? tagLabel(viewer.termLabel).digits : "";
  const role = stampRole(seat.name);

  return (
    <div className="dd-col" style={{ gap: "var(--s-6)" }}>
      <section
        className="dd-col"
        style={{ gap: "var(--s-4)" }}
        aria-label={t("profile.title")}
      >
        {title}
        <div className="dd-me">
          <span className="dd-ltag is-you" aria-hidden="true">
            <span className="dd-ltag-label">
              {/* As on the lineage rail: the term's digits upright, then the role (「26 会計」); someone who never held
                  the seat gets the blank 「あなた」 tag. */}
              {digits ? (
                <>
                  <span className="tcy dd-fig">{digits}</span>
                  {role}
                </>
              ) : (
                t("seat.you")
              )}
            </span>
          </span>
          <div className="dd-col" style={{ gap: "var(--s-1)" }}>
            <p className="dd-me-byline">
              {byline ?? t("profile.notHolder", { seat: seat.name })}
            </p>
            <p style={{ margin: 0 }}>
              <span className="dd-seat-group">{seat.group}</span>
              <br />
              <span className="dd-cap">{seat.institution}</span>
            </p>
            {byline && place > 0 && (
              <p className="dd-cap" style={{ margin: 0 }}>
                {t.rich("profile.place", {
                  n: place,
                  fig: (chunks) => <span className="dd-fig">{chunks}</span>,
                })}
              </p>
            )}
          </div>
        </div>
      </section>

      <section
        className="dd-col"
        style={{ gap: "var(--s-3)" }}
        aria-labelledby="me-notes"
      >
        <h2 id="me-notes" className="dd-h">
          {t("verbs.myNotes")}
        </h2>
        <p style={{ margin: 0 }}>
          {notes.length === 0
            ? t("myNotes.empty")
            : t.rich("profile.noteCounts", {
                live,
                withdrawn,
                fig: (chunks) => <span className="dd-fig">{chunks}</span>,
              })}
        </p>
        <div className="dd-row" style={{ gap: "var(--s-3)" }}>
          <Link
            className="dd-btn"
            style={{
              display: "inline-grid",
              placeItems: "center",
              textDecoration: "none",
            }}
            href={`/me/notes?seat=${encodeURIComponent(seat.slug)}`}
          >
            {t("profile.openNotes")}
          </Link>
          <Link
            className="dd-btn"
            style={{
              display: "inline-grid",
              placeItems: "center",
              textDecoration: "none",
            }}
            href={`/s/${encodeURIComponent(seat.slug)}/guide`}
          >
            {t("guide.open")}
          </Link>
        </div>
      </section>
    </div>
  );
}
