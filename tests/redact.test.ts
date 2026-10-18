// Redaction on the device (F5.1): after redacting the seed chat and files, none of seed/chat-canaries.txt is left,
// the knowledge is, and a second pass finds nothing (what /api/import's re-run relies on). Nothing here prints a
// canary: a leak is reported by the canary's line in seed/chat-canaries.txt, a seed check by its label, and the
// rule cases use other made-up names and numbers. These cases test the redaction of every message, so the chats
// pass keepAll; what a chat keeps by default is tests/redact-keep.test.ts (F5.9).
import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { parseLine, speakers } from "@/lib/redact/parse";
import { redactChat, redactText } from "@/lib/redact/redact";
import { canaryCount, leaked, nothing } from "./canaries";

const seed = (path: string) => new URL(`../seed/${path}`, import.meta.url);

// A failing check names its label, not the text it searched.
const has = (text: string, part: string, label: string) =>
  expect(text.includes(part), label).toBe(true);

describe("the seed chat, seed/chat-line.sample.txt", () => {
  const messages = parseLine(
    readFileSync(seed("chat-line.sample.txt"), "utf8"),
  );
  // The sample's three speakers, in order: the treasurer, the vice-treasurer and the captain.
  const names = speakers(messages).map(({ name }) => name);
  const roles = Object.fromEntries(
    names.map((name, index) => [name, ["会計", "副会計", "部長"][index]]),
  );
  const result = redactChat(messages, { roles, keepAll: true });

  it("leaves none of seed/chat-canaries.txt in the text or the messages", () => {
    expect(canaryCount).toBeGreaterThan(10);
    expect(leaked(result.text)).toEqual([]);
    expect(leaked(JSON.stringify(result.messages))).toEqual([]);
  });

  it("leaves none either when no role was picked", () => {
    expect(leaked(redactChat(messages, { keepAll: true }).text)).toEqual([]);
  });

  it("finds the three speakers the roles are picked for", () => {
    expect(names).toHaveLength(3);
    expect(leaked(names.join("\n")).length).toBeGreaterThan(0); // they are the planted names
  });

  it("counts what it hid, per type", () => {
    // 20 speaker columns and two names in the text; the third party twice; the phone, the email, the LINE ID,
    // the account, and the 暗証番号 line.
    expect(result.counts).toEqual({
      ...nothing,
      names: 22,
      phones: 1,
      emails: 1,
      ids: 1,
      accounts: 1,
      secrets: 1,
      people: 2,
    });
  });

  it("keeps the knowledge, with people as roles", () => {
    const checks = [
      "2024-04-12 21:03 会計: 部費の集金、GW明けの5/10までにお願いします!1人3000円です",
      "2024-04-12 21:15 部長: 会計、領収書の宛名って何にすればいい?",
      "2024-06-03 19:40 副会計: 副会計です、",
      "2024-09-20 22:12 部長: 了解。わからなかったら[人]に聞けばいい?",
      "わからなかったら[電話番号]に電話して。メールなら [メール]",
      "宿のLINE ID: [ID] で予約してる",
      "みなと銀行 本店 普通 [口座番号] テニスサークルSmash です",
      "2025-03-10 21:00 会計: [秘密]\n",
      "毎月1日の朝9時から",
      "2024-09-20 22:10 会計: 学祭の模擬店、今年も焼きそばでいく?\n  保健所の書類は学生課でもらえる\n  早めに出しといて",
      "部長と顧問の先生にハンコをもらう",
    ];
    checks.forEach((part, index) => {
      has(result.text, part, `seed chat check ${index + 1}`);
    });
  });

  it("finds nothing on a second pass", () => {
    const again = redactText(result.text);
    expect(again.text === result.text, "the same text").toBe(true);
    expect(again.counts).toEqual(nothing);
  });
});

