// The pure side of the handover guide (引き継ぎ書, /s/[seat]/guide): filter and sort the notes, group them by kind, and
// write the Markdown export. No i18n here: the page passes every word in, so the export reads in the page's language.
// Tested in node (tests/guide-view.test.ts), like components/seat-page.ts.
import { daysUntil } from "@/components/seat-page";
import type { GuideNote } from "@/lib/contracts";
import { NoteKind } from "@/lib/contracts";

export const KINDS = NoteKind.options; // deadline, contact, rule_of_thumb, pitfall, unwritten_rule
export type KindFilter = NoteKind | "all";
// newest: the latest term's notes first; oldest: the first predecessor's first; deadline: the nearest deadline first.
export const SORTS = ["newest", "oldest", "deadline"] as const;
export type GuideSort = (typeof SORTS)[number];
// query: free text matched against a note's title, body and byline (width and case don't matter: Ｈ = h).
export type GuideFilter = {
  kind: KindFilter;
  byline: string;
  sort: GuideSort;
  query?: string;
};

// For matching only: full- and half-width forms alike (NFKC), case ignored.
export const searchable = (text: string) =>
  text.normalize("NFKC").toLowerCase();
export const matches = (query: string | undefined, ...texts: string[]) => {
  const words = searchable(query ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const haystack = searchable(texts.join("\n"));
  return words.every((word) => haystack.includes(word));
};
export const ALL = "all";

// Who wrote the notes, as the guide may say it: the byline (「2025年度 会計」), never a name. Newest term first.
export function bylinesOf(notes: GuideNote[]): string[] {
  const latest = new Map<string, number>();
  for (const note of notes) {
    latest.set(
      note.byline,
      Math.max(latest.get(note.byline) ?? note.termOrder, note.termOrder),
    );
  }
  return [...latest.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([byline]) => byline);
}

export function filterNotes(
  notes: GuideNote[],
  filter: GuideFilter,
): GuideNote[] {
  return notes.filter(
    (note) =>
      (filter.kind === ALL || note.kind === filter.kind) &&
      (filter.byline === ALL || note.byline === filter.byline) &&
      matches(filter.query, note.title, note.body, note.byline),
  );
}

// A deadline's next occurrence on or after today (YYYY-MM-DD, Tokyo's date): it comes back every year, so a
// predecessor's 2025-10-20 is next due 2026-10-20 (the engine's nextOccurrence, lib/engine/seat.ts, for the planner).
export function nextDue(date: string, today: string): string {
  if (date >= today) return date;
  const [, month, day] = date.split("-");
  const year = Number(today.slice(0, 4));
  const candidate = (y: number) => {
    // 29 February falls on the 28th in a common year.
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const d = month === "02" && day === "29" && !leap ? "28" : day;
    return `${y}-${month}-${d}`;
  };
  const thisYear = candidate(year);
  return thisYear >= today ? thisYear : candidate(year + 1);
}

export function sortNotes(
  notes: GuideNote[],
  sort: GuideSort,
  today: string,
): GuideNote[] {
  const kindOrder = (note: GuideNote) => KINDS.indexOf(note.kind);
  return notes.toSorted((a, b) => {
    if (sort === "deadline") {
      // Deadlines first, the nearest first; the other notes after them, newest term first.
      const aDays = a.deadlineDate
        ? daysUntil(nextDue(a.deadlineDate, today), today)
        : Number.POSITIVE_INFINITY;
      const bDays = b.deadlineDate
        ? daysUntil(nextDue(b.deadlineDate, today), today)
        : Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return (
        b.termOrder - a.termOrder ||
        kindOrder(a) - kindOrder(b) ||
        a.id.localeCompare(b.id)
      );
    }
    const byTerm =
      sort === "oldest" ? a.termOrder - b.termOrder : b.termOrder - a.termOrder;
    return (
      byTerm ||
      kindOrder(a) - kindOrder(b) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    );
  });
}

// The guide's sections: one per kind that has notes, in the kinds' order, each keeping the sort it was given.
export function groupByKind(
  notes: GuideNote[],
): { kind: NoteKind; notes: GuideNote[] }[] {
  return KINDS.map((kind) => ({
    kind,
    notes: notes.filter((note) => note.kind === kind),
  })).filter((group) => group.notes.length > 0);
}

// Note text is a predecessor's words, not Markdown: anything that would turn into a link, an image, HTML or structure
// in a Markdown viewer is escaped, so the export shows exactly what the page shows. That includes the links viewers make
// on their own from a bare URL, a www. address or an email (the escaped character splits the match), and a line of
// = or - under text, which would make it a heading.
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\\`*_[\]<>|~@]/g, (char) => `\\${char}`)
    .replace(/:\/\//g, "\\://")
    .replace(/\b(www)\./gi, "$1\\.")
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)([#>+=-])/, "$1\\$2")
        .replace(/^(\s*\d+)([.)])/, "$1\\$2"),
    )
    .join("\n");
}

export type MarkdownWords = {
  title: string; // 「会計の引き継ぎ書」
  where: string; // 「テニスサークル Smash（みなと大学）」
  asOf: string; // 「2026年10月18日時点」
  rules: string; // what the guide holds and leaves out
  filtered?: string; // the filter in force, when there is one
  upcomingHeading: string;
  upcoming: string[]; // each already worded: date, title and whose note
  sections: {
    heading: string;
    notes: { title: string; deadline?: string; body: string; byline: string }[];
  }[];
  openHeading: string;
  open: string[]; // each item with its reason, already worded
  openNote?: string; // why the list is empty or unchecked
  askedHeading: string;
  asked: { question: string; sentences: string[] }[]; // each sentence already ends with its byline
  source: string; // where the latest version lives (the app's own words and address, written as is)
};

export function guideMarkdown(words: MarkdownWords): string {
  const lines: string[] = [
    `# ${escapeMarkdown(words.title)}`,
    "",
    escapeMarkdown(words.where),
    escapeMarkdown(words.asOf),
    "",
  ];
  lines.push(`> ${escapeMarkdown(words.rules)}`, "");
  if (words.filtered) lines.push(`> ${escapeMarkdown(words.filtered)}`, "");
  if (words.upcoming.length > 0) {
    lines.push(`## ${escapeMarkdown(words.upcomingHeading)}`, "");
    for (const item of words.upcoming) lines.push(`- ${escapeMarkdown(item)}`);
    lines.push("");
  }
  for (const section of words.sections) {
    lines.push(`## ${escapeMarkdown(section.heading)}`, "");
    for (const note of section.notes) {
      lines.push(`### ${escapeMarkdown(note.title)}`, "");
      if (note.deadline) lines.push(`**${escapeMarkdown(note.deadline)}**`, "");
      // Two trailing spaces keep the predecessor's own line breaks.
      lines.push(
        escapeMarkdown(note.body).split("\n").join("  \n"),
        "",
        `— ${escapeMarkdown(note.byline)}`,
        "",
      );
    }
  }
  if (words.open.length > 0 || words.openNote) {
    lines.push(`## ${escapeMarkdown(words.openHeading)}`, "");
    if (words.openNote) lines.push(escapeMarkdown(words.openNote), "");
    for (const item of words.open) lines.push(`- [ ] ${escapeMarkdown(item)}`);
    if (words.open.length > 0) lines.push("");
  }
  if (words.asked.length > 0) {
    lines.push(`## ${escapeMarkdown(words.askedHeading)}`, "");
    for (const entry of words.asked) {
      lines.push(`### ${escapeMarkdown(entry.question)}`, "");
      for (const sentence of entry.sentences)
        lines.push(`- ${escapeMarkdown(sentence)}`);
      lines.push("");
    }
  }
  // The page's own address, so the reader can find the latest version: ours, not a predecessor's words, and meant to be a link.
  lines.push("---", "", words.source, "");
  return lines.join("\n");
}

// The saved file's name: the seat and Tokyo's date, ASCII only, so every phone and laptop keeps it as is.
export function guideFileName(slug: string, today: string): string {
  return `daidai-${slug}-${today}.md`;
}
