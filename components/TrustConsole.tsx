"use client";
// /console (docs/DESIGN.md → PersonaPane, WithdrawMeter, LeakCounter): the 10-second trust proof. Three
// phone-sized panes side by side at 1920px — a26 (新しい会計) with a cited answer, a25 (去年の会計) with
// 自分のメモ and 「撤回する」, and x (部外者) who sees nothing. Withdrawing a cited note drops it out of a26's
// answer while the meter runs; it freezes in ink the moment the last pane has dropped it.
// The live loop runs in the same panes: a26 asks in the ask field, the question reaches a25's inbox, and the signed
// answer lands back in a26's pane (F4.1, #25). The outsider's pane stays empty.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1): the real client replaces createMockApi when the API exists (#4).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskPanel } from "@/components/AskPanel";
import { InboxPanel } from "@/components/InboxPanel";
import { LeakCounter } from "@/components/LeakCounter";
import { MyNotes } from "@/components/MyNotes";
import type { WithdrawPhase } from "@/components/NoteEntry";
import { PersonaPane } from "@/components/PersonaPane";
import { WithdrawMeter } from "@/components/WithdrawMeter";
import type { AskResult, MyNote, SeatView } from "@/lib/contracts";
import { createMockApi, mockQuestions, resetMocks } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

const SEAT = "smash-kaikei";
// SPEC F4: the leak test's ≥50 outsider attempts; the engine's numbers land here once `pnpm metrics` runs (#4).
const PROBES = 50;
// Match styles/components.css: the double line draws for --t-line, then the entry collapses over 200ms.
const COLLAPSE_MS = 200;
// The newcomer's question whose answer cites the 2025 deadline note — the sentence withdrawal must remove.
const QUESTION = mockQuestions.q01;

// The meter starts at the click and stops when the withdrawal has reached every pane: the a25 notes echo,
// any re-answer for a26 (only when its answer cited the note) and the API reply.
type Pending = { id: string; api: boolean; notes: boolean; answers: boolean };

