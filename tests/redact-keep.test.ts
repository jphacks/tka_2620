// Keep what matters in a chat (F5.9): the last 12 months, the messages that look like handover knowledge with the
// message before and after each from the same day, and no more than the request takes. Like tests/redact.test.ts,
// nothing here prints a canary: the seed checks compare dates and canary line numbers, and the other cases use
// made-up names.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportRequest } from "@/lib/contracts";
import { looksLikeKnowledge, MAX_TEXT, recent } from "@/lib/redact/keep";
import {
  type ChatMessage,
  parseLine,
  parsePaste,
  speakers,
} from "@/lib/redact/parse";
import { redactChat } from "@/lib/redact/redact";
import { leaked, nothing } from "./canaries";

const message = (
  at: string | null,
  text: string,
  speaker = "a",
): ChatMessage => ({ at, speaker, text });

const sentAt = (chat: ChatMessage[]) =>
  redactChat(chat).messages.map(({ at }) => at);

describe("the seed chat, seed/chat-line.sample.txt", () => {
  const messages = parseLine(
    readFileSync(
      new URL("../seed/chat-line.sample.txt", import.meta.url),
      "utf8",
    ),
  );
  const roles = Object.fromEntries(
    speakers(messages).map(({ name }, index) => [
      name,
      ["会計", "副会計", "部長"][index],
    ]),
  );
  const result = redactChat(messages, { roles });

  it("keeps 19 of its 20 messages: all but the health message", () => {
    // Counted back from its last message (2025-03-10), not from today: from today, nothing would be left.
    expect([result.kept, result.total]).toEqual([19, 20]);
    const sent = new Set(result.messages.map(({ at }) => at));
    expect(
      messages.filter(({ at }) => !sent.has(at)).map(({ at }) => at),
    ).toEqual(["2024-06-03T19:40"]);
    expect(result.text.includes("体調"), "the health message").toBe(false);
  });

  it("sends no canary, and counts what the sent messages hid", () => {
    expect(leaked(result.text)).toEqual([]);
    expect(leaked(JSON.stringify(result.messages))).toEqual([]);
    // 19 speaker columns and 山田さん (the 佐藤です of the health message isn't sent); the rest as in F5.1.
    expect(result.counts).toEqual({
      ...nothing,
      names: 20,
      phones: 1,
      emails: 1,
      ids: 1,
      accounts: 1,
      secrets: 1,
      people: 2,
    });
  });

  it("keeps all 20 with keepAll", () => {
    const all = redactChat(messages, { roles, keepAll: true });
    expect([all.kept, all.total]).toEqual([20, 20]);
    expect(leaked(all.text)).toEqual([]);
  });
});

describe("what looks like handover knowledge", () => {
  it.each([
    "部費は5/10までに",
    "2025-10-20に出す",
    "10月に集める",
    "20日まで",
    "21:00から",
    "9時集合",
    "2週間前から",
    "毎月1日",
    "月末にまとめる",
    "年度末に報告",
    "火曜は休館",
    "3000円です",
    "¥500で",
    "1万くらい",
    "集金します",
    "振込先はみなと銀行",
    "領収書をもらう",
    "締切は来週",
    "期限に注意",
    "申請しておいて",
    "提出お願い",
    "予約した",
    "書類を出す",
    "キャンセルできる",
    "学生課で聞く",
    "保健所に行く",
    "顧問に聞いて",
    "金庫に入れる",
    "連絡先は080-2468-1357",
    "kaikei.mock@example.org に送って",
    "https://forms.gle/AbC123 から",
    "暗証番号は9876",
    "合宿費は1人8000円",
    "保険に入る",
    "エントリーしておく",
    "名簿にのせる",
    "当番を決める",
    "倉庫にある",
    "業者に頼む",
    "講習を受ける",
    "抽選で決まる",
    "生協で買える",
    "学割が使える",
    "ドライブのフォルダにある",
    "練習は第二体育館で",
  ])("is kept between chit-chat on other days: %s", (signal) => {
    const chat = [
      message("2025-01-10T10:00", "了解です"),
      message("2025-01-11T10:00", signal),
      message("2025-01-12T10:00", "ありがとう!"),
    ];
    expect(sentAt(chat)).toEqual(["2025-01-11T10:00"]);
  });

  it.each([
    "了解です",
    "ありがとう!",
    "お疲れさまでした",
    "明日練習ある?",
    "来週休みます",
    "体調悪くて休みます",
    "それな笑",
    "楽しかった!また行こう",
    "酔っ払ってた笑",
    "来年もよろしく!",
    "去年は楽しかった",
  ])("chit-chat alone is not sent: %s", (text) => {
    const result = redactChat([message("2025-01-11T10:00", text)]);
    expect([result.kept, result.total, result.text]).toEqual([0, 1, ""]);
    expect(result.counts).toEqual(nothing);
  });

  it("doesn't count role words, which the redaction puts in", () => {
    expect(
      looksLikeKnowledge("副会計です、来週ちょっと体調悪くて練習休みます"),
    ).toBe(false);
    expect(looksLikeKnowledge("会計、部長、メンバーA")).toBe(false);
  });
});

