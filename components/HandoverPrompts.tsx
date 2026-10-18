"use client";
// 残す's handover prompts (docs/SPEC.md → F6; #43): up to three questions for the leaver, ranked demand → gap →
// required → core by GET /api/handover/prompts, each with why it is asked. 声で答える / 文字で答える opens VoiceAnswer
// for that prompt; its answer is drafted into cards (POST /api/handover/draft, at most one follow-up), checked in
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
import { mergePrompts } from "@/components/handover";
import type { AnswerMode } from "@/components/InboxSlip";
import { VoiceAnswer } from "@/components/VoiceAnswer";
import type {
  Api,
  DraftResponse,
  HandoverPrompt,
  PublishCard,
  Scope,
  SeatView,
} from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

// What went wrong, worded: drafting failed, every drafted card was held back, or publishing failed.
const TROUBLE = {
  draft: "handover.draftFailed",
  empty: "handover.draftEmpty",
  publish: "voice.failed",
} as const;

// The prompt being answered: first the answer, then its drafted cards.
type Open = {
  prompt: HandoverPrompt;
  mode: AnswerMode;
  answer?: string;
  draft?: DraftResponse;
};

export function HandoverPrompts({
  slug,
  refresh = 0,
  onPublished,
  api: given,
}: {
  slug: string;
  /** Changes when the inbox on the same page published an answer: read the list again. */
  refresh?: number;
  /** Cards were published here (the inbox on the same page reads its slips again). */
  onPublished?: () => void;
  /** The signed-in predecessor's client; mocks as a25 when left out. */
  api?: Api;
}) {
  const t = useTranslations();
  const titleId = useId();
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const [view, setView] = useState<SeatView>();
  const [prompts, setPrompts] = useState<HandoverPrompt[]>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Open>();
  const [busy, setBusy] = useState(false);
  // The prompt being answered, for load() without reading the list again on every keystroke's render.
  const opened = useRef<string | undefined>(undefined);
  opened.current = open?.prompt.id;
  const [trouble, setTrouble] = useState<keyof typeof TROUBLE>();
  // The scopes each answered prompt's cards went out at, by prompt id.
  const [published, setPublished] = useState<ReadonlyMap<string, Scope[]>>(
    new Map(),
  );

  useEffect(() => {
    let alive = true;
    api.seat(slug).then(
      (seat) => {
        if (alive) setView(seat);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [api, slug]);

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

  async function draft(answer: string, reply?: string) {
    if (!open) return;
    setBusy(true);
    setTrouble(undefined);
    try {
      const next = await api.draft({
        seat: slug,
        promptId: open.prompt.id,
        answer,
        ...(reply &&
          open.draft?.followup && {
            followup: { question: open.draft.followup.question, answer: reply },
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
        ...open,
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

  if (!view && !failed) return null; // the inbox above is what the leaver came for; this follows when ready
  const seat = view?.seat;
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
      {failed && (
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          {t("handover.promptsFailed")}
        </p>
      )}
      {prompts?.length === 0 && (
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          {t("handover.promptsEmpty")}
        </p>
      )}
      {seat &&
        prompts?.map((prompt) => {
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
              <p
                id={`${titleId}-${prompt.id}`}
                className="dd-inbox-q"
                style={{ margin: 0 }}
              >
                {prompt.text}
              </p>
              {scopes ? (
                <output ref={focusHere} tabIndex={-1} className="dd-live-note">
                  {t("handover.publishedAs", {
                    scopes: [...new Set(scopes)]
                      .map(scopeLabel)
                      .join(t("import.listSeparator")),
                  })}
                </output>
              ) : answering ? null : (
                // One prompt at a time: the others wait until this one is published or closed with やめる, so a tap
                // never throws away an answer or its drafted cards.
                <div className="dd-row" style={{ gap: "var(--s-3)" }}>
                  <button
                    type="button"
                    className="dd-btn dd-btn-primary"
                    style={{ flex: 1, minHeight: "52px" }}
                    disabled={busy || open !== undefined}
                    onClick={() => {
                      setTrouble(undefined);
                      setOpen({ prompt, mode: "voice" });
                    }}
                  >
                    {t("inbox.answerByVoice")}
                  </button>
                  <button
                    type="button"
                    className="dd-btn"
                    style={{ flex: 1, minHeight: "52px" }}
                    disabled={busy || open !== undefined}
                    onClick={() => {
                      setTrouble(undefined);
                      setOpen({ prompt, mode: "text" });
                    }}
                  >
                    {t("inbox.answerByText")}
                  </button>
                </div>
              )}
              {answering && open && (
                <div className="dd-col" style={{ gap: "var(--s-4)" }}>
                  {open.draft ? (
                    <CardReview
                      seat={seat}
                      cards={open.draft.cards}
                      followup={open.draft.followup}
                      api={api}
                      busy={busy}
                      onReply={(reply) => draft(open.answer ?? "", reply)}
                      onPublish={publish}
                    />
                  ) : (
                    <VoiceAnswer
                      key={`${prompt.id}-${open.mode}`}
                      item={{ promptId: prompt.id }}
                      seat={slug}
                      mode={open.mode}
                      api={api}
                      drafting={busy}
                      onDraft={(answer) => draft(answer)}
                      headingLevel={3}
                    />
                  )}
                  {trouble && (
                    <p className="dd-cap" style={{ margin: 0 }}>
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
              )}
            </article>
          );
        })}
    </section>
  );
}
