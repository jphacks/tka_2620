// The output guard (docs/SPEC.md → adding knowledge, step 8): a drafted card is checked again for contact details,
// credentials and names before anyone can publish it. Heuristics on top of the model's own rules; a card that trips
// one is blocked, never repaired. Drafting, publishing and import (lib/engine/extract-notes.ts) use it.
import type { BlockReason as ShownReason } from "@/lib/contracts";
import { isRole } from "@/lib/redact/redact";

// What a blocked card says (lib/contracts.ts); placeholders are the import's own check.
export type BlockReason = Exclude<ShownReason, "placeholder">;

export function blockReason(text: string): BlockReason | undefined {
  const plain = normalize(text);
  if (hasContactDetails(plain)) return "contact";
  if (nearValue(plain, CREDENTIAL)) return "secret";
  if (hasName(plain)) return "name";
  return undefined;
}

// NFKC turns full-width letters, digits and symbols into ASCII (０９０, ＠, ．); invisible characters (zero-width
// spaces, soft hyphens, direction marks, variation selectors) go, and kanji digits become digits as well.
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}|\p{Variation_Selector}|\u034F/gu, "")
    .replace(/[〇一二三四五六七八九]/g, (digit) =>
      String("〇一二三四五六七八九".indexOf(digit)),
    );
}

const CREDENTIAL =
  /暗証番号|口座番号|カード番号|パスワード|password|passcode|\bPIN\b|ログインID/gi;
const CONTACT_WORD = /電話|\bTEL\b|携帯|\bFAX\b|LINE\s?ID/gi;

// A phone number as written, in the shapes Japanese numbers take: an area code and an exchange that make ten digits
// with the four of the subscriber (03-1234-5678, 0466-12-3456), a mobile or IP number (090-1234-5678), a free dial
// (0120-123-456), with +81 for the 0 (+81 (0)90 1234 5678). Found even right after another number (受付 9:00-17:00
// 03-1234-5678), where joining the digits would run the two together; a date before an amount (2026.01.05 1500円)
// has fewer digits than any of these shapes.
const SEPARATOR = "[-‐‑‒–—―−ー ().・の]";
const PHONE = new RegExp(
  `(?<!\\d)(?:0|\\+81${SEPARATOR}{0,3}(?:0\\)?)?)` +
    `(?:(?:\\d${SEPARATOR}{1,3}\\d{4}|\\d{2}${SEPARATOR}{1,3}\\d{3}|\\d{3}${SEPARATOR}{1,3}\\d{2}|\\d{4}${SEPARATOR}{1,3}\\d|[5789]0${SEPARATOR}{1,3}\\d{4})${SEPARATOR}{1,3}\\d{4}` +
    `|(?:120|570|800)${SEPARATOR}{1,3}\\d{3}${SEPARATOR}{1,3}\\d{3,4})(?!\\d)`,
);
const PHONE_DIGITS = /(?<!\d)(?:\+?810?\d{9,10}|0\d{9,10})(?!\d)/;

// Emails (also kaikei@example。com and kaikei@gmail; from the start of the address, so a long run of letters takes
// one pass, not one per letter), @handles (with a letter in them: ＠500円 is a unit price), phone numbers as written,
// as bare digits, or once up to three non-alphanumeric characters (or の, ー, and a colon unless a time's two digits
// follow it) between digits are gone, and a number next to 電話 or TEL.
function hasContactDetails(plain: string): boolean {
  if (/(?<![\w.+-])[\w.+-]+\s?@\s?[\w-]+/.test(plain)) return true;
  if (/(?<![\w.])@(?=[\w.]*[A-Za-z_])[\w.]{2,}/.test(plain)) return true;
  if (PHONE.test(plain) || PHONE_DIGITS.test(plain)) return true;
  const digits = plain.replace(
    /(\d)(?:[^\p{L}\p{N}:]|:(?!\d{2}(?!\d))|[のー]){1,3}(?=\d)/gu,
    "$1",
  );
  if (PHONE_DIGITS.test(digits)) return true;
  return nearValue(plain, CONTACT_WORD);
}

// A value within a few characters of the keyword: a token of four or more letters, digits or symbols with a digit
// in it (4821, smash2025, 1234-5678), but not an amount, a year or a count (10000円, 2026年, 30人).
function nearValue(plain: string, keyword: RegExp): boolean {
  const value =
    /(?<![\w!#$%&*+.-])[\w!#$%&*+.-]{4,}(?![\w!#$%&*+.-]|[年円月日人時分件%])/g;
  for (const match of plain.matchAll(keyword)) {
    const near = plain.slice(
      Math.max(0, match.index - 12),
      match.index + match[0].length + 12,
    );
    if (near.match(value)?.some((token) => /\d/.test(token))) return true;
  }
  return false;
}

// A name before an honorific (大野さん, タナカ先輩, Tanakaくん, 阿部さん). Roles, offices and groups before one are fine
// (顧問の先生, 施設係さん, 業者さん, 皆さん, OBさん). Stricter than the redaction's list (lib/redact/redact.ts), which
// keeps words readable: here a word passes only by these endings, as a whole person-role word (担当者, not
// 加藤担当者), or by an institution's ending (市立図書館, 県立病院). Before 部, 所 or 室, the redaction's rule tells a
// surname from a role (阿部, 田所 against 学生部, 保健所).
const HONORIFIC =
  /([\p{sc=Han}\p{sc=Katakana}ーA-Za-z]{1,8})(?:さん|くん|君|ちゃん|氏|先輩|先生)/gu;
const ROLE =
  /(?:係|課|局|所|部|会|店|社|協|室|担当|長|員|役|幹事|会計|書記|顧問|監督|コーチ|マネージャー|リーダー|主将|代表|前任|後任|先代|歴代|年度|窓口|事務|業者|大家|管理人|皆|客|後輩|同期|上級生|新入生|医|師|OB|OG)$/u;
const PERSON_ROLE =
  /^(?:担当者|責任者|代表者|保護者|関係者|主催者|参加者|申請者|出店者|利用者|医者|先方|相手|本人|新人|学生|留学生|院生|選手|スタッフ|メンバー|オーナー|ゲスト|キャプテン)$/u;
const INSTITUTION =
  /(?:旅館|会館|図書館|体育館|公民館|大使館|病院|医院|学校|高校|大学|大学院|応援団|劇団|楽団|球団|税務署|警察署|消防署|県庁|都庁|役場)$/u;

function hasName(plain: string): boolean {
  return [...plain.matchAll(HONORIFIC)].some(([, word]) => !isCardRole(word));
}

function isCardRole(word: string): boolean {
  if (PERSON_ROLE.test(word) || INSTITUTION.test(word)) return true;
  if (!ROLE.test(word)) return false;
  return /[部所室]$/u.test(word) ? isRole(word) : true;
}
