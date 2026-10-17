"use client";
// 自分のメモ (docs/DESIGN.md → three verbs): the author's notes with their scope and 「撤回する」. Presentational:
// the page (MyNotesPanel) and the console (TrustConsole) each own the withdrawal state machine and pass it in.
// Each note says its scope in the words of the seat it was written at (MyNote.seat), so seats holds those seats.
import { useTranslations } from "next-intl";
import { NoteEntry, type WithdrawPhase } from "@/components/NoteEntry";
import type { Api, MyNote, SeatView } from "@/lib/contracts";

export type NoteSeats = Record<string, SeatView["seat"]>;

// The seats the notes were written at, one GET /api/seats/[slug] each.
export async function seatsOf(api: Api, notes: MyNote[]): Promise<NoteSeats> {
  const slugs = [...new Set(notes.map((note) => note.seat))];
  const views = await Promise.all(slugs.map((slug) => api.seat(slug)));
  return Object.fromEntries(views.map((view) => [view.seat.slug, view.seat]));
}

export function MyNotes({
  notes,
  seats,
  withdrawing,
  withdrawFailed = false,
  onWithdraw,
}: {
  notes: MyNote[];
  seats: NoteSeats;
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
        {notes.map((note) =>
          seats[note.seat] ? (
            <NoteEntry
              key={note.id}
              note={note}
              seat={seats[note.seat]}
              phase={
                withdrawing?.id === note.id ? withdrawing.phase : undefined
              }
              onWithdraw={() => onWithdraw(note.id)}
              disabled={withdrawing !== undefined}
            />
          ) : null,
        )}
        {notes.length === 0 && (
          <p className="dd-cap" style={{ margin: 0 }}>
            {t("myNotes.empty")}
          </p>
        )}
      </div>
    </section>
  );
}
