"use client";
// docs/DESIGN.md → NoteEntry, in the form 自分のメモ needs: the author's own note with its scope and
// 「撤回する」. GET /api/me/notes carries titles only (a note body never goes in a list), so the entry is
// title, scope label and the withdrawal control; the kind mark, body and date stamp come with F5's review list.
// Withdrawing is the Japanese correction mark: two red lines draw, then the entry closes (styles/components.css).
import { useTranslations } from "next-intl";
import type { MyNote, SeatView } from "@/lib/contracts";

/** line: the double line is drawing. collapse: the entry is closing and about to leave. */
export type WithdrawPhase = "line" | "collapse";

export function NoteEntry({
  note,
  seat,
  phase,
  onWithdraw,
  disabled = false,
}: {
  note: MyNote;
  seat: SeatView["seat"];
  phase?: WithdrawPhase;
  onWithdraw?: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const scope = t(`seatTypes.${seat.seatType}.scope.${note.scope}`, {
    seat: seat.name,
    group: seat.group,
    institution: seat.institution,
  });
  const withdrawn = note.status === "withdrawn";
  const crossed = withdrawn || phase !== undefined;
  return (
    <article
      className={`dd-slip${crossed ? " dd-cross" : ""}${phase === "collapse" ? " dd-collapse" : ""}`}
      style={{
        display: "grid",
        gap: "var(--s-3)",
        padding: "var(--s-4)",
      }}
    >
      <h3 className="dd-h" lang={note.lang} style={{ margin: 0 }}>
        {note.title}
      </h3>
      <p className="dd-cap" style={{ margin: 0 }}>
        {scope}
      </p>
      {withdrawn ? (
        // Left in the author's own list after it left every answer (SPEC → Scope rules).
        <p
          className="dd-label"
          style={{ margin: 0, color: "var(--red)", fontWeight: 700 }}
        >
          {t("myNotes.withdrawn")}
        </p>
      ) : (
        <button
          type="button"
          className="dd-btn"
          style={{ justifySelf: "start" }}
          disabled={disabled}
          onClick={onWithdraw}
        >
          {t("withdraw.action")}
        </button>
      )}
    </article>
  );
}
