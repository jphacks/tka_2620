// F5.4 (issue #34): the pure side of 「＋ 追加」 (components/redaction.ts). A chat is a chat wherever it arrives, so its
// speakers become roles even when it's pasted into 貼り付け or saved as another file type; a chat that can't be read
// safely (LINE rows without their date line, nobody speaking) is refused rather than sent as text. WhatsApp is F5.2. The
// preview shows each placeholder as a black bar; the counts line names what was found. What a chat keeps (the last 12
// months, what matters, the request's cap) is lib/redact's, tested in tests/redact-keep.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blackoutSegments,
  hiddenKinds,
  hideWords,
  memberLetter,
  readSource,
  splitRoles,
} from "@/components/redaction";
import type { RedactionCounts } from "@/lib/contracts";
import { extractFile } from "@/lib/ingest/extract";
import { speakers } from "@/lib/redact/parse";
import { redactChat } from "@/lib/redact/redact";

const seed = (name: string) =>
  readFileSync(new URL(`../seed/${name}`, import.meta.url));
const CHAT = seed("chat-line.sample.txt").toString("utf8");
const HANDOVER = seed("old-handover.sample.md").toString("utf8");
const CANARIES = seed("chat-canaries.txt")
  .toString("utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const LRM = String.fromCharCode(0x200e); // iPhone WhatsApp exports start lines with it
const NARROW_SPACE = String.fromCharCode(0x202f); // before PM in newer exports

describe("readSource: chats get roles wherever they arrive", () => {
  it("reads the seed LINE export as a chat on either tab", () => {
    for (const tab of ["text", "chat"] as const) {
      const source = readSource(CHAT, tab);
      expect(source?.kind).toBe("chat");
      if (source?.kind !== "chat") return;
      expect(source.platform).toBe("line");
      expect(speakers(source.messages)).toHaveLength(3);
    }
  });

  it("hides every name of a LINE export pasted into 貼り付け, once its speakers have roles", () => {
    const source = readSource(CHAT, "text");
    if (source?.kind !== "chat") throw new Error("expected a chat");
    const people = speakers(source.messages);
    const roles = Object.fromEntries(
      people.map(({ name }, index) => [name, `メンバー${memberLetter(index)}`]),
    );
    const { text } = redactChat(source.messages, { roles });
    for (const { name } of people) expect(text).not.toContain(name);
    expect(CANARIES.filter((canary) => text.includes(canary))).toEqual([]);
  });

  // Copied messages pasted into 貼り付け would otherwise go out with their speakers' names as plain text.
  it.each([
    [
      "名前: 本文",
      "山田太郎: 部費の集金は5/10までにお願いします\n佐藤花子: 了解です、振込先を教えてください\n山田太郎: みなと銀行の普通口座です\n佐藤花子: ありがとうございます、振り込みます",
    ],
    [
      "Slack",
      "山田太郎  21:03\n部費の集金は5/10までにお願いします\n佐藤花子  21:05\n了解です、振込先を教えてください\n山田太郎  21:07\nみなと銀行の普通口座です\n佐藤花子  21:09\nありがとうございます",
    ],
    [
      "Discord",
      "山田太郎 — 2024/04/12 21:03\n部費の集金は5/10までにお願いします\n佐藤花子 — 2024/04/12 21:05\n了解です、振込先を教えてください\n山田太郎 — 2024/04/12 21:07\nみなと銀行の普通口座です\n佐藤花子 — 2024/04/12 21:09\nありがとうございます",
    ],
  ])("reads a %s chat pasted as either choice as a chat with its speakers", (_, raw) => {
    for (const mode of ["text", "chat"] as const) {
      const source = readSource(raw, mode);
      if (source?.kind !== "chat")
        throw new Error(`expected a chat as ${mode}`);
      expect(speakers(source.messages).map(({ name }) => name)).toEqual([
        "山田太郎",
        "佐藤花子",
      ]);
    }
  });

  // Shorter chats pasted as a doc: someone speaks twice, or a line is a chat's header (one is enough).
  it.each([
    [
      "名前: 本文, one person once",
      "山田: 部費の集金は5/10までにお願いします\n佐藤: 了解です、振込先を教えてください\n山田: みなと銀行の普通口座です",
      ["山田", "佐藤"],
    ],
    [
      "Latin names",
      "Taro Yamada: dues are due by May 10\nHanako Sato: got it, which account?\nTaro Yamada: the Minato Bank one",
      ["Taro Yamada", "Hanako Sato"],
    ],
    [
      "Slack, one message each",
      "山田太郎  21:03\n部費の集金は5/10までにお願いします\n佐藤花子  21:05\n了解です、振込先を教えてください",
      ["山田太郎", "佐藤花子"],
    ],
    [
      "Slack, one author",
      "山田太郎  21:03\n部費の集金は5/10までにお願いします\n振込先はみなと銀行です",
      ["山田太郎"],
    ],
    [
      "[21:03] 名前:",
      "[21:03] 山田太郎: 部費の集金は5/10までにお願いします\n[21:05] 佐藤花子: 了解です、振込先を教えてください",
      ["山田太郎", "佐藤花子"],
    ],
  ])("reads a short chat pasted into 貼り付け (%s) as a chat, keeping the doc to fall back to", (_, raw, names) => {
    const source = readSource(raw, "text");
    if (source?.kind !== "chat") throw new Error("expected a chat");
    expect(speakers(source.messages).map(({ name }) => name)).toEqual(names);
    expect(source.doc).toBe(raw); // 「トークではなく資料として読む」
  });

  // The one shape left to the person: it can't be told from a doc with two field labels.
  it("reads two people saying one thing each, as 名前: 本文, as a doc whose preview shows the names", () => {
    const raw =
      "山田: 部費は5/10までにお願いします\n佐藤: 振込先を教えてください";
    const read = readSource(raw, "text");
    expect(read).toMatchObject({ kind: "text", text: raw });
  });

  // 「トークとして読む」: a pasted doc with lines like 名前: 本文 keeps them read as messages, and read as a chat each
  // speaker becomes a role, so neither name goes out.
  it("keeps the messages of a doc with 名前: 本文 lines, for 「トークとして読む」, and hides the names as a chat", () => {
    const raw =
      "加藤一樹: 部費は5/10までにお願いします\n高橋美咲: 振込先を教えてください";
    const read = readSource(raw, "text");
    if (read?.kind !== "text" || !read.messages)
      throw new Error("expected a doc with messages");
    expect(speakers(read.messages).map(({ name }) => name)).toEqual([
      "加藤一樹",
      "高橋美咲",
    ]);
    const roles = Object.fromEntries(
      speakers(read.messages).map(({ name }, index) => [
        name,
        `メンバー${memberLetter(index)}`,
      ]),
    );
    const { text } = redactChat(read.messages, { roles, keepAll: true });
    expect(text).not.toContain("加藤");
    expect(text).not.toContain("高橋");
    expect(text).toContain("5/10");
    // 「コピーしたメッセージ」 reads the same text as a chat straight away.
    expect(readSource(raw, "chat")?.kind).toBe("chat");
  });

  it("offers no chat reading for a doc where nobody speaks", () => {
    const plain = "部費の集金は5/10までです\n振込先はみなと銀行の普通口座です";
    expect(readSource(plain, "text")).toEqual({ kind: "text", text: plain });
  });

  it("keeps the seed handover doc, Word file and notice as text", async () => {
    const file = (name: string) => new File([seed(name)], name);
    const docs = [
      HANDOVER,
      (await extractFile(file("handover-2024.sample.docx"))).text,
      (await extractFile(file("notice-2026.sample.pdf"))).text,
    ];
    // Their field labels (部費: …) may read as speakers, so a pasted copy offers 「トークとして読む」; a file never does
    // (AddSlip.readFile shows the doc and leaves the messages out).
    for (const doc of docs) {
      expect(readSource(doc, "text")).toMatchObject({
        kind: "text",
        text: doc,
      });
    }
  });

  it("treats blank text as nothing", () => {
    expect(readSource(" \n ", "text")).toBeUndefined();
    expect(readSource(" \n ", "chat")).toBeUndefined();
  });
});

describe("readSource: WhatsApp exports are chats too (F5.2, #32)", () => {
  const whatsapp = (raw: string, tab: "text" | "chat") => {
    const source = readSource(raw, tab);
    if (source?.kind !== "chat" || source.platform !== "whatsapp") {
      throw new Error(`expected a WhatsApp chat on ${tab}`);
    }
    return source;
  };

  it.each([
    [
      "Android",
      "16/10/2025, 17:03 - 加藤 健: 部費は5/10までに\n16/10/2025, 17:05 - 高橋 美咲: 了解です",
      ["加藤 健", "高橋 美咲"],
    ],
    [
      "iPhone",
      `${LRM}[16/10/2025, 17:03:12] 加藤 健: 部費は5/10までに\n[16/10/2025, 17:05:40] 高橋 美咲: 了解です\n振込先も教えてください`,
      ["加藤 健", "高橋 美咲"],
    ],
    [
      "one line, US",
      `10/16/25, 5:03${NARROW_SPACE}PM - Taro Kato: dues by May 10`,
      ["Taro Kato"],
    ],
  ])("reads a WhatsApp export (%s) as a chat on either tab, with no doc to fall back to", (_, raw, names) => {
    for (const tab of ["text", "chat"] as const) {
      const source = whatsapp(raw, tab);
      expect(speakers(source.messages).map(({ name }) => name)).toEqual(names);
      expect(source.doc).toBeUndefined(); // as a doc, its names would go out as text
    }
  });

  it("reads one WhatsApp line as 「コピーしたメッセージ」, but keeps a doc with one schedule line in that shape", () => {
    const sparse = `16/10/2025, 17:03 - 加藤 健: 部費の集金について\n${"長い説明の続き\n".repeat(12)}`;
    expect(speakers(whatsapp(sparse, "chat").messages)).toHaveLength(1);
    const doc = `${HANDOVER}\n2025/10/16 17:00 - 学生課: 臨時営業届を提出`;
    expect(readSource(doc, "text")).toMatchObject({ kind: "text" });
  });

  // An export with a single message after its system lines (a stamp, no speaker), dropped on ファイル, which reads every
  // file as a doc first: its speaker must still get a role, never go out as text.
  it.each([
    [
      "Android, Japanese",
      "2025/10/16 17:00 - メッセージと通話はエンドツーエンドで暗号化されています。このチャットの外にいる人は、WhatsAppでさえも、それを読んだり聞いたりすることはできません。\n2025/10/16 17:01 - 加藤 健がグループ「会計」を作成しました\n2025/10/16 17:03 - 加藤 健: 部費は5/10までにお願いします",
    ],
    [
      "Android, English",
      "16/10/2025, 17:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.\n16/10/2025, 17:03 - 加藤 健: 部費は5/10までにお願いします",
    ],
  ])("reads a WhatsApp export with one message after its system lines (%s) as a chat, even as a doc", (_, raw) => {
    const source = whatsapp(raw, "text");
    expect(speakers(source.messages).map(({ name }) => name)).toEqual([
      "加藤 健",
    ]);
    const { text } = redactChat(source.messages, {
      roles: { "加藤 健": "メンバーA" },
      keepAll: true,
    });
    expect(text).not.toContain("加藤");
  });

  it("reads a WhatsApp message with continuation lines pasted into 貼り付け", () => {
    const raw =
      "16/10/2025, 17:03 - 加藤 健: 部費の集金について\n5/10までにお願いします\n振込先はみなと銀行です";
    expect(whatsapp(raw, "text").messages).toHaveLength(1);
  });

  // Read as LINE, everything after 9:00 正門 集合です went out as that message's text, with the names in it.
  it("reads a WhatsApp export whose message holds a date line and a time row as WhatsApp", () => {
    const raw = [
      "16/10/2025, 17:03 - 加藤: 合宿の日程です",
      "2025/10/20(月)",
      "9:00 正門 集合です",
      "16/10/2025, 17:05 - 高橋: 了解、部費は振込でいい?",
      "16/10/2025, 17:06 - 中村: 振込先は学生課で聞いてください",
    ].join("\n");
    for (const tab of ["text", "chat"] as const) {
      const { messages } = whatsapp(raw, tab);
      expect(speakers(messages).map(({ name }) => name)).toEqual([
        "加藤",
        "高橋",
        "中村",
      ]);
      const texts = messages.map(({ text }) => text).join("\n");
      expect(texts.includes("高橋") || texts.includes("中村")).toBe(false);
    }
  });

  it("reads a LINE export as LINE, even with WhatsApp-shaped lines in its messages", () => {
    const header = [
      "[LINE] テニス部のトーク履歴",
      "保存日時:2025/10/16 18:00",
      "",
      "2025/10/16(木)",
    ];
    const exported = [
      ...header,
      '21:03\t加藤 健\t"転送します',
      "16/10/2025, 17:03 - 小林: 締切は10/20",
      '16/10/2025, 17:05 - 中村: 了解"',
    ].join("\n");
    const copied = [
      "2025/10/16(木)",
      "21:03\t加藤 健\t部費の集金は10/20まで",
      "21:05\t高橋 美咲\t了解です",
      '21:07\t加藤 健\t"予定です',
      "2025/10/20 17:00 - 学生課: 臨時営業届を提出",
      '以上"',
    ].join("\n");
    for (const raw of [exported, copied]) {
      for (const tab of ["text", "chat"] as const) {
        expect(readSource(raw, tab)).toMatchObject({
          kind: "chat",
          platform: "line",
        });
      }
    }
  });

  // As many LINE rows as WhatsApp lines is read as LINE; parseLine then drops the WhatsApp lines, names and all.
  it("sends no WhatsApp name as text when a schedule copied from a spreadsheet makes it read as LINE", () => {
    const raw = [
      "16/10/2025, 17:03 - 加藤 健: 合宿の予定です",
      "2025/10/20(月)",
      "9:00\t正門\t集合",
      "9:30\t体育館\t練習開始",
      "16/10/2025, 17:05 - 小林 陽菜: ありがとうございます",
    ].join("\n");
    for (const tab of ["text", "chat"] as const) {
      const source = readSource(raw, tab);
      if (source?.kind !== "chat") throw new Error(`expected a chat on ${tab}`);
      const texts = source.messages.map(({ text }) => text).join("\n");
      expect(texts.includes("加藤") || texts.includes("小林")).toBe(false);
    }
  });

  it("refuses WhatsApp lines it doesn't read as WhatsApp, or that leave no message, rather than send them as text", () => {
    const tie =
      "21:03\t加藤 健\t部費の集金は10/20まで\n16/10/2025, 17:05 - 高橋 美咲: 了解です";
    const media =
      "16/10/2025, 17:03 - 加藤 健: <Media omitted>\n16/10/2025, 17:04 - 高橋 美咲: ok";
    for (const raw of [tie, media]) {
      expect(readSource(raw, "text")).toEqual({ kind: "notChat" });
      expect(readSource(raw, "chat")).toEqual({ kind: "notChat" });
    }
  });
});

describe("readSource: chats that can't be read safely are refused", () => {
  it.each([
    [
      "two rows",
      "21:03\t山田太郎\t部費の集金は5/10までにお願いします\n21:05\t佐藤花子\t了解です、振込先を教えてください",
    ],
    ["one row", "21:03\t山田太郎\t部費の集金は5/10までにお願いします"],
    ["9:03 PM", "9:03 PM\tTaro Yamada\tdues are due by May 10"],
    ["午後9:03", "午後9:03\t山田太郎\t部費の集金は5/10までにお願いします"],
  ])("refuses LINE rows copied without their date line (%s), on either tab", (_, rows) => {
    expect(readSource(rows, "text")).toEqual({ kind: "notChat" });
    expect(readSource(rows, "chat")).toEqual({ kind: "notChat" });
  });

  it("refuses a chat with nobody speaking as 「コピーしたメッセージ」, which stays a doc as 「資料」", () => {
    const plain =
      "部費の集金は5/10までにお願いします\n振込先はみなと銀行の普通口座です";
    expect(readSource(plain, "chat")).toEqual({ kind: "noSpeakers" });
    expect(readSource(plain, "text")).toEqual({ kind: "text", text: plain });
  });
});

describe("blackoutSegments", () => {
  it("turns each placeholder into a bar of its kind, and leaves other brackets as text", () => {
    expect(
      blackoutSegments("TEL [電話番号] [URL: forms.gle] [こちら] [人][名前]"),
    ).toEqual([
      { at: 0, text: "TEL " },
      { at: 4, bar: "phone" },
      { at: 10, text: " " },
      { at: 11, bar: "url", host: "forms.gle" },
      { at: 27, text: " [こちら] " },
      { at: 34, bar: "name" },
      { at: 37, bar: "name" },
    ]);
  });

  it("draws a bar only around a host name, so text written as [URL: …] never looks hidden", () => {
    expect(blackoutSegments("[URL] [URL: https://x.example/a b]")).toEqual([
      { at: 0, bar: "url" },
      { at: 5, text: " [URL: https://x.example/a b]" },
    ]);
  });
});

describe("hiddenKinds", () => {
  it("lists what was found in a fixed order, with people counted as names", () => {
    const counts: RedactionCounts = {
      names: 22,
      phones: 1,
      emails: 1,
      urls: 0,
      ids: 1,
      addresses: 0,
      accounts: 1,
      secrets: 1,
      people: 2,
    };
    expect(hiddenKinds(counts)).toEqual([
      { kind: "names", count: 24 },
      { kind: "phones", count: 1 },
      { kind: "emails", count: 1 },
      { kind: "accounts", count: 1 },
      { kind: "secrets", count: 1 },
      { kind: "ids", count: 1 },
    ]);
  });
});

describe("roles and words", () => {
  it("names default members A to Z, then AA", () => {
    expect([0, 1, 25, 26, 27].map(memberLetter)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
    ]);
  });

  it("splits a label pack's roles and the words to hide", () => {
    expect(splitRoles("部長・副部長・会計")).toEqual([
      "部長",
      "副部長",
      "会計",
    ]);
    expect(splitRoles("President, Vice president")).toEqual([
      "President",
      "Vice president",
    ]);
    expect(hideWords("田中、 佐藤,鈴木  田中")).toEqual([
      "田中",
      "佐藤",
      "鈴木",
    ]);
  });
});
