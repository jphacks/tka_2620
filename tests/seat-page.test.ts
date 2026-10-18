// F7.2 (issue #46): the pure side of the seat page (components/seat-page.ts). The planner writes 2026-10-20 as 「10/20 火」,
// dates within a week carry the highlighter, lineage tags hold the year's last two digits upright, and a mini stamp
// takes its digits from the byline's term.
import { describe, expect, it } from "vitest";
import {
  daysUntil,
  isSoon,
  plannerDate,
  stampDigits,
  tagLabel,
  tokyoToday,
} from "@/components/seat-page";

const TODAY = "2026-10-18"; // a Sunday

describe("plannerDate", () => {
  it("writes month/day and the weekday in the page's language", () => {
    expect(plannerDate("2026-10-20", "ja")).toEqual({
      monthDay: "10/20",
      weekday: "火",
    });
    expect(plannerDate("2026-10-20", "en")).toEqual({
      monthDay: "10/20",
      weekday: "Tue",
    });
    expect(plannerDate("2027-04-30", "ja")).toEqual({
      monthDay: "4/30",
      weekday: "金",
    });
  });
});

describe("daysUntil and isSoon", () => {
  it("counts calendar days, across a year end too", () => {
    expect(daysUntil("2026-10-20", TODAY)).toBe(2);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-10-17", TODAY)).toBe(-1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("highlights today through seven days ahead, nothing past or later", () => {
    expect(isSoon(TODAY, TODAY)).toBe(true);
    expect(isSoon("2026-10-20", TODAY)).toBe(true);
    expect(isSoon("2026-10-25", TODAY)).toBe(true);
    expect(isSoon("2026-10-26", TODAY)).toBe(false);
    expect(isSoon("2026-10-17", TODAY)).toBe(false);
  });
});

describe("tokyoToday", () => {
  it("reads Tokyo's calendar, not the phone's", () => {
    // 15:30 UTC is already 00:30 the next day in Tokyo.
    expect(tokyoToday(new Date("2026-10-18T15:30:00Z"))).toBe("2026-10-19");
    expect(tokyoToday(new Date("2026-10-18T14:59:00Z"))).toBe("2026-10-18");
  });
});

describe("tagLabel", () => {
  it("keeps the year's last two digits apart from the rest of the term", () => {
    expect(tagLabel("2024")).toEqual({ digits: "24", rest: "" });
    expect(tagLabel("2025秋")).toEqual({ digits: "25", rest: "秋" });
    expect(tagLabel("春学期")).toEqual({ digits: "", rest: "春学期" });
  });
});

describe("stampDigits", () => {
  it("takes the term's last two digits from the byline", () => {
    expect(stampDigits("2025年度 会計")).toBe("25");
    expect(stampDigits("2025秋 交換留学生")).toBe("25");
    expect(stampDigits("2025 2号館担当")).toBe("25");
  });
});
