// F5.7 (issue #37): the pure side of the import review (components/review.ts). The provenance chip names the kind of
// source and a month, never a file or a person; a card is held back the way POST /api/handover/publish would refuse it;
// publishing sends only the kept cards, as the person left them, and supersedes a similar note only after 「更新する」.
// Nothing here prints a canary or a seed text: the seed chat is read for its dates alone, and the rule cases use
// made-up names and numbers that aren't canaries.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cardProblem,
  duplicateOf,
  type Entry,
  entriesOf,
  type ProvenanceFrom,
  provenanceOf,
  publishCards,
  publishHold,
  stampGroup,
  stampRole,
  stampYear,
  todayInJapan,
} from "@/components/review";
import {
  BlockReason,
  type ImportedCard,
  type ImportResponse,
  PublishCard,
} from "@/lib/contracts";
import { mockImport, mockImportNotice } from "@/lib/mocks";
import { parseLine } from "@/lib/redact/parse";
import en from "@/messages/en.json";
import ja from "@/messages/ja.json";

const TODAY = "2026-10-18";
const CHIP = "貼り付け・2026年10月";

const card = (fields: Partial<ImportedCard> = {}): ImportedCard => ({
  kind: "rule_of_thumb",
  title: "領収書は全部とっておく",
  body: "領収書はすべて取っておく。宛名はサークル名にする。",
  suggested_scope: "successor",
  critical: false,
  lang: "ja",
  flags: { person_verdict: false, secret: false },
  source: "import",
  ...fields,
});

describe("provenanceOf", () => {
  it("dates a chat by its latest message, and a file or a paste by the day it was added", () => {
    const chat = readFileSync(
      new URL("../seed/chat-line.sample.txt", import.meta.url),
      "utf8",
    );
    expect(
      provenanceOf(
        { kind: "chat", platform: "line", messages: parseLine(chat) },
        TODAY,
      ),
    ).toEqual({ from: "line", month: "2025-03" });
    expect(
      provenanceOf(
        {
          kind: "chat",
          platform: "paste",
          messages: [{ at: null, speaker: "会計", text: "締切は来週です" }],
        },
        TODAY,
      ),
    ).toEqual({ from: "paste", month: "2026-10" });
    expect(
      provenanceOf(
        {
          kind: "file",
          fileType: "pdf",
          text: "お知らせ",
          name: "加藤_お知らせ.pdf",
        },
        TODAY,
      ),
    ).toEqual({ from: "pdf", month: "2026-10" });
    expect(provenanceOf({ kind: "text", text: "メモ" }, TODAY)).toEqual({
      from: "text",
      month: "2026-10",
    });
  });

  it("takes the day in Japan, which is ahead of UTC", () => {
    expect(todayInJapan(new Date("2026-10-17T15:30:00Z"))).toBe("2026-10-18");
    expect(todayInJapan(new Date("2026-10-17T14:30:00Z"))).toBe("2026-10-17");
  });
});

