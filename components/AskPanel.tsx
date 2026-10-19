"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskField } from "@/components/AskField";
import { LiveStamp } from "@/components/LiveStamp";
import { RetryLine } from "@/components/RetryLine";
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
  onSeatFailed,
}: {
  slug: string;
  mockShortcuts?: boolean;
  /** The signed-in newcomer's client (a console pane's); mocks as a26 when left out. */
  api?: Api;
  /** The seat view once it loads, for a page that shows the seat too (SeatHome); the console needs none. */
  onSeat?: (view: SeatView) => void;
  /** The seat didn't load: the page shows this panel anyway, with its retry. */
  onSeatFailed?: () => void;
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
  const [seatTry, setSeatTry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: seatTry is the retry button's way to read the seat again
  useEffect(() => {
    api.seat(slug).then(
      (view) => {
        setFailed(undefined);
        setSeatView(view);
        onSeat?.(view);
      },
      () => {
        setFailed("seat");
        onSeatFailed?.();
      },
    );
  }, [api, slug, onSeat, onSeatFailed, seatTry]);

  // The newest entry comes into view when it is added and when its result lands or changes: on a phone, the seat's
  // header above and the verb tabs below can leave the question, 「誰も知りません」 or the live answer, stamp and all,
  // out of sight. Nothing moves when it is in view already (the console's panes), or when a question didn't go out (the
  // field and its error stay where they are).
  const newest = useRef<HTMLElement>(null);
  const newestEntry = asked[0];
  useEffect(() => {
    if (newestEntry && failed !== "ask") {
      newest.current?.scrollIntoView({ block: "nearest" });
    }
  }, [newestEntry, failed]);

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

  // The newest question's state in words: searching, an answer from the notes, nobody knew (and whether it reached last
  // year's holder), or the live answer that just landed.
  const status = (() => {
    if (!newestEntry) return "";
    const result = newestEntry.result;
    if (!result) return t("ask.searching");
    if (result.status === "answered") {
      return result.live
        ? t("live.answered", { byline: result.live.byline })
        : t("ask.found");
    }
    if (!seatView) return "";
    const { seatType, name } = seatView.seat;
    const nobody = t(`seatTypes.${seatType}.abstain`, { seat: name });
    return result.routedTo > 0
      ? `${nobody}${t(`seatTypes.${seatType}.routed`, { seat: name })}`
      : nobody;
  })();

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
      {/* What a screen reader hears about the newest question (docs/DESIGN.md → AskPanel): always there, so a change is
          read out, and never shown, since the entry below says it (searching included, under its question). */}
      <output aria-live="polite" className="dd-sr-only">
        {status}
      </output>
      {failed === "seat" && (
        <RetryLine
          message={t("ask.seatFailed")}
          onRetry={() => setSeatTry((n) => n + 1)}
        />
      )}
      {failed === "ask" && (
        <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
          {t("ask.failed")}
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
          {/* The only sign that 聞く is working, where the answer will be: it takes this line's place, so nothing jumps */}
          {!result && (
            <p className="dd-cap dd-ask-status" aria-hidden="true">
              {t("ask.searching")}
            </p>
          )}
          {result?.status === "abstained" && seatView && (
            <AbstainEntry
              result={result}
              seat={seatView.seat}
              isHolder={seatView.viewer.isHolder}
            />
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
