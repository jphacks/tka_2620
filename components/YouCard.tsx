"use client";
// docs/DESIGN.md → 自分のメモ: who you are at the seat you came from, at the top of your notes, in the seat's words and
// never by name. Your term as the lineage rail's dashed tag (「26 会計」), your byline (「2026年度 会計」), the group and
// institution, and which holder of the seat you are (「この席の3代目です」). Someone who never held the seat is named as
// the login screen names them (「やまて大学の学生」). Identity only: there is nothing to set, and switching the account is
// 「あなた」 in the bar.
import { useTranslations } from "next-intl";
import { stampRole } from "@/components/review";
import { tagLabel } from "@/components/seat-page";
import { accountLabel } from "@/components/sign-in";
import type { DemoAccount, SeatView } from "@/lib/contracts";

export function YouCard({
  view,
  account,
}: {
  view: SeatView;
  account: DemoAccount;
}) {
  const t = useTranslations();
  const { seat, viewer, lineage } = view;
  const byline =
    viewer.isHolder && viewer.termLabel
      ? t(`seatTypes.${seat.seatType}.byline`, {
          term: viewer.termLabel,
          seat: seat.name,
        })
      : undefined;
  const label = accountLabel(account);
  const who = t(label.key, label.values);
  // Which holder of the seat you are: your latest term's place in the lineage, oldest first.
  const place = lineage.findLastIndex((term) => term.isViewer) + 1;
  const digits = viewer.termLabel ? tagLabel(viewer.termLabel).digits : "";
  const role = stampRole(seat.name);
  return (
    <div className="dd-me">
      <span className="dd-ltag is-you" aria-hidden="true">
        <span className="dd-ltag-label">
          {/* As on the lineage rail: the term's digits upright, then the role (「26 会計」); someone who never held the
              seat gets the blank 「あなた」 tag. */}
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
  );
}
