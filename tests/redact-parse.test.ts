// Chats become messages on the device (F5.1): LINE exports in both date formats, quoted multi-line messages, pasted
// messages; stickers, photos, system lines and very short messages are dropped. The seed checks compare the
// sample's speakers without printing them (they are canaries); the other cases use other made-up names.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChat, parseLine, parsePaste, speakers } from "@/lib/redact/parse";

const sample = readFileSync(
  new URL("../seed/chat-line.sample.txt", import.meta.url),
  "utf8",
);

describe("parseLine: seed/chat-line.sample.txt", () => {
  const messages = parseLine(sample);

  it("keeps the 20 messages and drops the sticker, the photo and the unsend line", () => {
    expect(messages).toHaveLength(20);
    expect(messages.some(({ text }) => /\[(スタンプ|写真)\]/.test(text))).toBe(
      false,
    );
    expect(messages.some(({ text }) => text.includes("取り消しました"))).toBe(
      false,
    );
  });

  it("dates each message from its day line and drops the header", () => {
    expect(messages[0].at).toBe("2024-04-12T21:03");
    expect(messages[0].text).toBe(
      "部費の集金、GW明けの5/10までにお願いします!1人3000円です",
    );
    expect(messages[0].speaker === "山田太郎", "the first speaker").toBe(true);
    expect(messages.at(-1)?.at).toBe("2025-03-10T21:10");
    expect(messages.some(({ text }) => text.includes("保存日時"))).toBe(false);
  });

  it("joins a quoted multi-line message and takes its quotes off", () => {
    expect(messages.find(({ at }) => at === "2024-09-20T22:10")?.text).toBe(
      "学祭の模擬店、今年も焼きそばでいく?\n保健所の書類は学生課でもらえる\n早めに出しといて",
    );
  });

  it("lists every speaker with their message count", () => {
    const rows = speakers(messages);
    expect(rows.map(({ count }) => count)).toEqual([13, 2, 5]);
    expect(
      rows.map(({ name }) => name).join() === "山田太郎,佐藤花子,鈴木一郎",
      "the three speakers",
    ).toBe(true);
  });

  it("is what parseChat reads for line", () => {
    expect(
      JSON.stringify(parseChat(sample, "line")) === JSON.stringify(messages),
      "the same messages",
    ).toBe(true);
  });
});

describe("parseLine: other export shapes", () => {
  it("reads the dotted date line with space-separated fields and a name with a space", () => {
    const messages = parseLine(
      [
        "[LINE] テストのトーク履歴",
        "",
        "2025.10.03 金曜日",
        "21:03 高橋 健太 部費の集金は5/10まで",
        "21:05 中村美咲 了解です",
        "21:07 高橋 健太 振込先はみなと銀行です",
        "21:08 高橋健太がメッセージの送信を取り消しました",
      ].join("\n"),
    );
    expect(messages).toEqual([
      {
        at: "2025-10-03T21:03",
        speaker: "高橋 健太",
        text: "部費の集金は5/10まで",
      },
      { at: "2025-10-03T21:05", speaker: "中村美咲", text: "了解です" },
      {
        at: "2025-10-03T21:07",
        speaker: "高橋 健太",
        text: "振込先はみなと銀行です",
      },
    ]);
  });

  it("keeps the whole spaced name of someone who wrote once", () => {
    const messages = parseLine(
      "2025.10.03 金曜日\n21:03 山本 花音 部室の鍵は守衛室\n21:04 中村美咲 ありがとう!",
    );
    expect(messages.map(({ speaker, text }) => [speaker, text])).toEqual([
      ["山本 花音", "部室の鍵は守衛室"],
      ["中村美咲", "ありがとう!"],
    ]);
  });

  it("reads 午前/午後 times, CRLF line ends and a byte-order mark", () => {
    const messages = parseLine(
      "﻿2024/04/12(金)\r\n午後9:03\t高橋健太\tこんばんは、練習の件\r\n午前0:15\t小林誠\tおやすみなさい\r\n",
    );
    expect(messages.map(({ at }) => at)).toEqual([
      "2024-04-12T21:03",
      "2024-04-12T00:15",
    ]);
  });

  it("drops system lines, media and messages under four characters", () => {
    const messages = parseLine(
      [
        "2024/04/12(金)",
        "21:00\t高橋健太がグループに参加しました",
        "21:01\t中村美咲\t了解",
        "21:02\t中村美咲\t[ファイル] 予算.xlsx",
        "21:03\t中村美咲\t[ボイスメッセージ]",
        "21:04\t小林誠\t☎ 通話時間 0:42",
        "21:05\t小林誠\t小林誠が加藤を招待しました",
        "21:06\t小林誠\tキャンセル料は2週間前から",
      ].join("\n"),
    );
    expect(messages).toEqual([
      {
        at: "2024-04-12T21:06",
        speaker: "小林誠",
        text: "キャンセル料は2週間前から",
      },
    ]);
  });

  it("keeps a date line inside a quoted message, and a stray quote can't swallow the next message", () => {
    const messages = parseLine(
      [
        "2024/04/12(金)",
        '21:00\t高橋健太\t"合宿の日程',
        "2025/02/10(月)",
        '出発は8時"',
        '21:05\t中村美咲\t"焼きそば"でいく?',
        "21:06\t小林誠\tいいと思う!",
      ].join("\n"),
    );
    expect(messages.map(({ speaker, text }) => [speaker, text])).toEqual([
      ["高橋健太", "合宿の日程\n2025/02/10(月)\n出発は8時"],
      ["中村美咲", '"焼きそば"でいく?'],
      ["小林誠", "いいと思う!"],
    ]);
  });
});

describe("parsePaste", () => {
  it("reads 名前: 本文 lines; field labels and URLs are not speakers", () => {
    const messages = parsePaste(
      [
        "高橋健太: 部費は5/10までに集めます",
        "中村美咲：了解です!振込先は?",
        "高橋健太: みなと銀行です",
        "締切: 10/20",
        "https://example.com/form",
      ].join("\n"),
    );
    expect(messages).toEqual([
      { at: null, speaker: "高橋健太", text: "部費は5/10までに集めます" },
      { at: null, speaker: "中村美咲", text: "了解です!振込先は?" },
      {
        at: null,
        speaker: "高橋健太",
        text: "みなと銀行です\n締切: 10/20\nhttps://example.com/form",
      },
    ]);
  });

  it("reads Discord and Slack headers, and keeps text before any speaker", () => {
    const messages = parsePaste(
      [
        "学祭の連絡です",
        "高橋健太 — 2024/04/12 21:03",
        "保健所の書類は学生課で",
        "Misaki Nakamura [9:05 PM]",
        "Thanks, I'll get it",
        "小林誠  21:10",
        "部室で渡します",
        "[21:12] 加藤陽菜: 了解です",
        "練習 19:00",
      ].join("\n"),
    );
    expect(messages).toEqual([
      { at: null, speaker: "", text: "学祭の連絡です" },
      { at: null, speaker: "高橋健太", text: "保健所の書類は学生課で" },
      { at: null, speaker: "Misaki Nakamura", text: "Thanks, I'll get it" },
      { at: null, speaker: "小林誠", text: "部室で渡します" },
      { at: null, speaker: "加藤陽菜", text: "了解です\n練習 19:00" },
    ]);
  });
});
