"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AnswerEntry } from "@/components/AnswerEntry";
import { AskField } from "@/components/AskField";
import { LiveStamp } from "@/components/LiveStamp";
import type { AskResult, SeatView } from "@/lib/contracts";
import {
  createMockApi,
  mockIds,
  mockPredecessorAnswers,
  type Persona,
} from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

type Asked = { question: string; result?: AskResult };

// 聞く on the seat page: the ask field, then each question in blue with its result underneath.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1); the real client replaces createMockApi when /api/ask exists.
// F2.4 (#22) adds the tap-to-source, the highlighter and the rule-change note to AnswerEntry.
// The console runs it as other personas, without the one-device shortcut (the a25 pane answers instead).
export function AskPanel({
  slug,
  persona = "a26",
  mockShortcuts = true,
}: {
  slug: string;
  persona?: Persona;
  mockShortcuts?: boolean;
}) {
  const t = useTranslations();
  const api = useMemo(() => createMockApi(persona), [persona]);
  const [seatView, setSeatView] = useState<SeatView>();
  const [asked, setAsked] = useState<Asked[]>([]);
  const [delivering, setDelivering] = useState(false);
  const busy = asked.some((entry) => !entry.result);

  useEffect(() => {
    api.seat(slug).then(setSeatView);
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
    setAsked((entries) => [{ question }, ...entries]);
    const result = await api.ask({ seat: slug, question });
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