describe("cardProblem", () => {
  it("passes a drafted card as it came", () => {
    for (const drafted of [...mockImport.cards, ...mockImportNotice.cards]) {
      expect(cardProblem(drafted, CHIP)).toBeUndefined();
    }
  });

  it("holds back what publishing would refuse: an empty or long title or body, a deadline without a real date", () => {
    expect(cardProblem(card({ title: "  " }), CHIP)).toBe("title");
    expect(cardProblem(card({ title: "あ".repeat(101) }), CHIP)).toBe("title");
    expect(cardProblem(card({ body: "" }), CHIP)).toBe("body");
    expect(cardProblem(card({ body: "あ".repeat(2001) }), CHIP)).toBe("body");
    expect(cardProblem(card({ kind: "deadline" }), CHIP)).toBe("date");
    expect(
      cardProblem(
        card({ kind: "deadline", deadline_date: "2025-02-30" }),
        CHIP,
      ),
    ).toBe("date");
    expect(
      cardProblem(
        card({ kind: "deadline", deadline_date: "2025-02-28" }),
        CHIP,
      ),
    ).toBeUndefined();
  });

  it("holds back what the output guard refuses, in the title, the body or the chip", () => {
    expect(
      cardProblem(card({ body: "学生課の電話は 03-9876-5432 です。" }), CHIP),
    ).toBe("guard");
    expect(
      cardProblem(card({ title: "連絡は kaikei@example.com へ" }), CHIP),
    ).toBe("guard");
    expect(
      cardProblem(
        card({ flags: { person_verdict: false, secret: true } }),
        CHIP,
      ),
    ).toBe("guard");
    expect(cardProblem(card(), "PDF・03-9876-5432")).toBe("guard");
  });

  it("refuses what publishing refuses on an added card: a URL, a LINE ID, a placeholder, a name", () => {
    for (const body of [
      "申請は https://forms.gle/AbCdEf から出す。",
      "連絡は LINE: kato_kaikei へ。",
      "メンバーA が鍵を持っている。",
      "[人] に確認する。",
      "加藤さんに聞く。",
    ]) {
      expect(cardProblem(card({ body }), CHIP)).toBe("guard");
    }
  });

  it("never refuses a card for its provenance chip, in either language", () => {
    for (const [messages, months] of [
      [ja, ["2025年3月", "2026年10月"]],
      [en, ["March 2025", "October 2026"]],
    ] as const) {
      for (const from of Object.values(messages.import.from)) {
        for (const month of months) {
          const chip = messages.import.provenance
            .replace("{platform}", from)
            .replace("{month}", month);
          expect(cardProblem(card(), chip), chip).toBeUndefined();
        }
      }
    }
  });
});

describe("publishHold and publishCards", () => {
  const response: ImportResponse = mockImport; // card 2 is similar to smash-2025-ryoshusho

  it("waits for a choice on a similar note, and for nothing else once the cards are fine", () => {
    const entries = entriesOf(response);
    expect(publishHold(entries, response.duplicates, CHIP)).toBe("choose");
    entries[2] = { ...entries[2], choice: "keep" };
    expect(publishHold(entries, response.duplicates, CHIP)).toBeUndefined();
  });

  it("ignores a left-out card, and waits when nothing is kept or a kept card needs editing", () => {
    const entries = entriesOf(response);
    entries[2] = { ...entries[2], dropped: true };
    expect(publishHold(entries, response.duplicates, CHIP)).toBeUndefined();
    entries[0] = { ...entries[0], card: { ...entries[0].card, title: "" } };
    expect(publishHold(entries, response.duplicates, CHIP)).toBe("problem");
    const none = entries.map((entry): Entry => ({ ...entry, dropped: true }));
    expect(publishHold(none, response.duplicates, CHIP)).toBe("empty");
  });

  it("sends the kept cards as edited, with the chip, and supersedes only after 「更新する」", () => {
    const entries = entriesOf(response);
    entries[0] = {
      ...entries[0],
      card: { ...entries[0].card, title: "  部費の集金は4月と10月  " },
    };
    entries[1] = { ...entries[1], dropped: true };
    entries[2] = { ...entries[2], choice: "update" };
    const cards = publishCards(entries, response.duplicates, CHIP);
    expect(cards).toHaveLength(4);
    for (const sent of cards) {
      expect(PublishCard.safeParse(sent).error?.issues).toBeUndefined();
      expect(sent.provenance).toBe(CHIP);
      expect(sent.source).toBe("import");
    }
    // The suggestion, except the update, which takes the club-wide scope of the note it replaces (F5.6).
    expect(cards.map((sent) => sent.scope)).toEqual([
      "successor",
      "group",
      "successor",
      "successor",
    ]);
    expect(cards[0].title).toBe("部費の集金は4月と10月");
    expect(cards.map((sent) => sent.title)).not.toContain(
      response.cards[1].title,
    );
    expect(cards.map((sent) => sent.supersedes)).toEqual([
      undefined,
      "smash-2025-ryoshusho",
      undefined,
      undefined,
    ]);
    entries[2] = { ...entries[2], choice: "keep" };
    expect(
      publishCards(entries, response.duplicates, CHIP).some(
        (sent) => sent.supersedes,
      ),
    ).toBe(false);
  });

  it("publishes an update at the replaced note's scope when that is wider (F5.6)", () => {
    // The mock's receipts card is suggested successor; the note it matches, smash-2025-ryoshusho, is the club's (group).
    expect(response.duplicates[0].scope).toBe("group");
    const entries = entriesOf(response);
    entries[2] = { ...entries[2], choice: "update" };
    expect(publishCards(entries, response.duplicates, CHIP)[2].scope).toBe(
      "group",
    );
    entries[2] = { ...entries[2], choice: "keep" };
    expect(publishCards(entries, response.duplicates, CHIP)[2].scope).toBe(
      "successor",
    );
    // An old note no wider than the suggestion leaves the suggestion as it is.
    const narrow: ImportResponse["duplicates"] = [
      { ...response.duplicates[0], scope: "successor" },
    ];
    entries[2] = { ...entries[2], choice: "update" };
    expect(publishCards(entries, narrow, CHIP)[2].scope).toBe("successor");
  });

  it("waits when two kept cards would update the same note", () => {
    const duplicates: ImportResponse["duplicates"] = [
      { ...response.duplicates[0], card: 0 },
      { ...response.duplicates[0], card: 1 },
    ];
    const entries = entriesOf(response).map(
      (entry, index): Entry =>
        index < 2 ? { ...entry, choice: "update" } : entry,
    );
    expect(publishHold(entries, duplicates, CHIP)).toBe("twice");
    entries[1] = { ...entries[1], choice: "keep" };
    expect(publishHold(entries, duplicates, CHIP)).toBeUndefined();
  });

  it("keeps a card's own provenance over the screen's", () => {
    const [sent] = publishCards(
      [
        {
          card: card({ provenance: "LINEグループ・2024年10月" }),
          dropped: false,
        },
      ],
      [],
      CHIP,
    );
    expect(sent.provenance).toBe("LINEグループ・2024年10月");
  });
});

