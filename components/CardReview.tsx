"use client";
// The drafted cards of one handover answer, for the predecessor to check before anything is kept (docs/SPEC.md → F6;
// docs/DESIGN.md → NoteEntry, ScopeRings). The one follow-up comes first when the draft asked one (F6.3): answering it
// drafts again, skipping it keeps the cards as they are. Then each card with its scope rings (default 「次の会計だけ」),
// and, only when the seat's settings turn them on, how long it stays valid and whether the group keeps it. 公開する
// hands the cards up as PublishCards.
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useId, useState } from "react";
import { kindMarks } from "@/components/marks";
import { ScopeRings } from "@/components/ScopeRings";
import {
  type Api,
  type CardDraft,
  type Followup,
  IsoDate,
  type PublishCard,
  type Scope,
  type SeatView,
} from "@/lib/contracts";

// What the predecessor picks per card; the draft's own fields stay as drafted.
type Choice = { scope: Scope; validUntil?: string; critical: boolean };

const choiceOf = (card: CardDraft): Choice => ({
  scope: "successor", // docs/DESIGN.md: scope defaults to successor, whatever the draft suggests
  validUntil: card.valid_until,
  critical: card.critical,
});

// A deadline as the page's language writes a full date: 2025年10月20日, October 20, 2025.
function dateLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function ReviewedCard({
  card,
  choice,
  seat,
  api,
  disabled,
  onChange,
}: {
  card: CardDraft;
  choice: Choice;
  seat: SeatView["seat"];
  api: Pick<Api, "readers">;
  disabled: boolean;
  onChange: (next: Choice) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const ids = useId();
  const date =
    card.kind === "deadline" && IsoDate.safeParse(card.deadline_date).success
      ? card.deadline_date
      : undefined;
  return (
    <article className="dd-slip dd-entry" aria-labelledby={`${ids}-title`}>
      <p className="dd-kind" style={{ margin: 0 }}>
        <span className="dd-kind-mark" aria-hidden="true">
          {kindMarks[card.kind]}
        </span>
        {t(`kinds.${card.kind}`)}
      </p>
      <h4 id={`${ids}-title`} className="dd-h dd-phrase" lang={card.lang}>
        {card.title}
      </h4>
      {date && (
        <p className="dd-fig" style={{ margin: 0 }}>
          <mark className="dd-marker">{dateLabel(date, locale)}</mark>
        </p>
      )}
      <div className="dd-ruled" lang={card.lang}>
        <p className="dd-phrase">{card.body}</p>
      </div>
      <ScopeRings
        seat={seat}
        value={choice.scope}
        api={api}
        disabled={disabled}
        onChange={(scope) => onChange({ ...choice, scope })}
      />
      {seat.settings.noteExpiry && (
        <>
          <label className="dd-label" htmlFor={`${ids}-until`}>
            {t("handover.validUntil")}
          </label>
          <input
            id={`${ids}-until`}
            type="date"
            className="dd-input dd-fig"
            value={choice.validUntil ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...choice,
                validUntil: event.target.value || undefined,
              })
            }
          />
        </>
      )}
      {seat.settings.groupOwnsCriticalNotes && (
        <label className="dd-check">
          <input
            type="checkbox"
            checked={choice.critical}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...choice, critical: event.target.checked })
            }
          />
          {t("handover.critical", { group: seat.group })}
        </label>
      )}
    </article>
  );
}

export function CardReview({
  seat,
  cards,
  followup,
  api,
  busy,
  onReply,
  onPublish,
}: {
  seat: SeatView["seat"];
  cards: CardDraft[];
  /** The draft's one follow-up, until it is answered or skipped. */
  followup?: Followup;
  api: Pick<Api, "readers">;
  /** Drafting again or publishing: the controls wait. */
  busy: boolean;
  onReply: (reply: string) => void;
  onPublish: (cards: PublishCard[]) => void;
}) {
  const t = useTranslations();
  const ids = useId();
  // Each section comes into view as it appears (the follow-up, then the cards), as VoiceAnswer's do, so 公開する
  // isn't left under the verb tabs on a phone. The two sections carry their own keys, so the ref runs for each.
  const intoView = useCallback((node: HTMLElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);
  const [choices, setChoices] = useState<Choice[]>(() => cards.map(choiceOf));
  const [reply, setReply] = useState("");
  const [skipped, setSkipped] = useState(false);
  // Drafting again after the follow-up gives new cards: their choices start over.
  const [drafted, setDrafted] = useState(cards);
  if (drafted !== cards) {
    setDrafted(cards);
    setChoices(cards.map(choiceOf));
  }

  if (followup && !skipped) {
    return (
      <section
        key="followup"
        ref={intoView}
        className="dd-slip dd-entry"
        aria-labelledby={`${ids}-q`}
      >
        <p id={`${ids}-q`} className="dd-inbox-q" style={{ marginTop: 0 }}>
          {followup.question}
        </p>
        <label className="dd-label" htmlFor={`${ids}-reply`}>
          {t("handover.followupLabel")}
        </label>
        <input
          id={`${ids}-reply`}
          className="dd-input"
          value={reply}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setReply(event.target.value)}
        />
        <div className="dd-row" style={{ gap: "var(--s-3)" }}>
          <button
            type="button"
            className="dd-btn dd-btn-primary"
            style={{ flex: 1, minHeight: "52px" }}
            disabled={!reply.trim() || busy}
            onClick={() => onReply(reply.trim())}
          >
            {busy ? t("handover.drafting") : t("handover.followupSend")}
          </button>
          <button
            type="button"
            className="dd-link"
            style={{ minHeight: "44px" }}
            disabled={busy}
            onClick={() => setSkipped(true)}
          >
            {t("handover.followupSkip")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      key="review"
      ref={intoView}
      className="dd-col"
      style={{ gap: "var(--s-4)" }}
    >
      <h3 className="dd-h">{t("handover.reviewTitle")}</h3>
      {cards.map((card, index) => (
        <ReviewedCard
          // biome-ignore lint/suspicious/noArrayIndexKey: drafted cards have no id and keep their order
          key={index}
          card={card}
          choice={choices[index] ?? choiceOf(card)}
          seat={seat}
          api={api}
          disabled={busy}
          onChange={(next) =>
            setChoices((current) =>
              current.map((old, at) => (at === index ? next : old)),
            )
          }
        />
      ))}
      <button
        type="button"
        className="dd-btn dd-btn-primary"
        style={{ minHeight: "52px" }}
        disabled={busy || cards.length === 0}
        onClick={() =>
          onPublish(
            cards.map((card, index) => {
              const choice = choices[index] ?? choiceOf(card);
              return {
                ...card,
                scope: choice.scope,
                critical: seat.settings.groupOwnsCriticalNotes
                  ? choice.critical
                  : card.critical,
                valid_until: seat.settings.noteExpiry
                  ? choice.validUntil
                  : card.valid_until,
              };
            }),
          )
        }
      >
        {busy ? t("voice.publishing") : t("handover.publish")}
      </button>
    </section>
  );
}