describe("a message about someone's health or private life", () => {
  it.each([
    "土曜の練習休みます、熱が出た",
    "風邪で3日休みます",
    "病院に行くので10時に遅れます",
    "家族が来るので月末は無理",
    "インフルで2週間前から休んでる",
    "彼氏と別れた、金曜は無理",
  ])("is not sent for a date, a time or a place: %s", (text) => {
    expect(sentAt([message("2025-01-11T10:00", text)])).toEqual([]);
  });

  it("is sent for a strong sign of knowledge", () => {
    expect(
      sentAt([
        message("2025-01-11T10:00", "インフルなので来週の集金お願いします"),
      ]),
    ).toEqual(["2025-01-11T10:00"]);
  });

  it("is never sent as context", () => {
    const chat = [
      message("2025-01-11T09:00", "熱が出たので休みます"),
      message("2025-01-11T09:05", "明日10時集合"),
      message("2025-01-11T09:10", "了解です"),
    ];
    expect(sentAt(chat)).toEqual(["2025-01-11T09:05", "2025-01-11T09:10"]);
  });
});

describe("context", () => {
  it("is the message before and after knowledge, from the same day", () => {
    const chat = [
      message("2025-02-01T18:00", "今日もお疲れ"),
      message("2025-02-01T19:00", "そういえば合宿どうする?"),
      message("2025-02-01T19:05", "宿は2月中に予約しないと埋まる"),
      message("2025-02-01T19:10", "了解!"),
      message("2025-02-01T19:20", "おやすみ"),
    ];
    expect(sentAt(chat)).toEqual([
      "2025-02-01T19:00",
      "2025-02-01T19:05",
      "2025-02-01T19:10",
    ]);
  });

  it("never comes from another day", () => {
    const chat = [
      message("2025-02-01T23:59", "ありがとう"),
      message("2025-02-02T00:01", "合宿の予約は2月中"),
      message("2025-02-03T09:00", "了解です"),
    ];
    expect(sentAt(chat)).toEqual(["2025-02-02T00:01"]);
  });

  it("in a paste without dates, is the message before and after", () => {
    const chat = parsePaste(
      "高橋健太: 部費は5/10まで\n中村美咲: 了解です\n小林誠: 明日練習ある?",
    );
    expect(redactChat(chat).text).toBe("[人]: 部費は5/10まで\n[人]: 了解です");
  });
});

