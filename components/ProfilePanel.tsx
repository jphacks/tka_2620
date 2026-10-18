"use client";
// /me (docs/DESIGN.md → Profile): who you are at this seat, in the seat's words and never by name: your term as the
// dashed 「あなた」 tag of the lineage rail, your byline (「2026年度 会計」), the group and institution, which holder of
// the seat you are, and your notes here with the way to them. Identity only: the display switches are in SeatBar, and
// there is nothing to set. On mocks the page plays the newcomer (a26); on real data it is the account signed in on this
// device, or the login screen in place (components/SignInGate.tsx, whose foot says which account and 「切り替える」).
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { RetryLine } from "@/components/RetryLine";
import { stampRole } from "@/components/review";
import { SignInGate } from "@/components/SignInGate";
import { tagLabel } from "@/components/seat-page";
import { accountLabel } from "@/components/sign-in";
import type { Api, DemoAccount, MyNote, SeatView } from "@/lib/contracts";
import { createMockApi, USE_MOCKS } from "@/lib/mocks";

export function ProfilePanel({ seat }: { seat?: string }) {
  const mock = useMemo(
    () => (USE_MOCKS ? createMockApi("a26") : undefined),
    [],
  );
  if (mock) return <Profile slug={seat} api={mock} account="a26" />;
  return (
    <SignInGate>
      {({ api, account }) => (
        <Profile slug={seat} api={api} account={account} />
      )}
    </SignInGate>
  );
}

function Profile({
  slug,
  api,
  account,
}: {
  slug?: string;
  api: Api;
  account: DemoAccount;
}) {
  const t = useTranslations();
  const [view, setView] = useState<SeatView>();
  const [notes, setNotes] = useState<MyNote[]>();
  const [failed, setFailed] = useState(false);
  const [loadTry, setLoadTry] = useState(0); // the retry button reads again

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadTry is the retry button's way to read again
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    Promise.all([api.seat(slug), api.myNotes()]).then(
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
  }, [api, slug, loadTry]);

  const title = (
    <h1 className="dd-h" style={{ fontSize: "var(--text-l)", lineHeight: 1.3 }}>
      {t("profile.title")}
    </h1>
  );
  const calm = (message: string) => (
    <section className="dd-col" style={{ gap: "var(--s-4)" }}>
      {title}
      <p style={{ margin: 0, color: "var(--ink-2)" }}>{message}</p>
    </section>
  );

  if (!slug) return calm(t("profile.noSeat"));
  if (failed) {
    return (
      <section className="dd-col" style={{ gap: "var(--s-4)" }}>
        {title}
        <RetryLine
          message={t("profile.failed")}
          onRetry={() => {
            setFailed(false);
            setLoadTry((n) => n + 1);
          }}
        />
      </section>
    );
  }
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
  // Someone who never held the seat is named as the login screen names them (「やまて大学の学生」).
  const label = accountLabel(account);
  const who = t(label.key, label.values);
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
            <p className="dd-me-byline">{byline ?? who}</p>
            {!byline && (
              <p className="dd-cap" style={{ margin: 0 }}>
                {t("profile.notHolder", { seat: seat.name })}
              </p>
            )}
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
