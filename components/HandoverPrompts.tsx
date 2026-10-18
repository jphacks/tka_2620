"use client";
// 残す's handover prompts (docs/SPEC.md → F6; #43): up to three questions for the leaver, ranked demand → gap →
// required → core by GET /api/handover/prompts, each with why it is asked. Each prompt carries VoiceAnswer's textbox
// with the mic inside it, so the answer starts with a tap; 下書きを作る drafts it into cards (POST /api/handover/draft, at most one follow-up), checked in
// CardReview with a scope per card, and published naming the prompt (POST /api/handover/publish). An answered prompt
// stays in the list as 「公開しました」 with the scopes it went out at, so three in a row read as done. A newcomer's
// question routed here (prompt_routes) reads the list again; the prompts already shown keep their places, and after the
// first answer only newcomers' questions join them.
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { CardReview } from "@/components/CardReview";
import { DateStamp } from "@/components/DateStamp";
import { mergePrompts } from "@/components/handover";
import { RetryLine } from "@/components/RetryLine";
import { VoiceAnswer } from "@/components/VoiceAnswer";
import type {
  Api,
  DraftResponse,
  HandoverPrompt,
  PublishCard,
  Scope,
  SeatView,
} from "@/lib/contracts";
import { questionLang } from "@/lib/engine/lang";
import { createMockApi } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

// What went wrong, worded: drafting failed, every drafted card was held back, or publishing failed.
const TROUBLE = {
  draft: "handover.draftFailed",
  empty: "handover.draftEmpty",
  publish: "voice.failed",
} as const;

// The prompt being drafted: the answer, then its drafted cards once they arrive.
type Open = {
  prompt: HandoverPrompt;
  answer: string;
  draft?: DraftResponse;
};

