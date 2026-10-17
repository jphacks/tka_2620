"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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
}: {
  slug: string;
  mockShortcuts?: boolean;
  /** The signed-in newcomer's client (a console pane's); mocks as a26 when left out. */
  api?: Api;
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
    api.seat(slug).then(setSeatView, () => setFailed("seat"));
  }, [api, slug]);

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
          className="dd-col"
          style={{ gap: 0 }}
        >
          {result?.status === "answered" ? (
            result.live ? (
              <LiveStamp
                question={question}
                answer={{ ...result, live: result.live }}
              />
            ) : (
              <AnswerEntry question={question} answer={result} />
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
