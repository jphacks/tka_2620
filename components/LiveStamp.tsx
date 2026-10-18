"use client";
// docs/DESIGN.md → LiveStamp: when the live answer arrives, the new AnswerEntry appears and its stamp
// lands (180ms, the --ease-stamp signature), with 「いま、2025年度 会計が答えました」 under it.
// prefers-reduced-motion turns the landing into an instant state change (styles/components.css).
import { useTranslations } from "next-intl";
import { AnswerEntry } from "@/components/AnswerEntry";
import type { Api, LiveAnswer } from "@/lib/contracts";

export function LiveStamp({
  question,
  answer,
  api,
}: {
  question: string;
  answer: LiveAnswer;
  /** The viewer's client, for the stamps' source notes. */
  api: Pick<Api, "note">;
}) {
  const t = useTranslations();
  return (
    <section>
      <AnswerEntry question={question} answer={answer} api={api} land />
      <p className="dd-live-note">
        {t("live.answered", { byline: answer.live.byline })}
      </p>
    </section>
  );
}
