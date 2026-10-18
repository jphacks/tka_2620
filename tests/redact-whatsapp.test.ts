// F5.2 (issue #32): WhatsApp exports become the same messages as LINE ones, so the redaction is shared. One made-up
// chat, exported from Android and from an iPhone, reads as the same messages and redacts like the seed LINE chat
// (tests/redact.test.ts): no speaker's name, nobody named in a system line, no phone number, email, account or PIN is
// left, and a second pass finds nothing. The names and numbers are made up and none is a canary (checked below).
import { describe, expect, it } from "vitest";
import { parseChat, parseWhatsApp, speakers } from "@/lib/redact/parse";
import { redactChat, redactText } from "@/lib/redact/redact";
import { leaked, nothing } from "./canaries";

const LRM = String.fromCharCode(0x200e); // an iPhone starts system and media lines with it
const NARROW_SPACE = String.fromCharCode(0x202f); // before PM in newer exports

// Chat → Export chat → without media, on Android.
const ANDROID = [
  "16/10/2025, 17:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.",
  '16/10/2025, 17:00 - 加藤 健 created group "テニス部 会計"',
  "16/10/2025, 17:01 - 加藤 健 added 小林 陽菜",
  "16/10/2025, 17:03 - 加藤 健: 部費の集金は10/20までにお願いします。1人3000円です",
  "16/10/2025, 17:05 - 高橋 美咲: 了解です。振込先を教えてください",
  "16/10/2025, 17:06 - 加藤 健: みなと銀行 本店 普通 7654321 です",
  "16/10/2025, 17:06 - 加藤 健: <Media omitted>",
  "16/10/2025, 17:08 - +81 80-9876-5432: 保健所の書類はどこでもらえますか?",
  "16/10/2025, 17:10 - 高橋 美咲: @818098765432 学生課の窓口です。わからなかったら hokenjo@example.jp か 03-9876-5432 に",
  "16/10/2025, 17:12 - 加藤 健: 金庫の暗証番号",
  "16/10/2025, 17:12 - 加藤 健: 4242",
  "16/10/2025, 17:15 - 高橋 美咲: This message was deleted",
  "17/10/2025, 9:30 - 加藤 健: 領収書の宛名は「テニス部」で <This message was edited>",
  "17/10/2025, 9:31 - 加藤 健: 合宿の予定",
  "2025/10/20(月)",
  "9:00 正門 集合です",
  "17/10/2025, 9:40 - 小林 陽菜 left",
].join("\n");

// The same chat on an iPhone: seconds, the chat's own name on its system lines, and direction marks.
const IPHONE = [
  `[16/10/2025, 17:00:00] テニス部 会計: ${LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`,
  `[16/10/2025, 17:00:00] テニス部 会計: ${LRM}加藤 健 created this group`,
  `[16/10/2025, 17:01:00] テニス部 会計: ${LRM}加藤 健 added 小林 陽菜`,
  "[16/10/2025, 17:03:12] 加藤 健: 部費の集金は10/20までにお願いします。1人3000円です",
  "[16/10/2025, 17:05:40] 高橋 美咲: 了解です。振込先を教えてください",
  "[16/10/2025, 17:06:02] 加藤 健: みなと銀行 本店 普通 7654321 です",
  `${LRM}[16/10/2025, 17:06:30] 加藤 健: ${LRM}image omitted`,
  `[16/10/2025, 17:08:00] ${LRM}+81 80-9876-5432: 保健所の書類はどこでもらえますか?`,
  "[16/10/2025, 17:10:00] 高橋 美咲: @818098765432 学生課の窓口です。わからなかったら hokenjo@example.jp か 03-9876-5432 に",
  "[16/10/2025, 17:12:10] 加藤 健: 金庫の暗証番号",
  "[16/10/2025, 17:12:30] 加藤 健: 4242",
  `${LRM}[16/10/2025, 17:15:00] 高橋 美咲: ${LRM}This message was deleted.`,
  `[17/10/2025, 9:30:00] 加藤 健: 領収書の宛名は「テニス部」で ${LRM}<This message was edited>`,
  "[17/10/2025, 9:31:00] 加藤 健: 合宿の予定",
  "2025/10/20(月)",
  "9:00 正門 集合です",
  `[17/10/2025, 9:40:00] テニス部 会計: ${LRM}小林 陽菜 left`,
].join("\n");

const NUMBER = "+81 80-9876-5432"; // a member saved only by number

