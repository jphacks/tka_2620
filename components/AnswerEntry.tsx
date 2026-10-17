"use client";
// docs/DESIGN.md → AnswerEntry: the question again in blue, then the answer in Klee One on the ruled grid, a mini
// stamp after every sentence for each note it rests on. Tapping a stamp opens its source on the next ruled line.
// Dates carry the highlighter; a rule change is a red-pen margin note (a red bracket left of the sentence and
// 「2025年に変更」 after its stamps, on the same line). Each sentence keeps the answer's lang, which can differ from the
// notes' (answers are written in the asker's language).
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import type { AnsweredResult, AnswerSentence, Citation } from "@/lib/contracts";

// The term label's digits, last two: 「2025」→25, 「2025秋」→25 (the mini stamp holds 「25」).
const stampDigits = (termLabel: string) =>
  (termLabel.match(/\d/g)?.join("") ?? "").slice(-2);

// Dates in a sentence: 2025年10月20日, 10月20日, 10/20, October 20(, 2025).
const DATE =
  /(?:\d{4}年)?\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}|(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(?:, \d{4})?/g;

// The sentence with the highlighter behind each date (only ever behind ink text).
function withMarker(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(DATE)) {
    const start = match.index ?? 0;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="dd-marker">
        {match[0]}
      </mark>,
    );
    at = start + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

// The sentence that carries the rule change: the first one resting on a note of the term the rule changed in.
function ruleChangeIndex(answer: AnsweredResult): number {
  const term = answer.ruleChange?.termLabel;
  if (!term) return -1;
  return answer.sentences.findIndex((sentence) =>
    sentence.citations.some((citation) => citation.termLabel === term),
  );
}

function SentenceLine({
  sentence,
  lang,
  land,
  changedIn,
}: {
  sentence: AnswerSentence;
  lang: string;
  land: boolean;
  changedIn?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState<Citation>();
  // One stamp per note the sentence rests on (every sentence cites at least one retrieved note).
  const citations = sentence.citations.filter(
    (citation, i, all) =>
      all.findIndex((other) => other.noteId === citation.noteId) === i,
  );
  return (
    <>
      <p lang={lang} className={changedIn ? "dd-margin" : undefined}>
        {withMarker(sentence.text)}
        {citations.map((citation) => (
          <button
            key={citation.noteId}
            type="button"
            aria-label={t("live.stamp", { byline: citation.byline })}
            aria-expanded={open?.noteId === citation.noteId}
            className={`dd-mini${land ? " is-landing" : ""}`}
            onClick={() =>
              setOpen((current) =>
                current?.noteId === citation.noteId ? undefined : citation,
              )
            }
          >
            {stampDigits(citation.termLabel)}
          </button>
        ))}
        {changedIn && (
          // A line height of 1 keeps the 13px UI text from growing the 32px line box.
          <span className="dd-margin-note" style={{ lineHeight: 1 }}>
            {t("ask.changedIn", { term: changedIn })}
          </span>
        )}
      </p>
      {open && (
        <p className="dd-cap" style={{ lineHeight: "var(--s-6)" }}>
          {t("ask.source", { byline: open.byline })}
        </p>
      )}
    </>
  );
}

export function AnswerEntry({
  question,
  answer,
  land = false,
}: {
  question: string;
  answer: AnsweredResult;
  /** The stamp-landing motion is the live loop's signature; plain answers just appear. */
  land?: boolean;
}) {
  const changed = ruleChangeIndex(answer);
  return (
    <section>
      <p className="dd-q" lang={answer.language}>
        {question}
      </p>
      <div className="dd-ruled" lang={answer.language}>
        {answer.sentences.map((sentence, i) => (
          <SentenceLine
            key={sentence.text}
            sentence={sentence}
            lang={answer.language}
            land={land}
            changedIn={i === changed ? answer.ruleChange?.termLabel : undefined}
          />
        ))}
      </div>
    </section>
  );
}
