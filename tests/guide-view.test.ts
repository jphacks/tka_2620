import { describe, expect, it } from "vitest";
import {
  ALL,
  bylinesOf,
  escapeMarkdown,
  filterNotes,
  groupByKind,
  guideFileName,
  guideMarkdown,
  type MarkdownWords,
  matches,
  nextDue,
  sortNotes,
} from "@/components/guide";
import type { GuideNote } from "@/lib/contracts";

const note = (over: Partial<GuideNote> & Pick<GuideNote, "id">): GuideNote => ({
  kind: "rule_of_thumb",
  title: "領収書は月末にまとめて精算",
  body: "月末に会計がまとめて精算します。",
  byline: "2025年度 会計",
  termOrder: 2025,
  lang: "ja",
  ...over,
});

const notes: GuideNote[] = [
  note({
    id: "a",
    kind: "deadline",
    title: "保健所申請の締切",
    deadlineDate: "2024-10-27",
    byline: "2024年度 会計",
    termOrder: 2024,
  }),
  note({
    id: "b",
    kind: "deadline",
    title: "保健所申請の締切が早くなった",
    deadlineDate: "2025-10-20",
  }),
  note({
    id: "c",
    kind: "contact",
    title: "学生課の窓口",
    byline: "2024年度 会計",
    termOrder: 2024,
  }),
  note({ id: "d", kind: "pitfall", title: "合宿費の集金" }),
  note({
    id: "e",
    kind: "deadline",
    title: "部費の締切",
    deadlineDate: "2025-04-30",
  }),
];
const TODAY = "2026-10-18";

describe("handover guide: filter, sort, group", () => {
  it("lists who wrote the notes by byline, newest term first", () => {
    expect(bylinesOf(notes)).toEqual(["2025年度 会計", "2024年度 会計"]);
  });

  it("filters by kind and by byline, and all keeps everything", () => {
    expect(
      filterNotes(notes, { kind: ALL, byline: ALL, sort: "newest" }),
    ).toHaveLength(5);
    expect(
      filterNotes(notes, { kind: "deadline", byline: ALL, sort: "newest" }).map(
        (n) => n.id,
      ),
    ).toEqual(["a", "b", "e"]);
    expect(
      filterNotes(notes, {
        kind: ALL,
        byline: "2024年度 会計",
        sort: "newest",
      }).map((n) => n.id),
    ).toEqual(["a", "c"]);
    expect(
      filterNotes(notes, {
        kind: "pitfall",
        byline: "2024年度 会計",
        sort: "newest",
      }),
    ).toEqual([]);
  });

  it("searches title, body and byline, every word, whatever the width or case", () => {
    const f = (query: string) =>
      filterNotes(notes, { kind: ALL, byline: ALL, sort: "newest", query }).map(
        (n) => n.id,
      );
    expect(f("保健所")).toEqual(["a", "b"]);
    expect(f("2024年度")).toEqual(["a", "c"]);
    expect(f("保健所 2025")).toEqual(["b"]);
    expect(f("  ")).toHaveLength(5);
    expect(matches("ＡＢＣ", "abc の手順")).toBe(true);
    expect(matches("合宿", "部費の締切")).toBe(false);
  });

  it("puts a yearly deadline at its next occurrence on or after today", () => {
    expect(nextDue("2025-10-20", TODAY)).toBe("2026-10-20");
    expect(nextDue("2025-04-30", TODAY)).toBe("2027-04-30");
    expect(nextDue("2026-10-18", TODAY)).toBe("2026-10-18");
    expect(nextDue("2024-02-29", "2025-03-01")).toBe("2026-02-28");
  });

  it("sorts newest term first, oldest first, or the nearest deadline first", () => {
    expect(sortNotes(notes, "newest", TODAY).map((n) => n.termOrder)).toEqual([
      2025, 2025, 2025, 2024, 2024,
    ]);
    expect(sortNotes(notes, "oldest", TODAY).map((n) => n.termOrder)).toEqual([
      2024, 2024, 2025, 2025, 2025,
    ]);
    // 10/20 (2026), then 10/27 (2026), then 4/30 (2027); notes without a deadline after them
    expect(sortNotes(notes, "deadline", TODAY).map((n) => n.id)).toEqual([
      "b",
      "a",
      "e",
      "d",
      "c",
    ]);
  });

  it("groups by kind in the kinds' order, keeping the sort", () => {
    const groups = groupByKind(sortNotes(notes, "deadline", TODAY));
    expect(groups.map((g) => g.kind)).toEqual([
      "deadline",
      "contact",
      "pitfall",
    ]);
    expect(groups[0].notes.map((n) => n.id)).toEqual(["b", "a", "e"]);
  });
});

