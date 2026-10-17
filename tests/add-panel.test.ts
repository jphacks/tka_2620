// F5.4 (issue #34): the pure side of 「＋ 追加」 (components/redaction.ts). A chat is a chat wherever it arrives, so its
// speakers become roles even when it's pasted into 貼り付け or saved as another file type; a chat that can't be read
// safely (WhatsApp, LINE rows without their date line, nobody speaking) is refused rather than sent as text. The
// preview shows each placeholder as a black bar; the counts line names what was found; a long chat keeps its newest
// messages within the request's limit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blackoutSegments,
  fitChat,
  hiddenKinds,
  hideWords,
  memberLetter,
  readSource,
  splitRoles,
} from "@/components/redaction";
import type { RedactionCounts } from "@/lib/contracts";
import { extractFile } from "@/lib/ingest/extract";
import { type ChatMessage, speakers } from "@/lib/redact/parse";
import { formatChat, redactChat } from "@/lib/redact/redact";

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
  ])("reads a %s chat pasted on either tab as a chat with its speakers", (_, raw) => {
    for (const tab of ["text", "chat"] as const) {
      const source = readSource(raw, tab);
      if (source?.kind !== "chat") throw new Error(`expected a chat on ${tab}`);
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
    expect(readSource(raw, "text")).toEqual({ kind: "text", text: raw });
  });

  it("keeps the seed handover doc, Word file and notice as text", async () => {
    const file = (name: string) => new File([seed(name)], name);
    const docs = [
      HANDOVER,
      (await extractFile(file("handover-2024.sample.docx"))).text,
      (await extractFile(file("notice-2026.sample.pdf"))).text,
    ];
    for (const doc of docs) {
      expect(readSource(doc, "text")).toEqual({ kind: "text", text: doc });
    }
  });

  it("treats blank text as nothing", () => {
    expect(readSource(" \n ", "text")).toBeUndefined();
    expect(readSource(" \n ", "chat")).toBeUndefined();
  });
});

describe("readSource: chats that can't be read safely are refused", () => {
  // Until WhatsApp has a reader (#32), its names would reach the preview and the request as plain text.
  it.each([
    [
      "Android",
      "16/10/2025, 17:03 - 山田太郎: 部費は5/10までに\n16/10/2025, 17:05 - 佐藤花子: 了解です",
    ],
    [
      "iPhone",
      `${LRM}[16/10/2025, 17:03:12] 山田太郎: 部費は5/10までに\n[16/10/2025, 17:05:40] 佐藤花子: 了解です\n振込先も教えてください`,
    ],
    [
      "one line, US",
      `10/16/25, 5:03${NARROW_SPACE}PM - Taro Yamada: dues by May 10`,
    ],
  ])("refuses a WhatsApp export (%s) on either tab", (_, raw) => {
    expect(readSource(raw, "text")).toEqual({ kind: "whatsapp" });
    expect(readSource(raw, "chat")).toEqual({ kind: "whatsapp" });
  });

  it("refuses one WhatsApp line on トーク履歴, but keeps a doc with one schedule line in that shape", () => {
    const sparse = `16/10/2025, 17:03 - 山田太郎: 部費の集金について\n${"長い説明の続き\n".repeat(12)}`;
    expect(readSource(sparse, "chat")).toEqual({ kind: "whatsapp" });
    const doc = `${HANDOVER}\n2025/10/16 17:00 - 学生課: 臨時営業届を提出`;
    expect(readSource(doc, "text")).toMatchObject({ kind: "text" });
  });

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

  it("refuses a WhatsApp message with continuation lines pasted into 貼り付け", () => {
    const raw =
      "16/10/2025, 17:03 - 山田太郎: 部費の集金について\n5/10までにお願いします\n振込先はみなと銀行です";
    expect(readSource(raw, "text")).toEqual({ kind: "whatsapp" });
  });

  it("refuses a chat with nobody speaking on トーク履歴, which stays a doc on 貼り付け", () => {
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

describe("fitChat", () => {
  const messages: ChatMessage[] = Array.from({ length: 10 }, (_, index) => ({
    at: `2024-04-${String(index + 1).padStart(2, "0")}T21:00`,
    speaker: "会計",
    text: `メッセージ${index + 1}`,
  }));

  it("keeps the whole chat when it fits", () => {
    expect(fitChat(messages)).toEqual(messages);
  });

  it("keeps the newest messages whose text fits the limit", () => {
    const max = formatChat(messages.slice(6)).length;
    const kept = fitChat(messages, max);
    expect(kept).toEqual(messages.slice(6));
    expect(formatChat(kept).length).toBeLessThanOrEqual(max);
    expect(fitChat(messages, max - 1)).toEqual(messages.slice(7));
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
