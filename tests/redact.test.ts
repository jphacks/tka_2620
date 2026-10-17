// Redaction on the device (F5.1): after redacting the seed chat and files, none of seed/chat-canaries.txt is left,
// the knowledge is, and a second pass finds nothing (what /api/import's re-run relies on). A failure names canaries
// by their line in seed/chat-canaries.txt, never by the string itself.
import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { parseLine, speakers } from "@/lib/redact/parse";
import { redactChat, redactText } from "@/lib/redact/redact";

const seed = (path: string) => new URL(`../seed/${path}`, import.meta.url);

const canaries = readFileSync(seed("chat-canaries.txt"), "utf8")
  .split("\n")
  .map((text, index) => ({ line: index + 1, text: text.trim() }))
  .filter(({ text }) => text && !text.startsWith("#"));

const leaked = (text: string) =>
  canaries
    .filter(({ text: canary }) => text.includes(canary))
    .map(({ line }) => line);

const nothing = {
  names: 0,
  phones: 0,
  emails: 0,
  urls: 0,
  ids: 0,
  addresses: 0,
  accounts: 0,
  secrets: 0,
  people: 0,
};

describe("the seed chat, seed/chat-line.sample.txt", () => {
  const messages = parseLine(
    readFileSync(seed("chat-line.sample.txt"), "utf8"),
  );
  const roles = { 山田太郎: "会計", 佐藤花子: "副会計", 鈴木一郎: "部長" };
  const result = redactChat(messages, { roles });

  it("leaves none of seed/chat-canaries.txt in the text or the messages", () => {
    expect(canaries.length).toBeGreaterThan(10);
    expect(leaked(result.text)).toEqual([]);
    expect(leaked(JSON.stringify(result.messages))).toEqual([]);
  });

  it("leaves none either when no role was picked", () => {
    expect(leaked(redactChat(messages).text)).toEqual([]);
  });

  it("counts what it hid, per type", () => {
    // 20 speaker columns, 山田さん and 佐藤です; 田中先輩 twice; the phone, the email, the LINE ID, the account,
    // and the 暗証番号 line.
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
    expect(result.text).toContain(
      "2024-04-12 21:03 会計: 部費の集金、GW明けの5/10までにお願いします!1人3000円です",
    );
    expect(result.text).toContain(
      "2024-04-12 21:15 部長: 会計、領収書の宛名って何にすればいい?",
    );
    expect(result.text).toContain("2024-06-03 19:40 副会計: 副会計です、");
    expect(result.text).toContain(
      "2024-09-20 22:12 部長: 了解。わからなかったら[人]に聞けばいい?",
    );
    expect(result.text).toContain(
      "わからなかったら[電話番号]に電話して。メールなら [メール]",
    );
    expect(result.text).toContain("宿のLINE ID: [ID] で予約してる");
    expect(result.text).toContain(
      "みなと銀行 本店 普通 [口座番号] テニスサークルSmash です",
    );
    expect(result.text).toContain("2025-03-10 21:00 会計: [秘密]\n");
    expect(result.text).toContain("毎月1日の朝9時から");
    expect(result.text).toContain(
      "2024-09-20 22:10 会計: 学祭の模擬店、今年も焼きそばでいく?\n  保健所の書類は学生課でもらえる\n  早めに出しといて",
    );
    expect(result.text).toContain("部長と顧問の先生にハンコをもらう");
  });

  it("finds nothing on a second pass", () => {
    const again = redactText(result.text);
    expect(again.text).toBe(result.text);
    expect(again.counts).toEqual(nothing);
  });

  it("lists the speakers the roles are picked for", () => {
    expect(speakers(messages).map(({ name }) => name)).toEqual(
      Object.keys(roles),
    );
  });
});

describe("the seed files", () => {
  it("seed/handover-2024.sample.docx: the planted name and phone number are hidden", async () => {
    const { value } = await mammoth.extractRawText({
      buffer: readFileSync(seed("handover-2024.sample.docx")),
    });
    const result = redactText(value);
    expect(leaked(result.text)).toEqual([]);
    expect(result.text).toContain("困ったら前会計の[人]([電話番号])に聞いて。");
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
    expect(result.text).toContain("- [秘密]\n");
    expect(result.text).toContain("- 部費:4月と10月に集める。1人3000円。");
    expect(result.text).toContain(
      "- 年度末(3月)に会計報告。部長と顧問の先生にハンコをもらう",
    );
  });
});

