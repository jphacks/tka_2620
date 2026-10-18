// The output guard on drafted cards: contact details, credentials and names never reach a note.
import { describe, expect, it } from "vitest";
import { blockReason } from "@/lib/engine/guard";
import { mockDraft } from "@/lib/mocks";

describe("blockReason", () => {
  it.each([
    "kaikei@example.com に送る",
    "kaikei＠example．com に送る",
    "kaikei@example。com に送る",
    "kaikei@gmail に送る",
    "@smash_kaikei に DM する",
    "学生課（03-1234-5678）に電話する",
    "+81 (0)90-1234-5678",
    "+81 90 1234 5678",
    "03.1234.5678",
    "03–1234–5678",
    "090—1234—5678",
    "03・1234・5678",
    "03/1234/5678",
    "090‑1234‑5678",
    "090‒1234‒5678",
    "090ｰ1234ｰ5678",
    "会計の携帯は０９０−１２３４−５６７８",
    "〇九〇の一二三四の五六七八",
    "TEL 1234-5678",
    "電話は1234-5678まで",
    "LINE ID: smash2025",
    "@kaikei2025 に聞く",
    "090、1234、5678",
    // A phone number right after another number: joining the digits alone would run the two together.
    "受付 9:00-17:00 03-1234-5678",
    "10/20 03-1234-5678",
    "〒113-0033 03-1234-5678",
    "10/20 +81 90-1234-5678",
    "2025/10/20 09012345678",
    "受付 9:00-17:00 03.1234.5678",
    "+81 (0)90 1234 5678",
    "0800-123-4567",
    // A colon between groups that aren't a time's two digits
    "090:1234:5678",
    "090-1234:5678",
    // Invisible characters
    "kaikei@\u200Bexample.com",
    "kaikei@\u2066example.com",
  ])("blocks contact details: %s", (text) => {
    expect(blockReason(text)).toBe("contact");
  });

  it.each([
    "金庫の暗証番号は4821",
    "4821が暗証番号",
    "パスワードはsmash2025",
    "PIN: 0000",
    "口座番号 1234567",
  ])("blocks credentials: %s", (text) => {
    expect(blockReason(text)).toBe("secret");
  });

  it.each([
    "山田さんに聞く",
    "タナカ先輩が詳しい",
    "Tanakaくんに頼む",
    "去年は田中先生に相談した",
    // A surname that ends like a role (部): the redaction's list tells them apart
    "阿部さんに聞く",
    "加藤氏に連絡する",
    // Surnames that end like a role in the redaction's list (神, 館, 奥, 家, 組): still names here
    "大神さんに聞く",
    "三神先輩が詳しい",
    "小館さんに確認する",
    "大館くんに頼む",
    "奥さんに聞く",
    "加藤家さんにお礼",
    "テニス部加藤家さんにお礼",
    "坂東組さんに頼む",
    "瀬戸神さんに渡す",
    // Names glued to a family word or a person's role: only the whole role word passes
    "義親さんに聞く",
    "加藤兄さんに頼む",
    "大谷母さんに伝える",
    "加藤学生さんに渡す",
    "加藤担当者さんに確認する",
    "大野本人さんに聞く",
    "高橋妹さんに伝える",
    "小林班さんに頼む",
    "田所さんに聞く",
  ])("blocks names: %s", (text) => {
    expect(blockReason(text)).toBe("name");
  });

  it.each([
    mockDraft.cards[0].body,
    "学生課の施設係に連絡する。合鍵は顧問の先生が持っている。",
    "5,000円以下なら予備費から出す。2026年10月20日までに、10000円を超える分は次年度の会計へ。",
    "10/20 までに 30人分の申請書を出す。2026-10-20 が締切。",
    "暗証番号は会計の引き継ぎ封筒に書いてある。",
    "パスワードはGoogleドライブの共有メモにある。",
    "電話番号は学生便覧に載っている。2026年度から窓口が変わった。",
    "業者さん、施設係さん、皆さん、OBさん、保健所さんに伝える。",
    // Roles the redaction keeps, so an imported card with them can be published (#35)
    "保健所の担当者さんに確認する。先方のスタッフさんにも伝える。学生部さんに出す。",
    "大家さんに鍵を返す。旅館さん、市立図書館さん、応援団さん、県立病院さん、高校さんに伝える。",
    "税務署さんと学生課さんに出す。学生さん、新人さん、本人さんにも伝える。",
    // @ as "at" and as a unit price, times next to counts
    "18時@部室に集合",
    "集合 @ 正門",
    "単価＠500円、お弁当30個＠500円",
    "受付 09:00〜17:00、30人まで",
    "09:00-10:30 12人",
    "日時 10/20 09:30 〜 10/21 12:00",
    "会計年度は 2025/04/01〜2026/03/31。09:30 1200円",
    // A date before an amount or a count has fewer digits than a phone number
    "2026.01.05 1500円、2026-01-10 300人、R07.01.10 300人",
    "No.012-345-678、01.10.2025",
    "10:00:00 開始、1:25000 の地図",
  ])("lets seat knowledge through: %s", (text) => {
    expect(blockReason(text)).toBeUndefined();
  });

  it("takes a long run of letters in one pass", () => {
    const started = performance.now();
    expect(blockReason("a".repeat(100_000))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
