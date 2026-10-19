"use client";
// docs/DESIGN.md → VoiceAnswer: the predecessor speaks the answer, checks the text and publishes it.
// A textbox in Klee One on ruled lines with a round microphone inside it at the right; one ring pulses while
// listening, and the spoken words land in the same field, so typing, the mic and the keyboard's dictation mix.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1), as last year's treasurer (a25): the real client replaces
// createMockApi when /api/handover/draft and /api/handover/publish exist. The console hands in its a25 pane's client.
// On the handover prompts (F6) the panel only takes the answer: onDraft gets it, and the cards are reviewed before
// anything is published (components/HandoverPrompts.tsx).
import { Mic } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AnswerMode } from "@/components/InboxSlip";
import { kindMarks } from "@/components/marks";
import type { Api, CardDraft, InboxItem } from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";
import { createDictation, type DictationError } from "@/lib/voice";

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
  mode,
  onPublished,
  onClose,
  onDraft,
  drafting = false,
  locked = false,
  headingLevel = 2,
  initialText,
  describedBy,
  api: given,
}: {
  /** What was said or typed before (a draft taken back with やめる), so it isn't lost. */
  initialText?: string;
  /** The id of the question this answers: a screen reader hears it with the field, not just 「答え」. */
  describedBy?: string;
  /** The prompt being answered; a handover prompt has no language of its own. */
  item: Pick<InboxItem, "promptId"> & { lang?: InboxItem["lang"] };
  seat: string;
  /** Opened by a tap: voice starts the microphone, text focuses the field. Left out, the field just waits, as it does
   * inside an inbox slip or a handover prompt. */
  mode?: AnswerMode;
  onPublished?: () => void; // after publish: refresh the inbox (the waiting question is gone)
  onClose?: () => void; // dismiss the panel after reading the drafted card
  /** Take the answer instead of publishing it: the button says 下書きを作る. */
  onDraft?: (answer: string) => void;
  /** onDraft's request is on its way. */
  drafting?: boolean;
  /** Another answer is being drafted on this page: the field still takes text, the button waits. */
  locked?: boolean;
  /** The title's level: 3 inside a handover prompt, under the prompts' h2. */
  headingLevel?: 2 | 3;
  /** The signed-in predecessor's client; mocks as a25 when left out. */
  api?: Api;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const speechLang = (item.lang ?? locale) === "en" ? "en-US" : "ja-JP";
  const Title = headingLevel === 3 ? "h3" : "h2";
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText ?? "");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError>();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [card, setCard] = useState<CardDraft>();
  const [failed, setFailed] = useState(false);
  // What the field held when listening began, so a restart after a pause keeps both sentences.
  const base = useRef(initialText ?? "");
  // 公開する as it appears with the first word, and the card once published, come into view: on a phone they can sit
  // under the verb tabs. Stable, so typing doesn't scroll anything once they are there.
  const intoView = useCallback((node: HTMLElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);
  // 公開する also stays in view as the answer wraps onto another line and pushes it down (a 320px phone): the field
  // growing scrolls the page just enough, and only then.
  const publishButton = useRef<HTMLButtonElement | null>(null);
  const showPublish = useCallback(
    (node: HTMLButtonElement | null) => {
      publishButton.current = node;
      intoView(node);
    },
    [intoView],
  );
  useEffect(() => {
    const box = field.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const grown = new ResizeObserver(() =>
      publishButton.current?.scrollIntoView({ block: "nearest" }),
    );
    grown.observe(box);
    return () => grown.disconnect();
  }, []);

  const dictation = useMemo(
    () =>
      createDictation({
        // English when the question (or, for a handover prompt, the page) is English; Japanese otherwise.
        lang: speechLang,
        onText: setText,
        onStateChange: (state) => setListening(state === "listening"),
        onError: (next) => {
          if (next === "network") return; // the session already restarted; nothing to say
          setError(next);
        },
      }),
    [speechLang],
  );

  // Opened with mode voice, the microphone starts right away (the opening tap is the user gesture the browser asks for).
  // Opening once: the field is empty here, and typing goes through change(), not this effect.
  useEffect(() => {
    if (mode === "voice") dictation.start(base.current);
    if (mode === "text") field.current?.focus();
  }, [dictation, mode]);
  useEffect(() => () => dictation.stop(), [dictation]);

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
    if (onDraft) {
      onDraft(answer);
      return;
    }
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
      <section
        key="published"
        ref={intoView}
        className="dd-col"
        style={{ gap: "var(--s-4)" }}
      >
        <Title className="dd-h">{t("voice.title")}</Title>
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

  // The answer field is a textbox with the microphone in its corner at the right: tap the box to type (it is the field's
  // label, so its padding takes the tap too), or the mic to speak (and again to stop). The mic sits beside the label, not
  // in it: a label holds one control. The button appears with the first word, and comes into view then: on a phone it
  // can sit under the verb tabs.
  return (
    <section key="form" className="dd-col" style={{ gap: "var(--s-3)" }}>
      <div className="dd-answer-box">
        <label className="dd-answer" htmlFor={fieldId}>
          <textarea
            id={fieldId}
            ref={field}
            className="dd-voice-text"
            rows={1}
            lang={item.lang}
            aria-label={t("voice.answerLabel")}
            aria-describedby={describedBy}
            placeholder={t("voice.inlinePlaceholder")}
            value={text}
            onChange={(event) => change(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={`dd-mic${listening ? " is-listening" : ""}`}
          aria-pressed={listening}
          aria-controls={fieldId}
          aria-label={
            listening ? t("voice.stopListening") : t("voice.startListening")
          }
          onClick={listen}
        >
          <Mic size={22} aria-hidden="true" />
        </button>
      </div>
      {listening && (
        <output className="dd-cap" style={{ color: "var(--ink-2)" }}>
          {t("inbox.listening")}
        </output>
      )}
      {hint && (
        <p className="dd-cap" style={{ margin: 0 }}>
          {hint}
        </p>
      )}
      {text.trim() && (
        <button
          ref={showPublish}
          type="button"
          className="dd-btn dd-btn-primary"
          style={{ minHeight: "52px" }}
          disabled={publishing || drafting || locked}
          onClick={publish}
        >
          {onDraft
            ? drafting
              ? t("handover.drafting")
              : t("handover.makeDraft")
            : publishing
              ? t("voice.publishing")
              : t("inbox.publish")}
        </button>
      )}
      {failed && (
        <p role="alert" className="dd-cap" style={{ margin: 0 }}>
          {t("voice.failed")}
        </p>
      )}
    </section>
  );
}