describe("the seed files", () => {
  it("seed/handover-2024.sample.docx: the planted name and phone number are hidden", async () => {
    const { value } = await mammoth.extractRawText({
      buffer: readFileSync(seed("handover-2024.sample.docx")),
    });
    const result = redactText(value);
    expect(leaked(result.text)).toEqual([]);
    has(
      result.text,
      "困ったら前会計の[人]([電話番号])に聞いて。",
      "docx check",
    );
    expect(result.counts).toEqual({
      ...nothing,
      phones: 1,
      secrets: 1,
      people: 1,
    });
    expect(redactText(result.text).counts).toEqual(nothing);
  });

  it("seed/old-handover.sample.md: only the 暗証番号 line goes", () => {
    const doc = readFileSync(seed("old-handover.sample.md"), "utf8");
    const result = redactText(doc);
    expect(result.counts).toEqual({ ...nothing, secrets: 1 });
    has(result.text, "- [秘密]\n", "md check 1");
    has(result.text, "- 部費:4月と10月に集める。1人3000円。", "md check 2");
    has(
      result.text,
      "- 年度末(3月)に会計報告。部長と顧問の先生にハンコをもらう",
      "md check 3",
    );
  });
});

describe("redactText rules", () => {
  it.each([
    ["080-2468-1357 に電話", "[電話番号] に電話"],
    ["０８０−２４６８−１３５７", "[電話番号]"],
    ["〇八〇の二四六八の一三五七", "[電話番号]"],
    ["+81 (0)80 2468 1357", "[電話番号]"],
    ["学生課(03-2468-1357)", "学生課([電話番号])"],
    ["08024681357", "[電話番号]"],
    ["080、2468、1357", "[電話番号]"],
    ["電話は2468-1357まで", "電話は[電話番号]まで"],
    ["受付 9:00-17:00 03-2468-1357", "受付 9:00-17:00 [電話番号]"],
    ["0120-246-813", "[電話番号]"],
  ])("phone: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["kaikei.mock@example.org に送る", "[メール] に送る"],
    ["kaikei＠example．org", "[メール]"],
    ["kaikei@gmail", "[メール]"],
    ["kaikei (at) example (dot) org", "[メール]"],
    ["kaikei アットマーク example.org", "[メール]"],
    ["kaikei @ example.org", "[メール]"],
  ])("email: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    [
      "申し込みは https://forms.gle/AbC123xyz から",
      "申し込みは [URL: forms.gle] から",
    ],
    ["www.example.ac.jp/kaikei/form.pdf を見る", "[URL: example.ac.jp] を見る"],
    ["bit.ly/3xYz9 で", "[URL: bit.ly] で"],
    ["https://forms.gle/AbC123こちらから", "[URL: forms.gle]こちらから"],
    ["https://ken-takahashi.github.io/about を見て", "[URL] を見て"],
    ["https://ken-takahashi.notion.site/page", "[URL: notion.site]"],
    ["https://takahashi-lab.eng.example.ac.jp/x", "[URL: example.ac.jp]"],
    [
      "https://docs.google.com/forms/d/e/1FAIp/viewform",
      "[URL: docs.google.com]",
    ],
  ])("url keeps a service's host only: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["LINE ID: smash_kaikei で", "LINE ID: [ID] で"],
    ["IDは smash2025", "IDは [ID]"],
    ["LINE:smash.kaikei", "LINE:[ID]"],
    ["@smash_kaikei に DM", "[ID] に DM"],
    ["インスタは smash_tennis", "インスタは [ID]"],
    ["X: smash_tennis", "X: [ID]"],
    ["Xは smash_tennis", "Xは [ID]"],
    ["学籍番号 21B12345 を書く", "学籍番号 [学籍番号] を書く"],
    ["学生証:J4-56789", "学生証:[学籍番号]"],
  ])("id: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["振込先 みなと銀行 普通 7654321", "振込先 みなと銀行 普通 [口座番号]"],
    ["普通 765 4321", "普通 [口座番号]"],
    ["口座番号:7654321", "口座番号:[口座番号]"],
    ["ゆうちょ 10120-76543211", "ゆうちょ [口座番号]"],
    ["番号は 7654321 です", "番号は [口座番号] です"],
    ["hotel 7654321", "hotel [口座番号]"], // the tel in hotel is no phone keyword
    ["カード 4111 1111 1111 1111", "カード [カード番号]"],
  ])("account and card: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["〒113-0033 東京都文京区本郷7-3-1", "[住所] [住所]"],
    ["本郷七丁目3番1号 メゾン本郷203号室", "[住所]"],
    ["郵便番号 1130033", "郵便番号 [住所]"],
  ])("address: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    [
      "- 通帳と印鑑は部室の金庫。暗証番号は部長に聞いて\n- 次の行",
      "- [秘密]\n- 次の行",
    ],
    ["PIN: 0000", "[秘密]"],
    ["パスワードはsmash2025", "[秘密]"],
    ["Wi-Fi の password は smash", "[秘密]"],
    ["9876。これが暗証番号", "[秘密]"],
    ["暗唱番号は9876", "[秘密]"],
    ["Wi-Fiのパスは abcd1234", "[秘密]"],
    ["金庫の番号は9876", "[秘密]"],
    // The value on the line after the keyword goes too, but not a line of advice.
    ["金庫の暗証番号\n9876", "[秘密]\n[秘密]"],
    ["暗証番号は?\n\nabcd1234\n合宿は2月", "[秘密]\n\n[秘密]\n合宿は2月"],
    ["暗証番号は?\n部長に聞いて", "[秘密]\n部長に聞いて"],
    ["暗証番号は部長に聞いて\n9876", "[秘密]\n9876"],
    ["暗証番号(金庫)\n9876", "[秘密]\n[秘密]"],
    ["暗証番号は以下\n九八七六", "[秘密]\n[秘密]"],
  ])("secret line: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it("secret: the value in the chat's next message goes too", () => {
    const { text } = redactChat(
      [
        { at: "2025-03-10T21:00", speaker: "a", text: "金庫の暗証番号は?" },
        { at: "2025-03-10T21:01", speaker: "b", text: "9876だよ" },
        {
          at: "2025-03-10T21:02",
          speaker: "a",
          text: "ありがとう、2月に変える",
        },
      ],
      { keepAll: true },
    );
    expect(text).toBe(
      "2025-03-10 21:00 [人]: [秘密]\n2025-03-10 21:01 [人]: [秘密]\n2025-03-10 21:02 [人]: ありがとう、2月に変える",
    );
  });

  it.each([
    ["加藤先輩に聞く。加藤は会計に詳しい", "[人]に聞く。[人]は会計に詳しい"],
    ["タナカさんに聞く", "[人]に聞く"],
    ["Tanakaさんと話した", "[人]と話した"],
    ["Ken Takahashiさんに聞く。Ken said so", "[人]に聞く。[人] said so"],
    ["@佐々木 了解", "[人] 了解"],
    ["宛名は高橋様、仕様書と同様に", "宛名は[人]、仕様書と同様に"],
    ["中村先輩・小林先輩", "[人]・[人]"],
    // Surnames that end like a place: 部, 屋, 所
    ["阿部さんに聞く", "[人]に聞く"],
    ["服部先輩と土屋さん", "[人]と[人]"],
    ["長谷部さんと田所くん", "[人]と[人]"],
    // Hiragana names before ちゃん, くん, 先輩
    ["ゆいちゃんに聞いて", "[人]に聞いて"],
    ["ゆう先輩と", "[人]と"],
    // A name glued to the word before it
    [
      "今日高橋さんに会った。高橋は会計に詳しい",
      "[人]に会った。[人]は会計に詳しい",
    ],
    ["テニス部高橋さん。高橋に聞く", "[人]。[人]に聞く"],
  ])("person: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it("person: a name seen with an honorific in one message is hidden in the others too", () => {
    const { text } = redactChat(
      [
        { at: "2024-09-20T22:12", speaker: "a", text: "加藤先輩に聞けばいい?" },
        { at: "2024-09-20T22:13", speaker: "b", text: "加藤は会計ゆるすぎる" },
      ],
      { keepAll: true },
    );
    expect(text).toBe(
      "2024-09-20 22:12 [人]: [人]に聞けばいい?\n2024-09-20 22:13 [人]: [人]は会計ゆるすぎる",
    );
  });

  it("names: a speaker's full name, family or given name, honorifics and @mentions become the role", () => {
    const { text, counts } = redactText(
      "高橋健太が言った。高橋さん、健太くん、@高橋健太、高橋先輩、高橋",
      { roles: { 高橋健太: "会計" } },
    );
    expect(text).toBe("会計が言った。会計、会計、会計、会計、会計");
    expect(counts.names).toBe(6);
  });

  it("names: Latin names match whole words in any case", () => {
    const { text } = redactText("Ken said TAKAHASHI knows. Ken's form; Kendo", {
      roles: { "Ken Takahashi": "会計" },
    });
    expect(text).toBe("会計 said 会計 knows. 会計's form; Kendo");
  });

  it("names: a family name two speakers share becomes [人]; a speaker without a role too", () => {
    const { text } = redactText("中村さんと美咲と大輔と小林", {
      roles: { 中村美咲: "会計", 中村大輔: "部長", 小林誠: "" },
    });
    expect(text).toBe("[人]と会計と部長と[人]");
  });

  it("hide: more words to hide become [名前]", () => {
    const { text, counts } = redactText(
      "メゾン本郷の大家さんに渡す。森さんにも",
      { hide: ["メゾン本郷", "森"] },
    );
    expect(text).toBe("[名前]の大家さんに渡す。[名前]にも");
    expect(counts.names).toBe(2);
  });

  it.each([
    "部費の集金、GW明けの5/10までに。1人3000円",
    "保健所申請 10/20まで ・2025年度 会計",
    "予算は1200000円、30人",
    "2024/04/12(金) 21:03",
    "2024-04-12 21:03 会計: 毎月1日の朝9時から",
    "受付 9:00-17:00、キャンセル料は2週間前から",
    "顧問の先生、学生課さん、皆さん、業者さん、お母さん、OBさん、新人さん",
    "学生部さん、野球部さん、保健所さん、本屋さん、ご近所さん、東大さん",
    "ここはちゃんと出して。みなさん、あかちゃん、おにいちゃん、たくさん",
    "文京区の保健所、学生課の窓口",
    "@500円 のお弁当、@all 明日は休み",
    "IDカードを持ってくる",
    "インスタで告知、Xで拡散",
    "今日はパスで、パスタを食べる",
    "定期パスは学生課で",
    "税務署さん、ご苦労様、お世話様です",
    "テニスサークルSmash",
    "代表者氏名を書く",
    "宿は二名様から、お客様と業者様",
    "締切は2025-10-20、部室は3-205、学生会館2-301号室",
    "¥7654321、7,654,321円",
    "第3回は10/3(金)18:30から、場所は101教室",
  ])("leaves knowledge alone: %s", (input) => {
    const { text, counts } = redactText(input);
    expect(text).toBe(input.normalize("NFKC"));
    expect(counts).toEqual(nothing);
  });

  // /api/import runs this on the server too (#35): an email pattern that tried every position of a run took 16 s, and
  // the ID and postal-code rules never finished on a run of spaces (in Japanese text for the postal code).
  const spaces = " ".repeat(100_000);
  it.each([
    ["a run of letters", "a".repeat(100_000)],
    ["letters and dots", "a.".repeat(50_000)],
    ["digits", "1".repeat(100_000)],
    ["a run of spaces", `a${spaces}a`],
    ["a run of spaces in Japanese text", `あ${spaces}あ`],
    ["a run of newlines", `あ${"\n".repeat(100_000)}あ`],
    ["spaces after ID", `ID${spaces}abc1`],
    ["spaces after 学籍番号", `学籍番号${spaces}A1234`],
    ["spaces after 郵便番号", `郵便番号${spaces}1130033`],
  ])("takes %s in one pass", (_case, input) => {
    const started = performance.now();
    redactText(input);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
