"use client";

import { useEffect, useMemo, useState } from "react";
import { AbstainEntry } from "@/components/AbstainEntry";
import { AskField } from "@/components/AskField";
import type { AskResult, SeatView } from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";

type Asked = { question: string; result?: AskResult };

// 聞く on the seat page: the ask field, then each question in blue with its result underneath.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1); the real client replaces createMockApi when /api/ask exists.
// Answered results get AnswerEntry in F2.4 (#22).
export function AskPanel({ slug }: { slug: string }) {
  const api = useMemo(() => createMockApi("a26"), []);
  const [seatView, setSeatView] = useState<SeatView>();
  const [asked, setAsked] = useState<Asked[]>([]);
  const busy = asked.some((entry) => !entry.result);

  useEffect(() => {
    api.seat(slug).then(setSeatView);
  }, [api, slug]);

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

  return (
    <section className="dd-col" style={{ gap: "var(--s-6)" }}>
      <AskField onAsk={ask} busy={busy || !seatView} />
      {asked.map((entry, index) => (
        <article
          key={`${asked.length - index}`}
          className="dd-col"
          style={{ gap: 0 }}
        >
          <p className="dd-q">{entry.question}</p>
          {entry.result?.status === "abstained" && seatView && (
            <AbstainEntry result={entry.result} seat={seatView.seat} />
          )}
        </article>
      ))}
    </section>
  );
}