export function TrustConsole() {
  const t = useTranslations();
  const newcomerApi = useMemo(() => createMockApi("a26"), []);
  const senpaiApi = useMemo(() => createMockApi("a25"), []);
  const [seat, setSeat] = useState<SeatView["seat"]>();
  const [notes, setNotes] = useState<MyNote[]>();
  const [answer, setAnswer] = useState<AskResult>();
  const [withdrawing, setWithdrawing] = useState<{
    id: string;
    phase: WithdrawPhase;
  }>();
  const [meter, setMeter] = useState<{ running: boolean; ms: number }>({
    running: false,
    ms: 0,
  });
  const [now, setNow] = useState(0);
  const answerRef = useRef<AskResult | undefined>(undefined);
  const pending = useRef<Pending | undefined>(undefined);
  const started = useRef(0);
  const loadId = useRef(0);
  // Bumped by reset so the live-loop panels mount again on the fresh mock state.
  const [run, setRun] = useState(0);

  // The trust proof needs a cited answer under a26: the newcomer asks q01 (the 2025 deadline note).
  const load = useCallback(() => {
    const id = ++loadId.current;
    pending.current = undefined;
    setWithdrawing(undefined);
    setMeter({ running: false, ms: 0 });
    setNotes(undefined);
    setAnswer(undefined);
    answerRef.current = undefined;
    Promise.all([
      newcomerApi.seat(SEAT),
      senpaiApi.myNotes(),
      newcomerApi.ask({ seat: SEAT, question: QUESTION }),
    ]).then(([view, mine, asked]) => {
      if (id !== loadId.current) return; // a reset superseded this load
      setSeat(view.seat);
      setNotes(mine.notes);
      answerRef.current = asked;
      setAnswer(asked);
    });
  }, [newcomerApi, senpaiApi]);

  useEffect(() => {
    load();
  }, [load]);

  const tryStop = useCallback(() => {
    const current = pending.current;
    if (!current || !current.api || current.notes || current.answers) return;
    pending.current = undefined;
    setMeter({ running: false, ms: performance.now() - started.current });
  }, []);

  // a25's pane drops the note: a status change, which then closes the entry.
  useRealtime(senpaiApi, "notes", (row) => {
    setNotes((previous) =>
      previous?.map((note) =>
        note.id === row.id ? { ...note, status: row.status } : note,
      ),
    );
    if (pending.current?.id !== row.id || row.status !== "withdrawn") return;
    pending.current.notes = false;
    tryStop();
    setWithdrawing((previous) =>
      previous?.id === row.id ? { id: row.id, phase: "collapse" } : previous,
    );
    setTimeout(() => {
      setNotes((previous) => previous?.filter((note) => note.id !== row.id));
      setWithdrawing((previous) =>
        previous?.id === row.id ? undefined : previous,
      );
    }, COLLAPSE_MS);
  });

  // a26's pane drops the note: the answer is re-pushed with the withdrawn sentence gone.
  useRealtime(newcomerApi, "answers", (row) => {
    setAnswer((previous) =>
      previous?.questionId === row.question_id ? row.payload : previous,
    );
    if (answerRef.current?.questionId !== row.question_id) return;
    answerRef.current = row.payload;
    const stillCited =
      row.payload.status === "answered" &&
      row.payload.sentences.some((sentence) =>
        sentence.citations.some(
          (citation) => citation.noteId === pending.current?.id,
        ),
      );
    if (pending.current?.answers && !stillCited) {
      pending.current.answers = false;
      tryStop();
    }
  });

  // Count up while the trust proof is running; the frozen value comes from tryStop.
  useEffect(() => {
    if (!meter.running) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [meter.running]);

  function startWithdraw(noteId: string) {
    const current = answerRef.current;
    if (pending.current || !current) return;
    const cited =
      current.status === "answered" &&
      current.sentences.some((sentence) =>
        sentence.citations.some((citation) => citation.noteId === noteId),
      );
    started.current = performance.now();
    setNow(started.current);
    pending.current = { id: noteId, api: false, notes: true, answers: cited };
    setMeter({ running: true, ms: 0 });
    setWithdrawing({ id: noteId, phase: "line" });
    senpaiApi
      .withdraw(noteId)
      .then(() => {
        if (!pending.current) return;
        pending.current.api = true;
        tryStop();
      })
      .catch(() => {
        pending.current = undefined;
        setWithdrawing(undefined);
        setMeter({ running: false, ms: 0 });
      });
  }

  function reset() {
    resetMocks();
    setRun((n) => n + 1);
    load();
  }

  const shownMs = meter.running ? Math.max(0, now - started.current) : meter.ms;

  return (
    <div className="dd-pad dd-col" style={{ gap: "var(--s-5)" }}>
      <header
        className="dd-row"
        style={{ justifyContent: "space-between", alignItems: "baseline" }}
      >
        <h1 className="dd-h" style={{ fontSize: "var(--text-xxl)", margin: 0 }}>
          {t("console.title")}
        </h1>
        <div className="dd-row" style={{ gap: "var(--s-5)" }}>
          <WithdrawMeter ms={shownMs} running={meter.running} />
          <LeakCounter leaks={0} probes={PROBES} />
          <button type="button" className="dd-btn" onClick={reset}>
            {t("console.reset")}
          </button>
        </div>
      </header>

      <div
        className="dd-row"
        style={{ gap: "var(--s-5)", alignItems: "flex-start" }}
      >
        <PersonaPane label={t("console.newcomer")}>
          <div className="dd-col" style={{ gap: "var(--s-6)" }}>
            <AskPanel key={run} slug={SEAT} mockShortcuts={false} />
            <div className="dd-col" style={{ gap: 0 }}>
              {answer?.status === "answered" && (
                <AnswerEntry question={QUESTION} answer={answer} />
              )}
              {answer?.status === "abstained" && seat && (
                <AbstainEntry result={answer} seat={seat} />
              )}
            </div>
          </div>
        </PersonaPane>

        <PersonaPane label={t("console.predecessor")}>
          <div className="dd-col" style={{ gap: "var(--s-6)" }}>
            <InboxPanel key={run} slug={SEAT} mockShortcuts={false} />
            {seat && notes && (
              <MyNotes
                notes={notes}
                seat={seat}
                withdrawing={withdrawing}
                onWithdraw={startWithdraw}
              />
            )}
          </div>
        </PersonaPane>

        <PersonaPane label={t("console.outsider")}>
          <p className="dd-cap" style={{ margin: 0 }}>
            {t("trust.nothing")}
          </p>
        </PersonaPane>
      </div>
    </div>
  );
}
