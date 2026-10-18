"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskField } from "@/components/AskField";
import { LiveStamp } from "@/components/LiveStamp";
import type { Api, AskResult, SeatView } from "@/lib/contracts";
import { createMockApi, mockIds, mockPredecessorAnswers } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

type Asked = { question: string; result?: AskResult };

// 聞く on the seat page: the ask field, then each question in blue with its result underneath.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1); the real client replaces createMockApi when /api/ask exists.
// The console runs it without the one-device shortcut (the a25 pane answers instead).
export function AskPanel({
  slug,
  mockShortcuts = true,
  api: given,
  onSeat,
}: {
  slug: string;
  mockShortcuts?: boolean;
  /** The signed-in newcomer's client (a console pane's); mocks as a26 when left out. */
  api?: Api;
  /** The seat view once it loads, for a page that shows the seat too (SeatHome); the console needs none. */
  onSeat?: (view: SeatView) => void;
}) {
  const t = useTranslations();
  const api = useMemo(() => given ?? createMockApi("a26"), [given]);
  const [seatView, setSeatView] = useState<SeatView>();
  const [asked, setAsked] = useState<Asked[]>([]);
  const [delivering, setDelivering] = useState(false);
  // The real client can fail where the mocks never do: the seat didn't load (the field stays off), or a question
  // didn't go out (it leaves the list, and the field is free again).
  const [failed, setFailed] = useState<"seat" | "ask">();
  const busy = asked.some((entry) => !entry.result);

  useEffect(() => {
    api.seat(slug).then(
      (view) => {
        setSeatView(view);
        onSeat?.(view);
      },
      () => setFailed("seat"),
    );
  }, [api, slug, onSeat]);

  // The newest entry comes into view when its result lands or changes: on a phone, the seat's header above and the
  // verb tabs below can leave 「誰も知りません」 or the live answer, stamp and all, landing out of sight. Nothing moves
  // when it is in view already (the console's panes).
  const newest = useRef<HTMLElement>(null);
  const newestResult = asked[0]?.result;
  useEffect(() => {
    if (newestResult) newest.current?.scrollIntoView({ block: "nearest" });
  }, [newestResult]);

  // The asker's latest answer replaces the entry: the live answer, then any re-answer after a withdrawal
  // (fewer sentences, or the blank line again).
  useRealtime(api, "answers", (row) => {
    setAsked((entries) =>
      entries.map((entry) =>
        entry.result?.questionId === row.question_id
          ? { ...entry, result: row.payload }
          : entry,
      ),
    );
  });

  async function ask(question: string) {
    setFailed(undefined);
    setAsked((entries) => [{ question }, ...entries]);
    let result: AskResult;
    try {
      result = await api.ask({ seat: slug, question });
    } catch {
      setAsked((entries) =>
        entries.filter((entry) => entry.question !== question || entry.result),
      );
      setFailed("ask");
      return;
    }
    setAsked((entries) =>
      entries.map((entry) =>
        entry.question === question && !entry.result
          ? { ...entry, result }
          : entry,
      ),
    );
  }

  async function predecessorAnswers() {
    setDelivering(true);
    try {
      await mockPredecessorAnswers();
    } finally {
      setDelivering(false);
    }
  }

  return (
    <section className="dd-col" style={{ gap: "var(--s-6)" }}>
      <AskField onAsk={ask} busy={busy || !seatView} />
      {failed && (
        <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
          {t(failed === "seat" ? "ask.seatFailed" : "ask.failed")}
        </p>
      )}
      {asked.map(({ question, result }, index) => (
        <article
          key={`${asked.length - index}`}
          ref={index === 0 ? newest : undefined}
          className="dd-col"
          style={{ gap: 0 }}
        >
          {result?.status === "answered" ? (
            result.live ? (
              <LiveStamp
                question={question}
                answer={{ ...result, live: result.live }}
                api={api}
              />
            ) : (
              <AnswerEntry question={question} answer={result} api={api} />
            )
          ) : (
            <p className="dd-q">{question}</p>
          )}
          {result?.status === "abstained" && seatView && (
            <AbstainEntry result={result} seat={seatView.seat} />
          )}
          {/* Plays last year's treasurer answering q04 in this tab (lib/mocks.ts), so the loop works on one device. */}
          {mockShortcuts &&
            result?.status === "abstained" &&
            result.promptId === mockIds.keyPrompt && (
              <button
                type="button"
                className="dd-link"
                style={{ justifySelf: "start", minHeight: "44px" }}
                disabled={delivering}
                onClick={predecessorAnswers}
              >
                {t("mock.predecessorAnswers")}
              </button>
            )}
        </article>
      ))}
    </section>
  );
}
