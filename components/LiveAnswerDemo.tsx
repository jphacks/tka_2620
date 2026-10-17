"use client";
import { useTranslations } from "next-intl";
// The newcomer half of the live loop on one device (F3 / #6), wired to lib/mocks' single-tab push:
// ask q04 → the question is delivered to a25 → (deliver) a25 drafts and publishes → the signed answer
// lands here and the AbstainEntry gives way to the AnswerEntry + LiveStamp.
// The AskField, the full AbstainEntry and the delivery are #3, #4 and #5's screens; the two mock
// buttons are the same-tab harness PR #49 prescribed, and this component is provisional scaffolding.
import { useMemo, useState } from "react";
import { LiveStamp } from "@/components/LiveStamp";
import {
  createMockApi,
  mockPredecessorAnswers,
  mockQuestions,
  resetMocks,
} from "@/lib/mocks";
import { useLiveAnswer } from "@/lib/realtime";

const SEAT = "smash-kaikei";

export function LiveAnswerDemo() {
  const t = useTranslations();
  // One Supabase client per pane in the real app; one mock API per pane on mocks. The new treasurer is a26.
  const api = useMemo(() => createMockApi("a26"), []);
  const [waiting, setWaiting] = useState<{
    questionId: string;
    question: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useLiveAnswer(api, waiting?.questionId ?? null);

  async function ask() {
    setBusy(true);
    try {
      const result = await api.ask({ seat: SEAT, question: mockQuestions.q04 });
      if (result.status === "abstained") {
        setWaiting({
          questionId: result.questionId,
          question: mockQuestions.q04,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function deliver() {
    setBusy(true);
    try {
      // a25 drafts the spoken answer and publishes it; the answer reaches a26 through
      // lib/mocks' answers push, which useLiveAnswer is already listening to.
      await mockPredecessorAnswers();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    resetMocks(); // pnpm demo:reset in this tab; subscriptions stay
    setWaiting(null);
  }

  return (
    <div className="dd-col">
      <div className="dd-row">
        <button
          type="button"
          className="dd-btn"
          onClick={ask}
          disabled={busy || waiting !== null}
        >
          {t("demo.ask")}
        </button>
        <button
          type="button"
          className="dd-btn"
          onClick={deliver}
          disabled={busy || waiting === null || live !== null}
        >
          {t("demo.deliver")}
        </button>
        <button
          type="button"
          className="dd-btn"
          onClick={reset}
          disabled={busy}
        >
          {t("demo.reset")}
        </button>
      </div>
      {live ? (
        <LiveStamp
          question={waiting?.question ?? mockQuestions.q04}
          answer={live}
        />
      ) : waiting ? (
        // Provisional view until #3's AbstainEntry lands: only the blank line and the blue status line.
        <section>
          <p className="dd-q">{waiting.question}</p>
          <div className="dd-ruled">
            <span className="dd-stamp-blank" aria-hidden="true" />
          </div>
          <p className="dd-live-note">{t("live.waiting")}</p>
        </section>
      ) : null}
    </div>
  );
}
