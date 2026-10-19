"use client";
// 自分のメモ (docs/DESIGN.md → three verbs): the author's notes with their scope and 「撤回する」. Presentational:
// the page (MyNotesPanel) and the console (TrustConsole) each own the withdrawal state machine and pass it in.
// Each note says its scope in the words of the seat it was written at (MyNote.seat), so seats holds those seats.
// The list is every note it is given, in place: the page's 状態 select picks which (公開中 by default; すべて and 撤回済み
// list withdrawn notes too, their titles crossed out). No fold (Nico's call: as before).
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback } from "react";
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
  tools,
  emptyText,
  headingLevel = 2,
}: {
  notes: MyNote[];
  seats: NoteSeats;
  withdrawing?: { id: string; phase: WithdrawPhase };
  /** The last withdrawal failed: the note stayed, and the author can press 「撤回する」 again. */
  withdrawFailed?: boolean;
  onWithdraw: (noteId: string) => void;
  /** Under the heading: the page's filter and order (MyNotesPanel); the console has none. */
  tools?: ReactNode;
  /** What an empty list says when the author has notes the filter hides. */
  emptyText?: string;
  /** 1 on /me/notes, where this is the page and its h1 is for a screen reader only (the verb tab says where you are,
   * Nico's call); 2 inside the console's pane, shown, since a pane has no tabs. */
  headingLevel?: 1 | 2;
}) {
  const t = useTranslations();
  // A withdrawal that failed says so above the list: it comes into view, as the author may be far down the list.
  const intoView = useCallback((node: HTMLElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);
  const entry = (note: MyNote) =>
    seats[note.seat] ? (
      <NoteEntry
        key={note.id}
        note={note}
        seat={seats[note.seat]}
        phase={withdrawing?.id === note.id ? withdrawing.phase : undefined}
        onWithdraw={() => onWithdraw(note.id)}
        disabled={withdrawing !== undefined}
        titleLevel={headingLevel === 1 ? 2 : 3}
      />
    ) : null;
  return (
    <section
      className="dd-col"
      style={{ gap: "var(--s-5)" }}
      aria-label={t("verbs.myNotes")}
    >
      {headingLevel === 1 ? (
        <h1 className="dd-sr-only">{t("verbs.myNotes")}</h1>
      ) : (
        <h2 className="dd-h">{t("verbs.myNotes")}</h2>
      )}
      {tools}
      {withdrawFailed && (
        <p ref={intoView} role="alert" style={{ margin: 0 }}>
          {t("myNotes.withdrawFailed")}
        </p>
      )}
      <div className="dd-col" style={{ gap: "var(--s-4)" }} aria-live="polite">
        {notes.map(entry)}
        {notes.length === 0 && (
          <p className="dd-cap" style={{ margin: 0 }}>
            {emptyText ?? t("myNotes.empty")}
          </p>
        )}
      </div>
    </section>
  );
}
