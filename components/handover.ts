// The pure side of the handover prompts (F6.4, #43): which prompts the list shows after it reads the server's again, and
// the cards 公開する sends from the review. No React, so tests/handover.test.ts runs it.
import type {
  CardDraft,
  HandoverPrompt,
  PublishCard,
  Scope,
  SeatView,
} from "@/lib/contracts";

// What the predecessor picks per card; the draft's own fields stay as drafted.
export type Choice = { scope: Scope; validUntil?: string; critical: boolean };

export const choiceOf = (card: CardDraft): Choice => ({
  scope: "successor", // docs/DESIGN.md: scope defaults to successor, whatever the draft suggests
  validUntil: card.valid_until,
  critical: card.critical,
});

// The list after a re-read. Until a prompt is answered or open, nothing is under the person's thumb yet: the server's
// ranking as it is. After that, a prompt already shown keeps its place while the server lists it, once it is published
// (the server stops listing a prompt the caller answered) or while it is being answered (a newcomer's question can push
// it out of the server's three). Only a newcomer's question joins below: each publish has the server list the next gap
// or core prompt, which waits for the next visit, so the three answered read as done.
export function mergePrompts(
  current: HandoverPrompt[],
  next: HandoverPrompt[],
  published: ReadonlyMap<string, unknown>,
  openId: string | undefined,
): HandoverPrompt[] {
  if (published.size === 0 && openId === undefined) return next;
  const listed = new Set(next.map((prompt) => prompt.id));
  const kept = current.filter(
    (prompt) =>
      listed.has(prompt.id) || published.has(prompt.id) || prompt.id === openId,
  );
  const known = new Set(kept.map((prompt) => prompt.id));
  return [
    ...kept,
    ...next.filter(
      (prompt) => !known.has(prompt.id) && prompt.reason === "demand",
    ),
  ];
}

// The cards 公開する sends, each at its chosen scope. A setting that is off shows no control, so it publishes nothing
// either: no expiry the author never saw (a deadline note would leave answers right after its date), never critical.
export function publishCardsOf(
  cards: CardDraft[],
  choices: Choice[],
  settings: SeatView["seat"]["settings"],
): PublishCard[] {
  return cards.map((card, index) => {
    const choice = choices[index] ?? choiceOf(card);
    return {
      ...card,
      scope: choice.scope,
      critical: settings.groupOwnsCriticalNotes ? choice.critical : false,
      valid_until: settings.noteExpiry ? choice.validUntil : undefined,
    };
  });
}