export function HandoverPrompts({
  slug,
  refresh = 0,
  onPublished,
  hidden,
  api: given,
}: {
  slug: string;
  /** Changes when the inbox on the same page published an answer: read the list again. */
  refresh?: number;
  /** Cards were published here (the inbox on the same page reads its slips again). */
  onPublished?: () => void;
  /** Questions the inbox above already shows: one place per newcomer's question. */
  hidden?: ReadonlySet<string>;
  /** The signed-in predecessor's client; mocks as a25 when left out. */
  api?: Api;
}) {
  const t = useTranslations();
  const titleId = useId();
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const [view, setView] = useState<SeatView>();
  const [prompts, setPrompts] = useState<HandoverPrompt[]>();
  // The seat view and the prompts fail apart: either one says the questions couldn't be read.
  const [seatFailed, setSeatFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Open>();
  const [busy, setBusy] = useState(false);
  // The prompt being answered, for load() without reading the list again on every keystroke's render.
  const opened = useRef<string | undefined>(undefined);
  opened.current = open?.prompt.id;
  const [trouble, setTrouble] = useState<keyof typeof TROUBLE>();
  // What was said or typed for each prompt, so やめる on its drafted cards gives the answer back instead of a blank box.
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  // The scopes each answered prompt's cards went out at, by prompt id.
  const [published, setPublished] = useState<ReadonlyMap<string, Scope[]>>(
    new Map(),
  );
  const [seatTry, setSeatTry] = useState(0); // the retry button reads the seat again

  // biome-ignore lint/correctness/useExhaustiveDependencies: seatTry is the retry button's way to read the seat again
  useEffect(() => {
    let alive = true;
    api.seat(slug).then(
      (seat) => {
        if (alive) setView(seat);
      },
      () => {
        if (alive) setSeatFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [api, slug, seatTry]);

  // Prompts already shown keep their places, so nothing slides in under the person's thumb (components/handover.ts →
  // mergePrompts).
  const load = useCallback(async () => {
    let next: HandoverPrompt[];
    try {
      ({ prompts: next } = await api.prompts({ seat: slug }));
    } catch {
      setFailed(true); // prompts already shown stay
      return;
    }
    setFailed(false);
    setPrompts((current = []) =>
      mergePrompts(current, next, published, opened.current),
    );
  }, [api, slug, published]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the signal to read again
  useEffect(() => {
    load();
  }, [load, refresh]);
  useRealtime(api, "prompt_routes", () => {
    load();
  });
  // After 公開する the review is gone: focus moves to 「公開しました」 in its place, for a keyboard or a screen reader. Stable,
  // so a later render never pulls it back.
  const focusHere = useCallback((node: HTMLElement | null) => {
    node?.focus({ preventScroll: true });
  }, []);

  // The first draft of a prompt's answer, or the reply round to its follow-up (reply).
  async function draft(prompt: HandoverPrompt, answer: string, reply?: string) {
    const followup = reply ? open?.draft?.followup : undefined;
    const current: Open =
      open?.prompt.id === prompt.id ? open : { prompt, answer };
    setAnswers((all) => ({ ...all, [prompt.id]: answer }));
    setOpen(current);
    setBusy(true);
    setTrouble(undefined);
    try {
      const next = await api.draft({
        seat: slug,
        promptId: prompt.id,
        answer,
        ...(reply &&
          followup && {
            followup: { question: followup.question, answer: reply },
          }),
      });
      // Every card was held back (a name, contact details or a PIN): nothing to review. The answer stays in its field,
      // or the follow-up stays open, to say it again without them.
      if (next.cards.length === 0) {
        setTrouble("empty");
        return;
      }
      // The reply round never asks again (F6.3).
      setOpen({
        ...current,
        answer,
        draft: reply ? { cards: next.cards } : next,
      });
    } catch {
      setTrouble("draft");
    } finally {
      setBusy(false);
    }
  }

  async function publish(cards: PublishCard[]) {
    if (!open) return;
    setBusy(true);
    setTrouble(undefined);
    try {
      await api.publish({ seat: slug, promptId: open.prompt.id, cards });
      setPublished((current) =>
        new Map(current).set(
          open.prompt.id,
          cards.map((card) => card.scope),
        ),
      );
      setOpen(undefined);
      onPublished?.();
    } catch {
      setTrouble("publish");
    } finally {
      setBusy(false);
    }
  }

  // The inbox above is what the leaver came for; this section keeps its place (heading and a line) until it's ready, so
  // nothing below jumps when it arrives.
  if (!view && !seatFailed) {
    return (
      <section className="dd-col" style={{ gap: "var(--s-5)" }}>
        <h2 className="dd-h">{t("handover.promptsTitle")}</h2>
        <output className="dd-cap">{t("profile.loading")}</output>
      </section>
    );
  }
  const shownPrompts = prompts?.filter((prompt) => !hidden?.has(prompt.id));
  const seat = view?.seat;
  const termLabel = view?.viewer.termLabel; // what publishing signs with
  const scopeLabel = (scope: Scope) =>
    seat
      ? t(`seatTypes.${seat.seatType}.scope.${scope}`, {
          seat: seat.name,
          group: seat.group,
          institution: seat.institution,
        })
      : "";
  const reason = (prompt: HandoverPrompt) => {
    if (!seat) return "";
    switch (prompt.reason) {
      case "demand":
        return t("handover.reasonDemand", { n: prompt.askCount });
      case "gap":
        return t("handover.reasonGap");
      case "required":
        return t("handover.reasonRequired", { group: seat.group });
      case "core":
        return t("handover.reasonCore", { seat: seat.name });
    }
  };

  return (
    <section
      className="dd-col"
      style={{ gap: "var(--s-5)" }}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="dd-h">
        {t("handover.promptsTitle")}
      </h2>
      {(failed || seatFailed) && (
        <RetryLine
          message={t("handover.promptsFailed")}
          onRetry={() => {
            if (seatFailed) {
              setSeatFailed(false);
              setSeatTry((n) => n + 1);
            }
            load();
          }}
        />
      )}
      {shownPrompts?.length === 0 && (
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          {t("handover.promptsEmpty")}
        </p>
      )}
      {seat &&
        shownPrompts?.map((prompt) => {
          const scopes = published.get(prompt.id);
          const answering = open?.prompt.id === prompt.id;
          return (
            <article
              key={prompt.id}
              className="dd-slip dd-entry"
              aria-labelledby={`${titleId}-${prompt.id}`}
            >
              <p className="dd-cap" style={{ margin: 0 }}>
                {reason(prompt)}
              </p>
              {/* A newcomer's question in the hand, as on the inbox slip; the app's own prompts in the UI face. */}
              <p
                id={`${titleId}-${prompt.id}`}
                className={
                  prompt.reason === "demand" ? "dd-inbox-q" : "dd-prompt"
                }
                lang={questionLang(prompt.text)}
                style={{ margin: 0 }}
              >
                {prompt.text}
              </p>
              {scopes ? (
                // The signature moment (DESIGN → Motion): the predecessor's date stamp lands on what they published.
                <div className="dd-entry-foot">
                  <output
                    ref={focusHere}
                    tabIndex={-1}
                    className="dd-live-note"
                  >
                    {t("handover.publishedAs", {
                      scopes: [...new Set(scopes)]
                        .map(scopeLabel)
                        .join(t("import.listSeparator")),
                    })}
                  </output>
                  {termLabel && (
                    <DateStamp seat={seat} termLabel={termLabel} land />
                  )}
                </div>
              ) : answering && open.draft ? (
                <div className="dd-col" style={{ gap: "var(--s-4)" }}>
                  <CardReview
                    seat={seat}
                    cards={open.draft.cards}
                    followup={open.draft.followup}
                    api={api}
                    busy={busy}
                    onReply={(reply) => draft(prompt, open.answer, reply)}
                    onPublish={publish}
                  />
                  {trouble && (
                    <p role="alert" className="dd-cap" style={{ margin: 0 }}>
                      {t(TROUBLE[trouble])}
                    </p>
                  )}
                  <button
                    type="button"
                    className="dd-link"
                    style={{ justifySelf: "start", minHeight: "44px" }}
                    disabled={busy}
                    onClick={() => setOpen(undefined)}
                  >
                    {t("handover.cancel")}
                  </button>
                </div>
              ) : (
                // Written on the prompt. One draft at a time: while another prompt's cards are open, this field still
                // takes text but 下書きを作る waits, so a tap never throws away an answer or its drafted cards.
                <div className="dd-col" style={{ gap: "var(--s-3)" }}>
                  <VoiceAnswer
                    item={{ promptId: prompt.id }}
                    seat={slug}
                    api={api}
                    initialText={answers[prompt.id]}
                    describedBy={`${titleId}-${prompt.id}`}
                    drafting={busy && answering}
                    locked={open !== undefined && !answering}
                    onDraft={(answer) => draft(prompt, answer)}
                  />
                  {answering && trouble && (
                    <p role="alert" className="dd-cap" style={{ margin: 0 }}>
                      {t(TROUBLE[trouble])}
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
    </section>
  );
}
