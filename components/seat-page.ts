// The pure side of the seat page (F7.2): an upcoming deadline's planner date and how soon it is, a lineage tag's label,
// and a mini stamp's digits. Tested in node (tests/seat-page.test.ts), like components/redaction.ts.

// docs/DESIGN.md → UpcomingList: dates within 7 days carry the highlighter.
export const SOON_DAYS = 7;

// Today on the Japanese calendar, the one the engine dates deadlines by (GET /api/seats/[slug] → upcoming), wherever the
// phone's clock is set.
export function tokyoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    now,
  );
}

// A YYYY-MM-DD date as the planner writes it: 10/20 and its weekday in the page's language (火, Tue). The weekday is
// read in UTC from a UTC date, so the calendar day never shifts with the phone's time zone.
export function plannerDate(
  date: string,
  locale: string,
): { monthDay: string; weekday: string } {
  const [, month, day] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  }).format(utc(date));
  return { monthDay: `${month}/${day}`, weekday };
}

// Whole days from today to the date (both YYYY-MM-DD): 0 on the day, negative once it has passed.
export function daysUntil(date: string, today: string): number {
  return Math.round((utc(date) - utc(today)) / 86_400_000);
}

export function isSoon(date: string, today: string): boolean {
  const days = daysUntil(date, today);
  return days >= 0 && days <= SOON_DAYS;
}

function utc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// A lineage tag's vertical label: the year's last two digits as one upright unit, then the rest of the term
// (「2025秋」 → 25 and 秋). A term without a year is all rest.
export function tagLabel(termLabel: string): { digits: string; rest: string } {
  const year = termLabel.match(/\d{4}/)?.[0];
  if (!year) return { digits: "", rest: termLabel };
  return { digits: year.slice(-2), rest: termLabel.replace(year, "") };
}

// A mini stamp's digits from a byline: the last two of its term, which every label pack's byline starts with (0003
// may_sign): 「2025年度 会計」 → 25, 「2025秋 交換留学生」 → 25. The first run only, so digits in a seat name never count.
export function stampDigits(byline: string): string {
  return (byline.match(/\d+/)?.[0] ?? "").slice(-2);
}
