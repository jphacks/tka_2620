"use client";
// 自分のメモ (docs/DESIGN.md → three verbs): the author's notes with their scope and 「撤回する」. Presentational:
// the page (MyNotesPanel) and the console (TrustConsole) each own the withdrawal state machine and pass it in.
import { useTranslations } from "next-intl";
import { NoteEntry, type WithdrawPhase } from "@/components/NoteEntry";
import type { MyNote, SeatView } from "@/lib/contracts";

export function MyNotes({
  notes,
  seat,
  withdrawing,
  withdrawFailed = false,
  onWithdraw,
}: {
  notes: MyNote[];
  seat: SeatView["seat"];
  withdrawing?: { id: string; phase: WithdrawPhase };
  /** The last withdrawal failed: the note stayed, and the author can press 「撤回する」 again. */
  withdrawFailed?: boolean;
  onWithdraw: (noteId: string) => void;
}) {
  const t = useTranslations();
  return (
    <section
      className="dd-col"
      style={{ gap: "var(--s-5)" }}
      aria-label={t("verbs.myNotes")}
    >
      <h2 className="dd-h">{t("verbs.myNotes")}</h2>
      {withdrawFailed && (
        <p role="alert" style={{ margin: 0 }}>
          {t("myNotes.withdrawFailed")}
        </p>
      )}
      <div className="dd-col" style={{ gap: "var(--s-4)" }} aria-live="polite">
        {notes.map((note) => (
          <NoteEntry
            key={note.id}
            note={note}
            seat={seat}
            phase={withdrawing?.id === note.id ? withdrawing.phase : undefined}
            onWithdraw={() => onWithdraw(note.id)}
            disabled={withdrawing !== undefined}
          />
        ))}
        {notes.length === 0 && (
          <p className="dd-cap" style={{ margin: 0 }}>
            {t("myNotes.empty")}
          </p>
        )}
      </div>
    </section>
  );
}
