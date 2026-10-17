"use client";
// /me/notes (自分のメモ): the signed-in holder's own notes with their scope and 「撤回する」. Withdrawing draws
// the double line, then the entry closes and leaves — and the engine drops the note out of every answer
// (POST /api/notes/[id]/withdraw). Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1), as last year's treasurer (a25):
// the real client replaces createMockApi when /api/me/notes and the withdraw route exist (#26).
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { MyNotes } from "@/components/MyNotes";
import {
  COLLAPSE_MS,
  LINE_MS,
  type WithdrawPhase,
} from "@/components/NoteEntry";
import type { MyNote, SeatView } from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

const SEAT = "smash-kaikei";
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function MyNotesPanel() {
  const t = useTranslations();
  const api = useMemo(() => createMockApi("a25"), []);
  const [seat, setSeat] = useState<SeatView["seat"]>();
  const [notes, setNotes] = useState<MyNote[]>();
  const [failed, setFailed] = useState(false);
  const [withdrawFailed, setWithdrawFailed] = useState(false);
  const [withdrawing, setWithdrawing] = useState<{
    id: string;
    phase: WithdrawPhase;
  }>();

  useEffect(() => {
    let alive = true;
    Promise.all([api.seat(SEAT), api.myNotes()])
      .then(([view, mine]) => {
        if (!alive) return;
        setSeat(view.seat);
        setNotes(mine.notes);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  // A status change from another pane (the console) marks the note withdrawn here too.
  useRealtime(api, "notes", (row) => {
    setNotes((previous) =>
      previous?.map((note) =>
        note.id === row.id ? { ...note, status: row.status } : note,
      ),
    );
  });

  async function withdraw(noteId: string) {
    if (withdrawing) return;
    const clicked = performance.now();
    setWithdrawFailed(false);
    setWithdrawing({ id: noteId, phase: "line" });
    try {
      await api.withdraw(noteId);
    } catch {
      setWithdrawing(undefined); // the note stays; the button is usable again
      setWithdrawFailed(true);
      return;
    }
    // The double line finishes drawing (it started at the click), then the entry closes and leaves.
    await sleep(Math.max(0, LINE_MS - (performance.now() - clicked)));
    setWithdrawing({ id: noteId, phase: "collapse" });
    await sleep(COLLAPSE_MS);
    setNotes((previous) => previous?.filter((note) => note.id !== noteId));
    setWithdrawing(undefined);
  }

  if (failed) {
    return (
      <p className="dd-cap" style={{ margin: 0 }}>
        {t("myNotes.failed")}
      </p>
    );
  }
  if (!seat || !notes) return null;

  return (
    <MyNotes
      notes={notes}
      seat={seat}
      withdrawing={withdrawing}
      withdrawFailed={withdrawFailed}
      onWithdraw={withdraw}
    />
  );
}
