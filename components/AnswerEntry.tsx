"use client";
// docs/DESIGN.md → AnswerEntry: the question again in blue, then the answer in Klee One on the ruled grid, a mini
// stamp after every sentence for each note it rests on. Tapping a stamp opens its source on the next ruled line.
// Dates carry the highlighter, except the one a rule change replaced (the highlighter is for dates that matter);
// a rule change is a red-pen margin note (a red bracket left of the sentence and 「2025年に変更」 after its stamps,
// on the same line). Each sentence keeps the answer's lang, which can differ from the notes' (answers are written in
// the asker's language); the UI text inside it keeps the page's.
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import type { AnsweredResult, AnswerSentence, Citation } from "@/lib/contracts";

// The term label's digits, last two: 「2025」→25, 「2025秋」→25 (the mini stamp holds 「25」).
const stampDigits = (termLabel: string) =>
  (termLabel.match(/\d/g)?.join("") ?? "").slice(-2);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
// Dates in a sentence: 2025年10月20日, 10月20日, 2025/10/20, 10/20, October 20(, 2025).
const DATE = new RegExp(
  `(?:\\d{4}年)?\\d{1,2}月\\d{1,2}日|(?<!\\d)(?:\\d{4}/)?\\d{1,2}/\\d{1,2}(?!\\d)|(?:${MONTHS.join("|")}) \\d{1,2}(?:, \\d{4})?`,
  "g",
);

// A date as month/day (10月27日 → 10/27), the form of the engine's rule-change summary.
function monthDay(date: string): string {
  const parts = date.match(/(\d{1,2})月(\d{1,2})日$|(\d{1,2})\/(\d{1,2})$/);
  if (parts) {
    const [month, day] = parts[1] ? [parts[1], parts[2]] : [parts[3], parts[4]];
    return `${Number(month)}/${Number(day)}`;
  }
  const [name, day] = date.split(/[ ,]+/);
  return `${MONTHS.indexOf(name) + 1}/${Number(day)}`;
}

// The rule change, read for the screen: the term it changed in and, from the summary (lib/engine/rule-change.ts:
// 「10/27 → 10/20」), the deadline it replaced and the new one. A summary in another form leaves the dates out.
type Change = { term: string; before?: string; after?: string };
function changeOf(answer: AnsweredResult): Change | undefined {
  if (!answer.ruleChange) return undefined;
  const [, before, after] =
    answer.ruleChange.summary.match(
      /^(\d{1,2}\/\d{1,2}) → (\d{1,2}\/\d{1,2})$/,
    ) ?? [];
  return { term: answer.ruleChange.termLabel, before, after };
}

// The sentence with the highlighter behind each date but the replaced one.
function withMarker(text: string, replaced?: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(DATE)) {
    if (monthDay(match[0]) === replaced) continue;
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

// The sentence that carries the rule change: one resting on a note of the term it changed in, preferably the one
// that gives the new date (another seat's note, like the festival committee's, can share the term).
function ruleChangeIndex(answer: AnsweredResult, change?: Change): number {
  if (!change) return -1;
  const ofTerm = answer.sentences.map((sentence) =>
    sentence.citations.some((citation) => citation.termLabel === change.term),
  );
  const withDate = answer.sentences.findIndex(
    (sentence, i) =>
      ofTerm[i] &&
      [...sentence.text.matchAll(DATE)].some(
        (match) => monthDay(match[0]) === change.after,
      ),
  );
  return withDate >= 0 ? withDate : ofTerm.indexOf(true);
}

function SentenceLine({
  sentence,
  lang,
  land,
  replaced,
  changedIn,
}: {
  sentence: AnswerSentence;
  lang: string;
  land: boolean;
  replaced?: string;
  changedIn?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState<Citation>();
  // One stamp per note the sentence rests on (every sentence cites at least one retrieved note).
  const citations = sentence.citations.filter(
    (citation, i, all) =>
      all.findIndex((other) => other.noteId === citation.noteId) === i,
  );
  return (
    <>
      <p lang={lang} className={changedIn ? "dd-margin" : undefined}>
        {withMarker(sentence.text, replaced)}
        {citations.map((citation) => (
          <button
            key={citation.noteId}
            type="button"
            lang={locale}
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
          <span className="dd-margin-note" lang={locale}>
            {t("ask.changedIn", { term: changedIn })}
          </span>
        )}
      </p>
      {open && (
        <p className="dd-cap" lang={locale}>
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
  const change = changeOf(answer);
  const changed = ruleChangeIndex(answer, change);
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
            replaced={change?.before}
            // 「2025年に変更」: the term's year, so a term like 「2025秋」 reads the same.
            changedIn={
              i === changed
                ? (change?.term.match(/\d{4}/)?.[0] ?? change?.term)
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}
