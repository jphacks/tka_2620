"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskField } from "@/components/AskField";
import { LiveStamp } from "@/components/LiveStamp";
import { RetryLine } from "@/components/RetryLine";
import type { Api, AskResult, GuideAsked, SeatView } from "@/lib/contracts";
import { createMockApi, mockIds, mockPredecessorAnswers } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

type Asked = { question: string; result?: AskResult };

// Which answers this device has already shown, per seat, so an answer that came while the tab was closed is marked
// 「新しい答え」 once. A convenience only: storage can be off (private window), and then nothing is marked.
const SEEN = (slug: string) => `daidai-seen-answers:${slug}`;
function readSeen(slug: string): Set<string> | undefined {
  try {
    const raw = localStorage.getItem(SEEN(slug));
    return raw ? new Set(JSON.parse(raw) as string[]) : undefined;
  } catch {
    return undefined;
  }
}
function writeSeen(slug: string, ids: Iterable<string>) {
  try {
    localStorage.setItem(SEEN(slug), JSON.stringify([...ids]));
  } catch {
    // storage off: the marks simply don't carry over
  }
}

// 聞く on the seat page: the ask field, then each question in blue with its result underneath.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1); the real client replaces createMockApi when /api/ask exists.
// The console runs it without the one-device shortcut (the a25 pane answers instead).
export function AskPanel({
  slug,
  mockShortcuts = true,
  api: given,
  onSeat,
  onSeatFailed,
  history = true,
}: {
  slug: string;
  mockShortcuts?: boolean;
  /** The signed-in newcomer's client (a console pane's); mocks as a26 when left out. */
  api?: Api;
  /** The seat view once it loads, for a page that shows the seat too (SeatHome); the console needs none. */
  onSeat?: (view: SeatView) => void;
  /** The seat didn't load: the page shows this panel anyway, with its retry. */
  onSeatFailed?: () => void;
  /** List the asker's earlier questions and their answers (GET /api/seats/[slug]/asked). Off on the console, whose
   * newcomer pane starts clean for the trust proof. */
  history?: boolean;
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
  // The asker's earlier questions at this seat, from the server: they outlast a reload or a closed tab, so an answer that
  // arrived meanwhile is here (docs/SPEC.md → the notification "your question was answered").
  const [earlier, setEarlier] = useState<GuideAsked[]>();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  // The questions asked in this tab, by id, for the Realtime handler (a row for one of them is shown right here).
  const shownIds = useRef<Set<string>>(new Set());
  const earlierId = useId();
  // An answer shown in this tab (聞く's own, or the live one) is seen: it won't come back as 「新しい答え」.
  const markSeen = useCallback(
    (questionId: string) => {
      writeSeen(slug, new Set([...(readSeen(slug) ?? []), questionId]));
    },
    [slug],
  );
  const loadEarlier = useCallback(() => {
    if (!history) return;
    api.asked(slug).then(
      ({ asked: rows }) => {
        setEarlier(rows);
        const answered = rows.flatMap((row) =>
          row.answer ? [row.questionId] : [],
        );
        const seen = readSeen(slug);
        // The first visit on a device marks nothing; afterwards, an answer not shown before is new.
        if (seen) {
          const added = answered.filter((id) => !seen.has(id));
          if (added.length > 0) {
            setFresh((current) => new Set([...current, ...added]));
          }
        }
        writeSeen(slug, new Set([...(seen ?? []), ...answered]));
      },
      () => undefined, // the list stays as it was; the ask field works regardless
    );
  }, [api, slug, history]);
  useEffect(() => {
    loadEarlier();
    // A phone that slept may have missed the Realtime row: read the list again when the page is back.
    const again = () => {
      if (document.visibilityState === "visible") loadEarlier();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [loadEarlier]);

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
    if (shownIds.current.has(row.question_id)) markSeen(row.question_id);
    loadEarlier(); // an earlier question may be the one answered
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
    if (result.status === "answered") markSeen(result.questionId);
  }

  // The earlier questions not already shown above (a question asked in this tab is listed once, with its live state).
  const shownHere = new Set(
    asked.flatMap((entry) => (entry.result ? [entry.result.questionId] : [])),
  );
  shownIds.current = shownHere;
  const previous = (earlier ?? []).filter(
    (row) => !shownHere.has(row.questionId),
  );

  // The newest question's state in words: searching, an answer from the notes, nobody knew (and whether it reached last
  // year's holder), or the live answer that just landed.
  const newestEntry = asked[0];
  const searching = newestEntry !== undefined && !newestEntry.result;
  const status = (() => {
    if (!newestEntry) {
      return fresh.size > 0 ? t("ask.newAnswers", { n: fresh.size }) : "";
    }
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
          read out. Searching shows for everyone, as the only sign that 聞く is working; the rest only for the reader,
          since the entry below says it already. */}
      <output
        aria-live="polite"
        className={`dd-cap dd-ask-status${searching ? "" : " dd-sr-only"}`}
      >
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
      {previous.length > 0 && (
        <section
          className="dd-col"
          style={{ gap: "var(--s-5)" }}
          aria-labelledby={earlierId}
        >
          <h2 id={earlierId} className="dd-h">
            {t("ask.earlierTitle")}
          </h2>
          {previous.map((row) => (
            <article
              key={row.questionId}
              className="dd-col"
              style={{ gap: "var(--s-1)" }}
            >
              {fresh.has(row.questionId) && (
                <p className="dd-new-answer">{t("ask.newAnswer")}</p>
              )}
              {row.answer ? (
                <AnswerEntry
                  question={row.text}
                  answer={row.answer}
                  api={api}
                />
              ) : (
                <>
                  <p className="dd-q" lang={row.lang}>
                    {row.text}
                  </p>
                  <p className="dd-cap" style={{ margin: 0 }}>
                    {t("ask.noAnswerYet")}
                  </p>
                </>
              )}
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