describe("parseWhatsApp: one chat from Android and from an iPhone", () => {
  const messages = parseWhatsApp(ANDROID);

  it("is made up: it holds none of seed/chat-canaries.txt", () => {
    expect(leaked(`${ANDROID}\n${IPHONE}`)).toEqual([]);
  });

  it("keeps the messages, and drops system lines, media, a deleted message and the edit note", () => {
    expect(
      messages.map(({ at, speaker, text }) => [at, speaker, text]),
    ).toEqual([
      [
        "2025-10-16T17:03",
        "加藤 健",
        "部費の集金は10/20までにお願いします。1人3000円です",
      ],
      ["2025-10-16T17:05", "高橋 美咲", "了解です。振込先を教えてください"],
      ["2025-10-16T17:06", "加藤 健", "みなと銀行 本店 普通 7654321 です"],
      ["2025-10-16T17:08", NUMBER, "保健所の書類はどこでもらえますか?"],
      [
        "2025-10-16T17:10",
        "高橋 美咲",
        "@818098765432 学生課の窓口です。わからなかったら hokenjo@example.jp か 03-9876-5432 に",
      ],
      ["2025-10-16T17:12", "加藤 健", "金庫の暗証番号"],
      ["2025-10-16T17:12", "加藤 健", "4242"],
      ["2025-10-17T09:30", "加藤 健", "領収書の宛名は「テニス部」で"],
      [
        "2025-10-17T09:31",
        "加藤 健",
        "合宿の予定\n2025/10/20(月)\n9:00 正門 集合です",
      ],
    ]);
  });

  it("reads the iPhone export as the same messages, also when it lost its direction marks", () => {
    expect(parseWhatsApp(IPHONE)).toEqual(messages);
    expect(parseWhatsApp(IPHONE.replaceAll(LRM, ""))).toEqual(messages);
  });

  it("lists the speakers with their counts: not the chat itself, nor anyone only added or leaving", () => {
    expect(speakers(messages)).toEqual([
      { name: "加藤 健", count: 6 },
      { name: "高橋 美咲", count: 2 },
      { name: NUMBER, count: 1 },
    ]);
  });

  it("is what parseChat reads for whatsapp", () => {
    expect(parseChat(ANDROID, "whatsapp")).toEqual(messages);
  });
});

describe("the redaction, as for the seed LINE chat", () => {
  const messages = parseWhatsApp(ANDROID);
  const roles = { "加藤 健": "会計", "高橋 美咲": "副会計", [NUMBER]: "部長" };
  const result = redactChat(messages, { roles, keepAll: true });
  const hidden = [
    "加藤",
    "高橋",
    "美咲",
    "小林",
    "陽菜",
    "80-9876-5432",
    "8098765432",
    "hokenjo",
    "9876-5432",
    "7654321",
    "4242",
  ];

  it("leaves no name, number, email, account or PIN, in the text or the messages", () => {
    for (const text of [result.text, JSON.stringify(result.messages)]) {
      for (const word of hidden) expect(text.includes(word), word).toBe(false);
      expect(leaked(text)).toEqual([]);
    }
  });

  it("leaves none either when no role was picked", () => {
    const { text } = redactChat(messages, { keepAll: true });
    for (const word of hidden) expect(text.includes(word), word).toBe(false);
  });

  it("counts what it hid, per type", () => {
    // 9 speaker columns; the mention and the office's number; the email; the account; the 暗証番号 line and the
    // PIN in the message after it.
    expect(result.counts).toEqual({
      ...nothing,
      names: 9,
      phones: 2,
      emails: 1,
      accounts: 1,
      secrets: 2,
    });
  });

  it("keeps the knowledge, with people as roles", () => {
    expect(result.text).toBe(
      [
        "2025-10-16 17:03 会計: 部費の集金は10/20までにお願いします。1人3000円です",
        "2025-10-16 17:05 副会計: 了解です。振込先を教えてください",
        "2025-10-16 17:06 会計: みなと銀行 本店 普通 [口座番号] です",
        "2025-10-16 17:08 部長: 保健所の書類はどこでもらえますか?",
        "2025-10-16 17:10 副会計: @[電話番号] 学生課の窓口です。わからなかったら [メール] か [電話番号] に",
        "2025-10-16 17:12 会計: [秘密]",
        "2025-10-16 17:12 会計: [秘密]",
        "2025-10-17 09:30 会計: 領収書の宛名は「テニス部」で",
        "2025-10-17 09:31 会計: 合宿の予定",
        "  2025/10/20(月)",
        "  9:00 正門 集合です",
      ].join("\n"),
    );
  });

  it("finds nothing on a second pass", () => {
    const again = redactText(result.text);
    expect(again.text === result.text, "the same text").toBe(true);
    expect(again.counts).toEqual(nothing);
  });
});

