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
  ])("lets seat knowledge through: %s", (text) => {
    expect(blockReason(text)).toBeUndefined();
  });
});
