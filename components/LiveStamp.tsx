"use client";
// docs/DESIGN.md → LiveStamp: when the live answer arrives, the new AnswerEntry appears and its stamp
// lands (180ms, the --ease-stamp signature), with 「いま、2025年度 会計が答えました」 under it.
// prefers-reduced-motion turns the landing into an instant state change (styles/components.css).
import { useTranslations } from "next-intl";
import { AnswerEntry } from "@/components/AnswerEntry";
import type { LiveAnswer } from "@/lib/contracts";

export function LiveStamp({
  question,
  answer,
}: {
  question: string;
  answer: LiveAnswer;
}) {
  const t = useTranslations();
  return (
    <section>
      <AnswerEntry question={question} answer={answer} land />
      <p className="dd-live-note">
        {t("live.answered", { byline: answer.live.byline })}
      </p>
    </section>
  );
}
