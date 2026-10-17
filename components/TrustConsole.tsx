"use client";
// /console (docs/DESIGN.md → PersonaPane, WithdrawMeter, LeakCounter): the 10-second trust proof. Three
// phone-sized panes side by side at 1920px — a26 (新しい会計) with a cited answer, a25 (去年の会計) with
// 自分のメモ and 「撤回する」, and x (部外者) who sees nothing. Withdrawing a cited note drops it out of a26's
// answer while the meter runs; it freezes in ink the moment the last pane has dropped it.
// The live loop runs in the same panes: a26 asks in the ask field, the question reaches a25's inbox, and the signed
// answer lands back in a26's pane (F4.1, #25). The outsider's pane stays empty.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1): each pane's own signed-in client replaces createMockApi (#25)
// once the withdraw route exists (#26).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskPanel } from "@/components/AskPanel";
import { InboxPanel } from "@/components/InboxPanel";
import { LeakCounter } from "@/components/LeakCounter";
import { MyNotes, type NoteSeats, seatsOf } from "@/components/MyNotes";
import {
  COLLAPSE_MS,
  LINE_MS,
  type WithdrawPhase,
} from "@/components/NoteEntry";
import { PersonaPane } from "@/components/PersonaPane";
import { WithdrawMeter } from "@/components/WithdrawMeter";
import type { AskResult, Metrics, MyNote, SeatView } from "@/lib/contracts";
import { createMockApi, mockQuestions, resetMocks } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

const SEAT = "smash-kaikei";
// The newcomer's question whose answer cites the 2025 deadline note — the sentence withdrawal must remove.
const QUESTION = mockQuestions.q01;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// The meter starts at the click and stops when the withdrawal has reached every pane: a25's pane drops the note
// once the API has withdrawn it, a26's once its answer comes back without it (only when that answer cited it).
// Each flag is true while that pane is still waiting.
type Pending = { id: string; api: boolean; answers: boolean };

// leaks: the leak test's numbers from metrics/latest.json (app/console/page.tsx); undefined until it has run.
export function TrustConsole({ leaks }: { leaks?: Metrics["leaks"] }) {
  const t = useTranslations();
  const newcomerApi = useMemo(() => createMockApi("a26"), []);
  const senpaiApi = useMemo(() => createMockApi("a25"), []);
  const [seat, setSeat] = useState<SeatView["seat"]>();
  const [notes, setNotes] = useState<MyNote[]>();
  const [seats, setSeats] = useState<NoteSeats>();
  const [answer, setAnswer] = useState<AskResult>();
  const [withdrawing, setWithdrawing] = useState<{
    id: string;
    phase: WithdrawPhase;
  }>();
  const [withdrawFailed, setWithdrawFailed] = useState(false);
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
    setWithdrawFailed(false);
    setMeter({ running: false, ms: 0 });
    setNotes(undefined);
    setAnswer(undefined);
    answerRef.current = undefined;
    Promise.all([
      newcomerApi.seat(SEAT),
      senpaiApi.myNotes(),
      newcomerApi.ask({ seat: SEAT, question: QUESTION }),
    ]).then(async ([view, mine, asked]) => {
      const bySlug = await seatsOf(senpaiApi, mine.notes);
      if (id !== loadId.current) return; // a reset superseded this load
      setSeat(view.seat);
      setSeats(bySlug);
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
    if (!current || current.api || current.answers) return;
    pending.current = undefined;
    setMeter({ running: false, ms: performance.now() - started.current });
  }, []);

  // A status change (this pane's own echo, or the author's other tab) marks the note withdrawn in a25's list.
  // The meter doesn't wait for it: a25's pane started the withdrawal and has the API's answer.
  useRealtime(senpaiApi, "notes", (row) => {
    setNotes((previous) =>
      previous?.map((note) =>
        note.id === row.id ? { ...note, status: row.status } : note,
      ),
    );
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
    const loaded = loadId.current; // a reset while this runs supersedes it
    const clicked = performance.now();
    started.current = clicked;
    setNow(clicked);
    pending.current = { id: noteId, api: true, answers: cited };
    setWithdrawFailed(false);
    setMeter({ running: true, ms: 0 });
    setWithdrawing({ id: noteId, phase: "line" });
    senpaiApi.withdraw(noteId).then(
      async () => {
        if (loadId.current !== loaded) return;
        if (pending.current) pending.current.api = false;
        tryStop();
        // a25's pane drops the note: the double line finishes drawing, then the entry closes and leaves.
        await sleep(Math.max(0, LINE_MS - (performance.now() - clicked)));
        if (loadId.current !== loaded) return;
        setWithdrawing({ id: noteId, phase: "collapse" });
        await sleep(COLLAPSE_MS);
        if (loadId.current !== loaded) return;
        setNotes((previous) => previous?.filter((note) => note.id !== noteId));
        setWithdrawing(undefined);
      },
      () => {
        if (loadId.current !== loaded) return;
        pending.current = undefined;
        setWithdrawing(undefined);
        setWithdrawFailed(true);
        setMeter({ running: false, ms: 0 });
      },
    );
  }

  function reset() {
    resetMocks();
    setRun((n) => n + 1);
    load();
  }

  const shownMs = meter.running ? Math.max(0, now - started.current) : meter.ms;

  return (
    // Centred on the projector, with the header as wide as the three panes.
    <div
      className="dd-pad dd-col"
      style={{ gap: "var(--s-5)", width: "fit-content", marginInline: "auto" }}
    >
      <header
        className="dd-row"
        style={{ justifyContent: "space-between", alignItems: "baseline" }}
      >
        <h1 className="dd-h" style={{ fontSize: "var(--text-xxl)", margin: 0 }}>
          {t("console.title")}
        </h1>
        <div className="dd-row" style={{ gap: "var(--s-5)" }}>
          <WithdrawMeter ms={shownMs} running={meter.running} />
          <LeakCounter leaks={leaks} />
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
            {seats && notes && (
              <MyNotes
                notes={notes}
                seats={seats}
                withdrawing={withdrawing}
                withdrawFailed={withdrawFailed}
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
