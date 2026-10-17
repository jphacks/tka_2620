"use client";
// docs/DESIGN.md → AnswerEntry: the question again in blue, then the answer in Klee One on the ruled
// grid, a mini stamp after every sentence (the note it rests on; #22 adds the tap-to-source, the
// highlighter behind deadline phrases and the rule-change margin note). Each sentence keeps the
// answer's lang, which can differ from the notes' (answers are written in the asker's language).
import { useTranslations } from "next-intl";
import type { AnsweredResult, AnswerSentence } from "@/lib/contracts";

// The term label's digits, last two: 「2025」→25, 「2025秋」→25 (the mini stamp holds 「25」).
const stampDigits = (termLabel: string) =>
  (termLabel.match(/\d/g)?.join("") ?? "").slice(-2);

function SentenceLine({
  sentence,
  land,
}: {
  sentence: AnswerSentence;
  land: boolean;
}) {
  const t = useTranslations();
  const stamped = sentence.citations[0]; // every sentence cites at least one retrieved note
  return (
    <p>
      {sentence.text}
      <span
        role="img"
        aria-label={t("live.stamp", { byline: stamped.byline })}
        className={`dd-mini${land ? " is-landing" : ""}`}
      >
        {stampDigits(stamped.termLabel)}
      </span>
    </p>
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
  return (
    <section>
      <p className="dd-q" lang={answer.language}>
        {question}
      </p>
      <div className="dd-ruled" lang={answer.language}>
        {answer.sentences.map((sentence) => (
          <SentenceLine key={sentence.text} sentence={sentence} land={land} />
        ))}
      </div>
    </section>
  );
}
