"use client";
// /console (docs/DESIGN.md → PersonaPane, WithdrawMeter, LeakCounter): the 10-second trust proof. Three
// phone-sized panes side by side at 1920px — a26 (新しい会計) with a cited answer, a25 (去年の会計) with
// 自分のメモ and 「撤回する」, and x (部外者) who sees nothing. Withdrawing a cited note drops it out of a26's
// answer while the meter runs; it freezes in ink the moment the last pane has dropped it.
// The live loop runs in the same panes: a26 asks in the ask field, the question reaches a25's inbox, and the signed
// answer lands back in a26's pane (F4.1, #25). The outsider's pane shows what x can see of the seat: nothing.
// Each pane runs on its own client (ConsoleSignIn: three signed-in personas, or the mocks), so every view is that
// persona's own and RLS decides what each one gets.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskPanel } from "@/components/AskPanel";
import { LanguageToggle, ThemeToggle } from "@/components/DisplayToggles";
import { InboxPanel } from "@/components/InboxPanel";
import { LeakCounter } from "@/components/LeakCounter";
import { MeasuredNumbers } from "@/components/MeasuredNumbers";
import { MyNotes, type NoteSeats, seatsOf } from "@/components/MyNotes";
import {
  COLLAPSE_MS,
  LINE_MS,
  type WithdrawPhase,
} from "@/components/NoteEntry";
import { PersonaPane } from "@/components/PersonaPane";
import { WithdrawMeter } from "@/components/WithdrawMeter";
import type {
  Api,
  AskResult,
  Metrics,
  MyNote,
  SeatView,
} from "@/lib/contracts";
import { mockQuestions } from "@/lib/mocks";
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

// One client per pane: a26 the newcomer, a25 last year's treasurer, x the outsider.
export type ConsoleApis = { newcomer: Api; senpai: Api; outsider: Api };

// metrics: what the checks measured, from metrics/latest.json (app/console/page.tsx); undefined until they have run.
// onReset: back to the seed state (resetMocks on mocks). Without it there is no リセット button: on the real
// database that is `pnpm demo:reset` in a terminal, so the service-role key stays out of the app, then a reload.
// onSignOut: 「ログアウト」, the three panes' sessions on this device only (real data; components/ConsoleSignIn.tsx).
export function TrustConsole({
  apis,
  metrics,
  onReset,
  onSignOut,
}: {
  apis: ConsoleApis;
  metrics?: Metrics;
  onReset?: () => void;
  onSignOut?: () => void;
}) {
  const t = useTranslations();
  const { newcomer: newcomerApi, senpai: senpaiApi } = apis;
  const [seat, setSeat] = useState<SeatView["seat"]>();
  const [outsiderView, setOutsiderView] = useState<SeatView>();
  const [loadFailed, setLoadFailed] = useState(false);
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
    setOutsiderView(undefined);
    setLoadFailed(false);
    answerRef.current = undefined;
    Promise.all([
      newcomerApi.seat(SEAT),
      senpaiApi.myNotes(),
      newcomerApi.ask({ seat: SEAT, question: QUESTION }),
      apis.outsider.seat(SEAT),
    ])
      .then(async ([view, mine, asked, outsider]) => {
        const bySlug = await seatsOf(senpaiApi, mine.notes);
        if (id !== loadId.current) return; // a reset superseded this load
        setSeat(view.seat);
        setSeats(bySlug);
        setNotes(mine.notes);
        answerRef.current = asked;
        setAnswer(asked);
        setOutsiderView(outsider);
      })
      .catch(() => {
        if (id === loadId.current) setLoadFailed(true);
      });
  }, [newcomerApi, senpaiApi, apis.outsider]);

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
    onReset?.();
    setRun((n) => n + 1);
    load();
  }

  const shownMs = meter.running ? Math.max(0, now - started.current) : meter.ms;

  return (
    // Centred on the projector, with the header as wide as the three panes.
    // On a laptop narrower than the three panes, the panes row scrolls sideways (.dd-console, .dd-panes).
    <div
      className="dd-pad dd-col dd-console"
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
          <LeakCounter leaks={metrics?.leaks} />
          {onReset && (
            <button type="button" className="dd-btn" onClick={reset}>
              {t("console.reset")}
            </button>
          )}
          {onSignOut && (
            <button type="button" className="dd-btn" onClick={onSignOut}>
              {t("console.signOut")}
            </button>
          )}
          {/* As on every seat page: the way to the start page, the language and the theme */}
          <nav className="dd-console-tools" aria-label={t("bar.label")}>
            <Link href="/" className="dd-bar-home" title={t("bar.home")}>
              {t("home.title")}
            </Link>
            <LanguageToggle />
            <ThemeToggle />
          </nav>
        </div>
      </header>
      {loadFailed && (
        <p role="alert" style={{ margin: 0 }}>
          {t("console.loadFailed")}
        </p>
      )}
      {/* Everything pnpm metrics measured, collapsed; the reset hint where リセット is a terminal command. */}
      <MeasuredNumbers metrics={metrics} resetHint={!onReset} />

      <div
        className="dd-row dd-panes"
        style={{ gap: "var(--s-5)", alignItems: "flex-start" }}
      >
        <PersonaPane label={t("console.newcomer")}>
          <div className="dd-col" style={{ gap: "var(--s-6)" }}>
            <AskPanel
              key={run}
              slug={SEAT}
              mockShortcuts={false}
              api={newcomerApi}
            />
            <div className="dd-col" style={{ gap: 0 }}>
              {answer?.status === "answered" && (
                <AnswerEntry
                  question={QUESTION}
                  answer={answer}
                  api={newcomerApi}
                />
              )}
              {answer?.status === "abstained" && seat && (
                <AbstainEntry result={answer} seat={seat} />
              )}
            </div>
          </div>
        </PersonaPane>

        <PersonaPane label={t("console.predecessor")}>
          {/* 16px, not 32: the four notes fit the 844px pane below an empty inbox. */}
          <div className="dd-col" style={{ gap: "var(--s-4)" }}>
            <InboxPanel
              key={run}
              slug={SEAT}
              mockShortcuts={false}
              closeAfterPublish
              api={senpaiApi}
            />
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

        {/* What x gets for the seat page's notes, as x: nothing. Anything listed here would be a leak on screen. */}
        <PersonaPane label={t("console.outsider")}>
          {outsiderView?.upcoming.length === 0 && (
            <p className="dd-cap" style={{ margin: 0 }}>
              {t("trust.nothing")}
            </p>
          )}
          {outsiderView && outsiderView.upcoming.length > 0 && (
            <ul className="dd-col" style={{ margin: 0, paddingLeft: "1em" }}>
              {outsiderView.upcoming.map((item) => (
                <li key={item.noteId} lang={item.lang}>
                  {item.title}
                </li>
              ))}
            </ul>
          )}
        </PersonaPane>
      </div>
    </div>
  );
}