describe("handover guide: Markdown export", () => {
  it("escapes links, images, HTML and structure in a predecessor's words", () => {
    expect(escapeMarkdown("[ここ](https://example.com)")).toBe(
      "\\[ここ\\](https\\://example.com)",
    );
    expect(escapeMarkdown("<img src=x onerror=alert(1)>")).toBe(
      "\\<img src=x onerror=alert(1)\\>",
    );
    expect(escapeMarkdown("# 見出し\n- 箇条書き\n1. 番号")).toBe(
      "\\# 見出し\n\\- 箇条書き\n1\\. 番号",
    );
    expect(escapeMarkdown("**太字** と `code`")).toBe(
      "\\*\\*太字\\*\\* と \\`code\\`",
    );
    expect(escapeMarkdown("10/20まで、2,000円")).toBe("10/20まで、2,000円");
  });

  it("keeps bare URLs, www. addresses, emails and underlines from turning into links or headings", () => {
    expect(escapeMarkdown("詳しくは https://evil.example を見る")).toBe(
      "詳しくは https\\://evil.example を見る",
    );
    expect(escapeMarkdown("www.example.jp")).toBe("www\\.example.jp");
    expect(escapeMarkdown("kaikei@example.com")).toBe("kaikei\\@example.com");
    expect(escapeMarkdown("見出し\n===")).toBe("見出し\n\\===");
  });

  it("writes the guide with its date, rules, sections, open items and answers", () => {
    const words: MarkdownWords = {
      title: "会計の引き継ぎ書",
      where: "テニスサークル Smash（みなと大学）",
      asOf: "2026年10月18日時点",
      rules: "あなたが読めるメモだけをまとめています。",
      upcomingHeading: "これからの締切",
      upcoming: ["10/20 火 保健所申請の締切が早くなった（2025年度 会計）"],
      sections: [
        {
          heading: "〆 締切",
          notes: [
            {
              title: "保健所申請の締切が早くなった",
              deadline: "締切 2025年10月20日",
              body: "今年から10/20。\n[リンク](x)",
              byline: "2025年度 会計",
            },
          ],
        },
      ],
      openHeading: "まだ書かれていないこと",
      open: ["口座の代表者を変える手順（毎年会計に聞いていること）"],
      askedHeading: "あなたの質問と答え",
      asked: [
        {
          question: "模擬店の保健所申請、いつまで？",
          sentences: ["10/20までです。（2025年度 会計）"],
        },
      ],
      source: "最新の内容：http://127.0.0.1:3000/s/smash-kaikei/guide",
    };
    const text = guideMarkdown(words);
    expect(text.startsWith("# 会計の引き継ぎ書\n")).toBe(true);
    expect(text).toContain("> あなたが読めるメモだけをまとめています。");
    expect(text).toContain(
      "## これからの締切\n\n- 10/20 火 保健所申請の締切が早くなった（2025年度 会計）",
    );
    expect(text).toContain(
      "### 保健所申請の締切が早くなった\n\n**締切 2025年10月20日**",
    );
    expect(text).toContain("今年から10/20。  \n\\[リンク\\](x)"); // line breaks kept, the link escaped
    expect(text).toContain("— 2025年度 会計");
    expect(text).toContain("- [ ] 口座の代表者を変える手順");
    expect(text).toContain(
      "### 模擬店の保健所申請、いつまで？\n\n- 10/20までです。（2025年度 会計）",
    );
    expect(
      text
        .trimEnd()
        .endsWith("最新の内容：http://127.0.0.1:3000/s/smash-kaikei/guide"),
    ).toBe(true);
  });

  it("names the file by seat and Tokyo's date, ASCII only", () => {
    expect(guideFileName("smash-kaikei", "2026-10-18")).toBe(
      "daidai-smash-kaikei-2026-10-18.md",
    );
  });
});
