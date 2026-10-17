"use client";
// docs/DESIGN.md → VoiceAnswer: the predecessor speaks the answer, checks the text and publishes it.
// A round 80px --blue button with a microphone; one ring pulses while listening; the transcript is an
// editable field in Klee One on ruled lines, so the keyboard's dictation works in the same place.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1), as last year's treasurer (a25): the real client replaces
// createMockApi when /api/handover/draft and /api/handover/publish exist. The console hands in its a25 pane's client.
import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AnswerMode } from "@/components/InboxSlip";
import type { Api, CardDraft, InboxItem, NoteKind } from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";
import { createDictation, type DictationError } from "@/lib/voice";

// docs/DESIGN.md → Marks and signs: a Japanese mark per kind, its word read from messages/kinds.*.
const kindMarks: Record<NoteKind, string> = {
  deadline: "〆",
  contact: "℡",
  rule_of_thumb: "◎",
  pitfall: "㊟",
  unwritten_rule: "※",
};

// The drafted card, so the predecessor sees exactly what 公開する will leave (F3: on mocks, show the card).
function DraftedCard({ card }: { card: CardDraft }) {
  const t = useTranslations();
  return (
    <section className="dd-slip" style={{ padding: "var(--s-4)" }}>
      <p className="dd-kind" style={{ margin: 0 }}>
        <span className="dd-kind-mark" aria-hidden="true">
          {kindMarks[card.kind]}
        </span>
        {t(`kinds.${card.kind}`)}
      </p>
      <h3 className="dd-h" style={{ margin: "var(--s-1) 0 var(--s-2)" }}>
        {card.title}
      </h3>
      <div className="dd-ruled" lang={card.lang}>
        <p>{card.body}</p>
      </div>
    </section>
  );
}

export function VoiceAnswer({
  item,
  seat,
  mode = "voice",
  onPublished,
  onClose,
  api: given,
}: {
  item: InboxItem;
  seat: string;
  /** voice starts the microphone; text opens the field focused (both land in the same field). */
  mode?: AnswerMode;
  onPublished?: () => void; // after publish: refresh the inbox (the waiting question is gone)
  onClose?: () => void; // dismiss the panel after reading the drafted card
  /** The signed-in predecessor's client; mocks as a25 when left out. */
  api?: Api;
}) {
  const t = useTranslations();
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError>();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [card, setCard] = useState<CardDraft>();
  const [failed, setFailed] = useState(false);
  // What the field held when listening began, so a restart after a pause keeps both sentences.
  const base = useRef("");

  const dictation = useMemo(
    () =>
      createDictation({
        onText: setText,
        onStateChange: (state) => setListening(state === "listening"),
        onError: (next) => {
          if (next === "network") return; // the session already restarted; nothing to say
          setError(next);
        },
      }),
    [],
  );

  // 声で答える starts the microphone right away (the tap is the user gesture the browser asks for).
  // Opening once: the field is empty here, and typing goes through change(), not this effect.
  useEffect(() => {
    if (mode === "voice") {
      dictation.start(base.current);
    } else {
      field.current?.focus();
    }
    return () => dictation.stop();
  }, [dictation, mode]);

  const listen = useCallback(() => {
    setError(undefined);
    if (listening) {
      dictation.stop();
      return;
    }
    base.current = text;
    dictation.start(text);
  }, [dictation, listening, text]);

  const change = useCallback(
    (value: string) => {
      if (listening) dictation.stop(); // typing takes over from the microphone
      setText(value);
    },
    [dictation, listening],
  );

  async function publish() {
    const answer = text.trim();
    if (!answer || publishing) return;
    dictation.stop();
    setPublishing(true);
    setFailed(false);
    try {
      const { cards } = await api.draft({
        seat,
        promptId: item.promptId,
        answer,
      });
      setCard(cards[0]);
      await api.publish({
        seat,
        promptId: item.promptId,
        cards: cards.map((draft) => ({
          ...draft,
          scope: draft.suggested_scope,
        })),
      });
      setPublished(true);
      onPublished?.();
    } catch {
      setFailed(true);
    } finally {
      setPublishing(false);
    }
  }

  const hint =
    error === "denied"
      ? t("voice.micDenied")
      : error === "unsupported"
        ? t("voice.unsupported")
        : undefined;

  // Published: show the drafted card the predecessor just left (F3: on mocks, show the created card).
  if (published) {
    return (
      <section className="dd-col" style={{ gap: "var(--s-4)" }}>
        <h2 className="dd-h">{t("voice.title")}</h2>
        {card && <DraftedCard card={card} />}
        <output className="dd-live-note">{t("voice.published")}</output>
        <button
          type="button"
          className="dd-link"
          style={{ justifySelf: "start", minHeight: "44px" }}
          onClick={onClose}
        >
          {t("voice.close")}
        </button>
      </section>
    );
  }

  return (
    <section className="dd-col" style={{ gap: "var(--s-4)" }}>
      <h2 className="dd-h">{t("voice.title")}</h2>

      <div
        className="dd-col"
        style={{ alignItems: "center", gap: "var(--s-2)" }}
      >
        <button
          type="button"
          className={`dd-voice${listening ? " is-listening" : ""}`}
          aria-pressed={listening}
          aria-label={
            listening ? t("voice.stopListening") : t("voice.startListening")
          }
          onClick={listen}
        >
          <Mic size={32} aria-hidden="true" />
        </button>
        <output className="dd-cap" style={{ color: "var(--ink-2)" }}>
          {listening ? t("inbox.listening") : t("voice.tapToSpeak")}
        </output>
      </div>

      <label className="dd-label" htmlFor={fieldId}>
        {t("voice.transcriptLabel")}
      </label>
      <textarea
        id={fieldId}
        ref={field}
        className="dd-voice-text"
        rows={3}
        lang={item.lang}
        placeholder={t("voice.placeholder")}
        value={text}
        onChange={(event) => change(event.target.value)}
      />
      <p className="dd-cap" style={{ margin: 0 }}>
        {t("voice.keyboardHint")}
      </p>

      {hint && (
        <p className="dd-cap" style={{ margin: 0 }}>
          {hint}
        </p>
      )}

      <div className="dd-row">
        <button
          type="button"
          className="dd-btn dd-btn-primary"
          style={{ flex: 1, minHeight: "52px" }}
          disabled={!text.trim() || publishing}
          onClick={publish}
        >
          {publishing ? t("voice.publishing") : t("inbox.publish")}
        </button>
      </div>
      {failed && (
        <p className="dd-cap" style={{ margin: 0 }}>
          {t("voice.failed")}
        </p>
      )}
    </section>
  );
}