describe("duplicateOf", () => {
  it("gives a card its closest similar note, and nothing to the others", () => {
    const duplicates: ImportResponse["duplicates"] = [
      {
        card: 0,
        noteId: "a",
        title: "A",
        byline: "2024年度 会計",
        similarity: 0.89,
        scope: "successor",
      },
      {
        card: 0,
        noteId: "b",
        title: "B",
        byline: "2025年度 会計",
        similarity: 0.95,
        scope: "successor",
      },
      {
        card: 1,
        noteId: "c",
        title: "C",
        byline: "2025年度 会計",
        similarity: 0.9,
        scope: "group",
      },
    ];
    expect(duplicateOf(duplicates, 0)?.noteId).toBe("b");
    expect(duplicateOf(duplicates, 1)?.noteId).toBe("c");
    expect(duplicateOf(duplicates, 2)).toBeUndefined();
  });
});

describe("the date stamp", () => {
  it("shows the group in five Latin letters or three characters, and the term's year", () => {
    expect(stampGroup("テニスサークル Smash")).toBe("Smash");
    expect(stampGroup("学祭実行委員会")).toBe("学祭実");
    expect(stampGroup("TUM交換留学")).toBe("TUM");
    expect(stampRole("会計")).toBe("会計");
    expect(stampRole("模擬店担当")).toBe("模擬店");
    expect(stampRole("バイオプリンタ担当")).toBe("バイオ");
    expect(stampRole("TUM → 東大IST / 秋学期")).toBe("TUM");
    expect(stampYear("2025")).toBe("2025");
    expect(stampYear("2025秋")).toBe("2025");
  });
});

describe("the review's words", () => {
  const from: ProvenanceFrom[] = [
    "line",
    "whatsapp",
    "paste",
    "pdf",
    "docx",
    "txt",
    "md",
    "text",
  ];
  it.each([
    ["ja", ja],
    ["en", en],
  ])("%s words every source, block reason, problem and hold", (_lang, messages) => {
    const words = messages.import as unknown as Record<
      string,
      Record<string, string>
    >;
    for (const key of from) expect(words.from[key]).toBeTruthy();
    for (const key of BlockReason.options) {
      expect(words.blockedReason[key]).toBeTruthy();
    }
    for (const key of ["title", "body", "date", "guard"]) {
      expect(words.problem[key]).toBeTruthy();
    }
    for (const key of ["empty", "problem", "choose", "twice"]) {
      expect(words.hold[key]).toBeTruthy();
    }
  });
});