describe("the last 12 months", () => {
  const chat = [
    message("2023-02-28T23:59", "部費は3000円"),
    message("2023-03-01T09:00", "部費は3000円"),
    message("2024-03-01T09:00", "部費は3500円"),
  ];

  it("are counted back from the chat's last message, and the day 12 months before still counts", () => {
    expect(recent(chat).map(({ at }) => at)).toEqual([
      "2023-03-01T09:00",
      "2024-03-01T09:00",
    ]);
    expect(sentAt(chat)).toEqual(["2023-03-01T09:00", "2024-03-01T09:00"]);
  });

  it("don't apply with keepAll, or to messages without a date", () => {
    expect(redactChat(chat, { keepAll: true }).kept).toBe(3);
    expect(recent([message(null, "部費は3000円"), ...chat])).toHaveLength(3);
  });

  it("still hide the value after a 暗証番号 line that is older than them", () => {
    const result = redactChat([
      message("2024-03-10T21:00", "金庫の暗証番号は?"), // a minute too old
      message("2024-03-10T21:01", "9876、毎月変わる", "b"), // the first message kept
      message("2025-03-10T21:01", "部費は3000円"),
    ]);
    expect(result.messages.map(({ at }) => at)).toEqual([
      "2024-03-10T21:01",
      "2025-03-10T21:01",
    ]);
    expect(result.text.includes("9876"), "the value").toBe(false);
    expect(result.counts.secrets).toBe(1);
  });
});

it("learns a name before an honorific from every message, also those it doesn't send", () => {
  const result = redactChat([
    message("2023-01-10T10:00", "加藤先輩、おつかれさまです"), // older than 12 months
    message("2024-06-01T10:00", "小林先輩、おつかれさまです", "b"), // chit-chat
    message("2024-06-02T10:00", "合宿の予約は加藤か小林に聞いて"),
  ]);
  expect(result.text).toBe(
    "2024-06-02 10:00 [人]: 合宿の予約は[人]か[人]に聞いて",
  );
  expect(result.counts).toEqual({ ...nothing, names: 1, people: 2 });
});

describe("the request's cap", () => {
  // 4,000 messages over 250 days, about 50 characters each as sent: twice what a request takes.
  const long = Array.from({ length: 4000 }, (_, index) =>
    message(
      new Date(Date.UTC(2025, 0, 1) + index * 90 * 60 * 1000)
        .toISOString()
        .slice(0, 16),
      `部費の集金は${(index % 28) + 1}日までに、1人3000円です(${index + 1}回目)`,
      index % 2 ? "中村美咲" : "高橋健太",
    ),
  );
  const roles = { 高橋健太: "会計", 中村美咲: "副会計" };

  it.each([
    false,
    true,
  ])("keeps the newest messages that fit (keepAll: %s)", (keepAll) => {
    const result = redactChat(long, { roles, keepAll });
    expect(result.total).toBe(4000);
    expect(result.kept).toBeLessThan(4000);
    expect(result.text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(result.text.length).toBeGreaterThan(MAX_TEXT - 100); // filled, not cut short
    expect(result.messages.at(-1)?.at).toBe(long[3999].at);
    expect(result.messages[0].at).toBe(long[4000 - result.kept].at);
    const request = ImportRequest.safeParse({
      seat: "smash-kaikei",
      kind: "chat",
      platform: "line",
      text: result.text,
      redaction: result.counts,
    });
    expect(request.success).toBe(true);
  });

  it("doesn't cut an emoji in half", () => {
    // 9 characters, then 2-unit emoji: the cut at 100,000 falls inside one.
    const { text } = redactChat(
      parsePaste(`部費は3000円。${"🎾".repeat(60000)}`),
    );
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(/[\uD800-\uDBFF]$/.test(text), "a lone half of an emoji").toBe(
      false,
    );
  });

  it("cuts one message that alone is over it, keeping its start", () => {
    const paste = parsePaste(
      `学祭の連絡です。保健所の書類は学生課で。${"申請書類は10/20までに提出。".repeat(8000)}`,
    );
    const result = redactChat(paste);
    expect([result.kept, result.total]).toEqual([1, 1]);
    expect(result.text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(
      result.text.startsWith("学祭の連絡です。保健所の書類は学生課で。"),
    ).toBe(true);
  });
});