describe("redactText rules", () => {
  it.each([
    ["090-1234-5678 に電話", "[電話番号] に電話"],
    ["０９０−１２３４−５６７８", "[電話番号]"],
    ["〇九〇の一二三四の五六七八", "[電話番号]"],
    ["+81 (0)90 1234 5678", "[電話番号]"],
    ["学生課(03-1234-5678)", "学生課([電話番号])"],
    ["09012345678", "[電話番号]"],
    ["090、1234、5678", "[電話番号]"],
    ["電話は1234-5678まで", "電話は[電話番号]まで"],
    ["受付 9:00-17:00 03-1234-5678", "受付 9:00-17:00 [電話番号]"],
    ["0120-123-456", "[電話番号]"],
  ])("phone: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["taro.yamada@example.com に送る", "[メール] に送る"],
    ["kaikei＠example．com", "[メール]"],
    ["kaikei@gmail", "[メール]"],
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
  ])("url keeps the host: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["LINE ID: smash_kaikei で", "LINE ID: [ID] で"],
    ["IDは smash2025", "IDは [ID]"],
    ["LINE:taro.smash", "LINE:[ID]"],
    ["@smash_kaikei に DM", "[ID] に DM"],
    ["学籍番号 21B12345 を書く", "学籍番号 [学籍番号] を書く"],
    ["学生証:J4-56789", "学生証:[学籍番号]"],
  ])("id: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["振込先 みなと銀行 普通 1234567", "振込先 みなと銀行 普通 [口座番号]"],
    ["口座番号:7654321", "口座番号:[口座番号]"],
    ["ゆうちょ 10120-12345671", "ゆうちょ [口座番号]"],
    ["番号は 7654321 です", "番号は [口座番号] です"],
    ["hotel 1234567", "hotel [口座番号]"], // the tel in hotel is no phone keyword
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
    ["4721。これが暗証番号", "[秘密]"],
  ])("secret line: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it.each([
    ["田中先輩に聞く。田中は会計に詳しい", "[人]に聞く。[人]は会計に詳しい"],
    ["タナカさんに聞く", "[人]に聞く"],
    ["Tanakaさんと話した", "[人]と話した"],
    ["@佐々木 了解", "[人] 了解"],
    ["宛名は山田様、仕様書と同様に", "宛名は[人]、仕様書と同様に"],
    ["佐藤先輩・鈴木先輩", "[人]・[人]"],
  ])("person: %s", (input, output) => {
    expect(redactText(input).text).toBe(output);
  });

  it("person: a name seen with an honorific in one message is hidden in the others too", () => {
    const { text } = redactChat([
      {
        at: "2024-09-20T22:12",
        speaker: "鈴木一郎",
        text: "田中先輩に聞けばいい?",
      },
      {
        at: "2024-09-20T22:13",
        speaker: "山田太郎",
        text: "田中は会計ゆるすぎる",
      },
    ]);
    expect(text).toBe(
      "2024-09-20 22:12 [人]: [人]に聞けばいい?\n2024-09-20 22:13 [人]: [人]は会計ゆるすぎる",
    );
  });

  it("names: a speaker's full name, family or given name, honorifics and @mentions become the role", () => {
    const { text, counts } = redactText(
      "山田太郎が言った。山田さん、太郎くん、@山田太郎、山田先輩、山田",
      { roles: { 山田太郎: "会計" } },
    );
    expect(text).toBe("会計が言った。会計、会計、会計、会計、会計");
    expect(counts.names).toBe(6);
  });

  it("names: Latin names match whole words in any case", () => {
    const { text } = redactText("Taro said YAMADA knows. Taro's form; Tarot", {
      roles: { "Taro Yamada": "会計" },
    });
    expect(text).toBe("会計 said 会計 knows. 会計's form; Tarot");
  });

  it("names: a family name two speakers share becomes [人]; a speaker without a role too", () => {
    const { text } = redactText("佐藤さんと花子と次郎と鈴木", {
      roles: { 佐藤花子: "会計", 佐藤次郎: "部長", 鈴木一郎: "" },
    });
    expect(text).toBe("[人]と会計と部長と[人]");
  });

  it("hide: more words to hide become [名前]", () => {
    const { text, counts } = redactText(
      "メゾン本郷の大家さんに渡す。高橋さんにも",
      {
        hide: ["メゾン本郷", "高橋"],
      },
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
    "文京区の保健所、学生課の窓口",
    "@500円 のお弁当、@all 明日は休み",
    "IDカードを持ってくる",
    "テニスサークルSmash",
    "代表者氏名を書く",
    "宿は二名様から、お客様と業者様",
    "締切は2025-10-20、部室は3-205、学生会館2-301号室",
    "¥1234567、1,234,567円",
    "第3回は10/3(金)18:30から、場所は101教室",
  ])("leaves knowledge alone: %s", (input) => {
    const { text, counts } = redactText(input);
    expect(text).toBe(input.normalize("NFKC"));
    expect(counts).toEqual(nothing);
  });
});
