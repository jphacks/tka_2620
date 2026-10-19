"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";

// A single writing line and a blue 聞く button (docs/DESIGN.md → AskField). Not a chat box.
export function AskField({
  onAsk,
  busy = false,
  suggestion,
}: {
  onAsk: (question: string) => void;
  busy?: boolean;
  /** An example the person tapped: it goes into the field to read or change, and is sent only with 聞く. */
  suggestion?: { text: string };
}) {
  const t = useTranslations();
  const [question, setQuestion] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!suggestion) return;
    setQuestion(suggestion.text);
    field.current?.focus();
  }, [suggestion]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    onAsk(text);
    setQuestion("");
    // Back to the field, also when 聞く was pressed: the button is off while the answer comes, and focus mustn't fall
    // to the page.
    field.current?.focus();
  }

  return (
    <form className="dd-ask" onSubmit={submit}>
      <input
        ref={field}
        type="text"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={t("ask.placeholder")}
        aria-label={t("ask.placeholder")}
        enterKeyHint="send"
      />
      <button
        type="submit"
        className="dd-btn dd-btn-primary"
        disabled={busy || !question.trim()}
      >
        {t("verbs.ask")}
      </button>
    </form>
  );
}
