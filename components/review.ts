// The pure side of the import review (docs/SPEC.md → adding knowledge, steps 8–10; F5.7): where the drafted notes came
// from (the provenance chip), what keeps a card from being published, and the cards POST /api/handover/publish gets.
// No React, so tests/review.test.ts runs it.
import type { Source } from "@/components/redaction";
import {
  type ImportedCard,
  type ImportResponse,
  IsoDate,
  type PublishCard,
  Scope,
} from "@/lib/contracts";
import { shownReason } from "@/lib/engine/shown";
import type { FileType } from "@/lib/ingest/types";

// Where the text came from, worded on the screen (messages → import.from, import.provenance: 「LINEグループ・2025年3月」):
// the kind of source and a month. Never a file name (LINE names a one-to-one export after the other person) or a
// group's name.
export type ProvenanceFrom = "line" | "whatsapp" | "paste" | FileType | "text";
export type Provenance = { from: ProvenanceFrom; month: string }; // month: YYYY-MM

// A chat is as of its latest message; a file or a paste is as of the day it was added.
export function provenanceOf(source: Source, today: string): Provenance {
  switch (source.kind) {
    case "text":
      return { from: "text", month: today.slice(0, 7) };
    case "file":
      return { from: source.fileType, month: today.slice(0, 7) };
    case "chat": {
      let latest: string | undefined;
      for (const { at } of source.messages) {
        if (at && (!latest || at > latest)) latest = at;
      }
      return { from: source.platform, month: (latest ?? today).slice(0, 7) };
    }
  }
}

// The day in Japan, as lib/engine/import.ts dates an import: YYYY-MM-DD.
export function todayInJapan(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    now,
  );
}

// One drafted card under review: the card as the person left it, whether they left it out, and what they chose for its
// similar note (「更新する」 or 「別のメモとして残す」; unset until they choose).
export type Entry = {
  card: ImportedCard;
  dropped: boolean;
  choice?: "update" | "keep";
};

export const entriesOf = (response: ImportResponse): Entry[] =>
  response.cards.map((card) => ({ card, dropped: false }));

// The similar live note a card is closest to (duplicates: card is an index into cards).
export function duplicateOf(
  duplicates: ImportResponse["duplicates"],
  index: number,
): ImportResponse["duplicates"][number] | undefined {
  let closest: ImportResponse["duplicates"][number] | undefined;
  for (const duplicate of duplicates) {
    if (
      duplicate.card === index &&
      (!closest || duplicate.similarity > closest.similarity)
    ) {
      closest = duplicate;
    }
  }
  return closest;
}

// PublishCard's limits (lib/contracts.ts), so a card that passes here never fails on length when publishing.
const TITLE_MAX = 100;
const BODY_MAX = 2000;

export type Problem = "title" | "body" | "date" | "guard";

// What keeps a card from being published, checked the way POST /api/handover/publish checks an added card: a title and
// a body within the limits, a date on a deadline, and nothing its import's guard refuses in what a reader will see (the
// title, the body and the provenance chip; lib/engine/shown.ts). The server checks again, with the seed canaries too.
export function cardProblem(
  card: ImportedCard,
  provenance: string,
): Problem | undefined {
  const title = card.title.trim();
  const body = card.body.trim();
  if (!title || title.length > TITLE_MAX) return "title";
  if (!body || body.length > BODY_MAX) return "body";
  if (
    card.kind === "deadline" &&
    !IsoDate.safeParse(card.deadline_date).success
  ) {
    return "date";
  }
  const shown = [title, body, card.provenance ?? provenance].join("\n");
  if (shownReason(shown, card.flags.secret)) return "guard";
  return undefined;
}

// The rings, narrowest first.
const RINGS = Scope.options;

// The scope a card is published at: the draft's suggestion (successor unless the model said otherwise; the scope picker
// is F6.4), or for 「更新する」 the replaced note's scope when that is wider. The database refuses an update narrower
// than the note it replaces, whose readers would lose it (F5.6, #36); a duplicate carries that scope from then on, and
// until then the suggestion stands.
export function scopeOf(
  entry: Entry,
  similar: ImportResponse["duplicates"][number] | undefined,
): Scope {
  const suggested = entry.card.suggested_scope;
  if (entry.choice !== "update") return suggested;
  const replaced = Scope.safeParse(
    (similar as { scope?: unknown } | undefined)?.scope,
  ).data;
  return replaced && RINGS.indexOf(replaced) > RINGS.indexOf(suggested)
    ? replaced
    : suggested;
}

// Why 公開する waits, if it does: nothing is kept, a kept card needs editing, a kept card's similar note has no choice
// yet, or two kept cards would update the same note (publish refuses that).
export type Hold = "empty" | "problem" | "choose" | "twice";

export function publishHold(
  entries: Entry[],
  duplicates: ImportResponse["duplicates"],
  provenance: string,
): Hold | undefined {
  const kept = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.dropped);
  if (kept.length === 0) return "empty";
  if (kept.some(({ entry }) => cardProblem(entry.card, provenance))) {
    return "problem";
  }
  if (
    kept.some(
      ({ entry, index }) => !entry.choice && duplicateOf(duplicates, index),
    )
  ) {
    return "choose";
  }
  const replaced = kept
    .filter(({ entry }) => entry.choice === "update")
    .map(({ index }) => duplicateOf(duplicates, index)?.noteId);
  if (new Set(replaced).size < replaced.length) return "twice";
  return undefined;
}

// The cards POST /api/handover/publish gets: the kept ones as the person left them, trimmed, at their scope (scopeOf),
// with where they came from (import is stateless, so publish is told) and the provenance chip, superseding the similar
// note when 「更新する」 was chosen.
export function publishCards(
  entries: Entry[],
  duplicates: ImportResponse["duplicates"],
  provenance: string,
): PublishCard[] {
  return entries.flatMap((entry, index): PublishCard[] => {
    if (entry.dropped) return [];
    const { source, provenance: given, ...draft } = entry.card;
    const similar = duplicateOf(duplicates, index);
    const supersedes = entry.choice === "update" ? similar?.noteId : undefined;
    return [
      {
        ...draft,
        title: draft.title.trim(),
        body: draft.body.trim(),
        scope: scopeOf(entry, similar),
        source,
        provenance: given ?? provenance,
        ...(supersedes && { supersedes }),
      },
    ];
  });
}

// The group on the date stamp's bottom tier (docs/DESIGN.md → Date stamp: at most five Latin letters or three kanji):
// 「テニスサークル Smash」 → Smash, otherwise the group's first three characters.
export function stampGroup(group: string): string {
  const last = group.trim().split(/\s+/).pop() ?? "";
  if (/^[A-Za-z]{1,5}$/.test(last)) return last;
  return [...group.replace(/\s+/g, "")].slice(0, 3).join("");
}

// The year the stamp's middle band shows: the term's four digits (「2025秋」 → 2025), or the term itself.
export const stampYear = (termLabel: string): string =>
  termLabel.match(/\d{4}/)?.[0] ?? termLabel;