describe("parseWhatsApp: dates and times as the phone writes them", () => {
  it.each([
    [
      "day first",
      "16/10/2025, 17:03 - 加藤: 部費は10/20まで",
      "2025-10-16T17:03",
    ],
    [
      "the US, 12-hour",
      `10/16/25, 5:03${NARROW_SPACE}PM - Kato: dues by May 10`,
      "2025-10-16T17:03",
    ],
    [
      "midnight",
      "[10/16/25, 12:15:00 AM] Kato: see you at the gym",
      "2025-10-16T00:15",
    ],
    ["Japan", "2025/10/16 17:03 - 加藤: 部費は10/20まで", "2025-10-16T17:03"],
    [
      "Japan, 午後",
      "[2025/10/16 午後5:03:12] 加藤: 部費は10/20まで",
      "2025-10-16T17:03",
    ],
    ["dots", "16.10.25, 17:03 - Kato: Beitrag bis 20.10.", "2025-10-16T17:03"],
  ])("%s", (_, raw, at) => {
    expect(parseWhatsApp(raw).map((message) => message.at)).toEqual([at]);
  });

  it("reads the day and month the way under which the dates run in order", () => {
    const raw = [
      "05/10/2025, 10:00 - 加藤: 一通目のお知らせ",
      "06/09/2025, 10:00 - 加藤: 二通目のお知らせ",
    ].join("\n");
    expect(parseWhatsApp(raw).map(({ at }) => at)).toEqual([
      "2025-05-10T10:00",
      "2025-06-09T10:00",
    ]);
  });

  it("reads a date that fits both ways day first, but month first with a two-digit year after slashes", () => {
    expect(parseWhatsApp("05/10/2025, 10:00 - 加藤: お知らせです")[0].at).toBe(
      "2025-10-05T10:00",
    );
    expect(parseWhatsApp("05/10/25, 10:00 - 加藤: お知らせです")[0].at).toBe(
      "2025-05-10T10:00",
    );
  });

  it("keeps a message whose date no calendar has, without a date", () => {
    const raw =
      "16/10/2025, 17:03 - 加藤: 部費は10/20まで\n10/16/2025, 17:05 - 高橋: 了解しました";
    expect(parseWhatsApp(raw).map(({ at }) => at)).toEqual([
      "2025-10-16T17:03",
      null,
    ]);
  });
});

describe("parseWhatsApp: what isn't a member's message", () => {
  it("drops Android's system lines, which name no speaker, also one quoting a group name with a colon", () => {
    const raw = [
      '16/10/2025, 17:00 - 加藤 健 changed the subject from "会計" to "会計: 2025"',
      "16/10/2025, 17:00 - 加藤 健がグループ名を「会計: 2025」に変更しました",
      `16/10/2025, 17:01 - ${NUMBER} joined using this group's invite link`,
      "16/10/2025, 17:03 - 高橋 美咲: 了解です、振込します",
    ].join("\n");
    expect(speakers(parseWhatsApp(raw))).toEqual([
      { name: "高橋 美咲", count: 1 },
    ]);
  });

  it("drops an iPhone's system lines by their words only when the export lost its marks: a member may write them", () => {
    const words = "会計が名簿に新入生を追加しました";
    const unmarked = [
      "[16/10/2025, 17:01:00] テニス部 会計: 加藤 健 added 小林 陽菜",
      "[16/10/2025, 17:02:00] テニス部 会計: 加藤が小林を追加しました",
      `[16/10/2025, 17:03:00] 高橋 美咲: ${words}`,
    ].join("\n");
    expect(parseWhatsApp(unmarked)).toEqual([]);
    const marked = [
      `[16/10/2025, 17:01:00] テニス部 会計: ${LRM}加藤 健 added 小林 陽菜`,
      `[16/10/2025, 17:03:00] 高橋 美咲: ${words}`,
    ].join("\n");
    expect(parseWhatsApp(marked).map(({ text }) => text)).toEqual([words]);
  });

  it.each([
    "<Media omitted>",
    "<メディアなし>",
    "null",
    "IMG-20251016-WA0001.jpg (file attached)",
    "加藤 健.vcf (file attached)",
    "This message was deleted",
    "このメッセージは削除されました",
    "location: https://maps.google.com/?q=35.6,139.7",
    "Missed voice call",
  ])("drops %s", (text) => {
    expect(parseWhatsApp(`16/10/2025, 17:03 - 高橋 美咲: ${text}`)).toEqual([]);
  });

  it("joins a message's further lines, and drops what comes before the first message or with a LINE row", () => {
    const raw = [
      "テニス部のトーク",
      "16/10/2025, 17:03 - 加藤 健: 合宿の予定",
      "",
      "8/10 出発",
      "21:03\t高橋 美咲\t部費は振込で",
      "続きの行",
      "16/10/2025, 17:05 - 中村: 了解しました",
    ].join("\n");
    expect(
      parseWhatsApp(raw).map(({ speaker, text }) => [speaker, text]),
    ).toEqual([
      ["加藤 健", "合宿の予定\n8/10 出発"],
      ["中村", "了解しました"],
    ]);
  });
});

describe("foreign phone numbers, as WhatsApp writes members saved only by number", () => {
  it.each([
    ["連絡は +44 7700 900123 まで", "連絡は [電話番号] まで"],
    ["+1 (415) 555-0134 に電話", "[電話番号] に電話"],
    ["+49 1512 3456789", "[電話番号]"],
    ["@447700900123 了解です", "@[電話番号] 了解です"],
  ])("hides %s", (text, redacted) => {
    const result = redactText(text);
    expect(result.text).toBe(redacted);
    expect(result.counts).toEqual({ ...nothing, phones: 1 });
  });

  it.each([
    "@500円の弁当",
    "参加者+12名",
    "+3000円の追加",
    "1+1=2",
    "2025/10/16",
  ])("leaves %s", (text) => {
    expect(redactText(text).text).toBe(text);
  });
});
