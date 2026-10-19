"use client";
// 自分のメモ (docs/DESIGN.md → three verbs): the author's notes with their scope and 「撤回する」. Presentational:
// the page (MyNotesPanel) and the console (TrustConsole) each own the withdrawal state machine and pass it in.
// Each note says its scope in the words of the seat it was written at (MyNote.seat), so seats holds those seats.
// The list is what's live, what the newcomers' answers draw on. Withdrawn notes aren't dropped from view (the author
// keeps the record of what they took back): they're folded away at the end, 「撤回したメモ（2件）」 (Nico's call). The
// page's 状態 select narrows the notes itself (公開中, 撤回済み) and turns the fold off: then they're listed in place.
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
  fold = true,
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
  /** Withdrawn notes folded away at the end: the console, and 自分のメモ's 状態 「すべて」. Off, every note given is
   * listed in place (状態 「公開中」 or 「撤回済み」, which the page has already narrowed to). */
  fold?: boolean;
}) {
  const t = useTranslations();
  // A withdrawal that failed says so above the list: it comes into view, as the author may be far down the list.
  const intoView = useCallback((node: HTMLElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);
  // A note being withdrawn stays in the list until its double line and collapse have run, then joins the fold.
  const live = fold
    ? notes.filter(
        (note) => note.status !== "withdrawn" || withdrawing?.id === note.id,
      )
    : notes;
  const gone = fold
    ? notes.filter(
        (note) => note.status === "withdrawn" && withdrawing?.id !== note.id,
      )
    : [];
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
        {live.map(entry)}
        {live.length === 0 && (
          <p className="dd-cap" style={{ margin: 0 }}>
            {gone.length > 0
              ? t("myNotes.noneLive")
              : (emptyText ?? t("myNotes.empty"))}
          </p>
        )}
      </div>
      {/* Withdrawn: kept, out of the way; the same search and filters apply */}
      {gone.length > 0 && (
        <details className="dd-withdrawn-fold">
          <summary>
            <span>{t("myNotes.withdrawnTitle", { n: gone.length })}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <p className="dd-cap">{t("myNotes.withdrawnLead")}</p>
          <div className="dd-col" style={{ gap: "var(--s-4)" }}>
            {gone.map(entry)}
          </div>
        </details>
      )}
    </section>
  );
}
