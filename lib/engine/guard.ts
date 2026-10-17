// The output guard (docs/SPEC.md → adding knowledge, step 8): a drafted card is checked again for contact details,
// credentials and names before anyone can publish it. Heuristics on top of the model's own rules; a card that trips
// one is blocked, never repaired. Drafting and publishing use it; import can run the same checks.

export type BlockReason = "contact" | "secret" | "name";

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

// Emails (also kaikei@example。com and kaikei@gmail), @handles (with a letter in them: ＠500円 is a unit price),
// phone numbers as written, as bare digits, or once up to three non-alphanumeric characters (or の, ー, and a colon
// unless a time's two digits follow it) between digits are gone, and a number next to 電話 or TEL.
function hasContactDetails(plain: string): boolean {
  if (/[\w.+-]+\s?@\s?[\w-]+/.test(plain)) return true;
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

// A name before an honorific (山田さん, タナカ先輩, Tanakaくん). Roles, offices and groups before one are fine
// (顧問の先生, 施設係さん, 業者さん, 皆さん, OBさん).
const HONORIFIC =
  /([\p{sc=Han}\p{sc=Katakana}ーA-Za-z]{1,8})(?:さん|くん|君|ちゃん|氏|先輩|先生)/gu;
const ROLE =
  /(?:係|課|局|所|部|会|店|社|協|室|担当|長|員|役|幹事|会計|書記|顧問|監督|コーチ|マネージャー|リーダー|主将|代表|前任|後任|先代|歴代|年度|窓口|事務|業者|大家|管理人|皆|客|後輩|同期|上級生|新入生|医|師|OB|OG)$/u;

function hasName(plain: string): boolean {
  return [...plain.matchAll(HONORIFIC)].some(([, word]) => !ROLE.test(word));
}
