"use client";

import { useTranslations } from "next-intl";
import type { InboxItem } from "@/lib/contracts";

export type AnswerMode = "voice" | "text";

// 伝言メモ (docs/DESIGN.md → InboxSlip): a newcomer's question on the predecessor's phone, like a slip from an
// office message pad. The asker shows by seat and term (askedBy), never by name.
export function InboxSlip({
  item,
  arriving = false,
  onAnswer,
}: {
  item: InboxItem;
  arriving?: boolean; // just arrived: slides down 8px into place
  onAnswer?: (item: InboxItem, mode: AnswerMode) => void; // F3.3 (#5) opens the answer
}) {
  const t = useTranslations("inbox");
  return (
    <article className={`dd-slip dd-inbox${arriving ? " is-arriving" : ""}`}>
      <h3 className="dd-label" style={{ margin: 0, fontWeight: 700 }}>
        {t("arrived")}
      </h3>
      <dl style={{ margin: "var(--s-2) 0 0" }}>
        <div className="dd-field">
          <dt>{t("from")}</dt>
          <dd className="dd-fig">{item.askedBy}</dd>
        </div>
      </dl>
      <p className="dd-inbox-q" lang={item.lang}>
        {item.question}
      </p>
      <p className="dd-cap" style={{ margin: 0 }}>
        {t.rich("askCount", {
          n: item.askCount,
          fig: (chunks) => <span className="dd-fig">{chunks}</span>,
        })}
      </p>
      <div className="dd-row" style={{ marginTop: "var(--s-4)" }}>
        <button
          type="button"
          className="dd-btn dd-btn-primary"
          style={{ flex: 1, minHeight: "52px" }}
          onClick={() => onAnswer?.(item, "voice")}
        >
          {t("answerByVoice")}
        </button>
        <button
          type="button"
          className="dd-btn"
          style={{ flex: 1, minHeight: "52px" }}
          onClick={() => onAnswer?.(item, "text")}
        >
          {t("answerByText")}
        </button>
      </div>
    </article>
  );
}
