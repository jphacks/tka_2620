// Redaction on the device (docs/SPEC.md → adding knowledge, step 4): fixed rules, the same for pasted text, files and
// chats. Speaker names become the roles picked in the preview; contact details, account and card numbers, IDs and
// addresses become typed placeholders such as [電話番号]; a line about a password or PIN becomes [秘密]; anyone else
// named with an honorific becomes [人]. Only the result leaves the browser. /api/import runs the same rules again and
// rejects what they still find (#35), so a second pass over the output finds nothing. Nothing here is logged.
import type { RedactionCounts } from "@/lib/contracts";
import type { ChatMessage } from "@/lib/redact/parse";

export const PLACEHOLDER = {
  phone: "[電話番号]",
  email: "[メール]",
  url: "[URL]", // [URL: forms.gle] for a service's or an institution's host
  id: "[ID]",
  studentId: "[学籍番号]",
  address: "[住所]",
  account: "[口座番号]",
  card: "[カード番号]",
  secret: "[秘密]",
  person: "[人]",
  name: "[名前]",
} as const;

export type RedactOptions = {
  // Speakers (or anyone else the person names) and the role each becomes: { 山田太郎: "会計" }. The screen fills in
  // the default メンバーA/B/C (messages → import.member); a name without a role becomes [人].
  roles?: Record<string, string>;
  // More words to hide, such as third parties mentioned by name; each becomes [名前].
  hide?: string[];
};

export type Redacted = { text: string; counts: RedactionCounts };

export function redactText(
  text: string,
  options: RedactOptions = {},
): Redacted {
  const run = new Run(options, []);
  return { text: run.redact(text), counts: run.counts };
}

// A chat: each speaker column becomes its role, and each message is redacted on its own, so a [秘密] line never takes
// the date or the speaker with it. text is the chat as the preview shows it and the request sends it.
export function redactChat(
  messages: ChatMessage[],
  options: RedactOptions = {},
): Redacted & { messages: ChatMessage[] } {
  const run = new Run(
    options,
    messages.map((message) => message.speaker),
  );
  // 田中先輩 in one message hides 田中 in every other one too.
  for (const message of messages) run.learn(normalize(message.text));
  const redacted = messages.map((message) => ({
    at: message.at,
    speaker: message.speaker && run.role(message.speaker),
    text: run.redact(message.text),
  }));
  return { messages: redacted, text: formatChat(redacted), counts: run.counts };
}

// 2024-04-12 21:03 会計: 本文, with a message's further lines indented.
export function formatChat(messages: ChatMessage[]): string {
  return messages
    .map(({ at, speaker, text }) => {
      const head = [at?.replace("T", " "), speaker && `${speaker}:`]
        .filter(Boolean)
        .join(" ");
      const [first, ...rest] = text.split("\n");
      return [
        head ? `${head} ${first}` : first,
        ...rest.map((line) => `  ${line}`),
      ].join("\n");
    })
    .join("\n");
}

// NFKC turns full-width letters, digits and symbols into one form (０９０, ＠, ｶﾅ); invisible characters (zero-width
// spaces, direction marks, variation selectors) and private-use characters go.
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cf}|\p{Co}|\p{Variation_Selector}|\u034F/gu, "");
}

type Kind = keyof RedactionCounts;
type Hide = (kind: Kind, value: string) => string;

class Run {
  readonly counts: RedactionCounts = {
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
  private readonly values: string[] = [];
  private readonly roles = new Map<string, string>(); // a speaker as exported → their role
  private readonly names: RegExp | undefined;
  private readonly owners = new Map<string, string>(); // a name's variant, lower case → what it becomes

  constructor({ roles = {}, hide = [] }: RedactOptions, speakers: string[]) {
    for (const name of new Set([...Object.keys(roles), ...speakers])) {
      if (!name.trim()) continue;
      const role = normalize(roles[name] ?? "").trim() || PLACEHOLDER.person;
      this.roles.set(name, role);
      this.own(name, role);
    }
    for (const word of hide) if (word.trim()) this.own(word, PLACEHOLDER.name);
    this.names = alternation(
      [...this.owners.keys()].map((variant) => [
        variant,
        [...variant].length >= 2,
      ]),
      HONORIFIC,
    );
  }

  role(speaker: string): string {
    this.counts.names += 1;
    return this.roles.get(speaker) ?? PLACEHOLDER.person;
  }

  redact(input: string): string {
    let text = this.secrets(normalize(input));
    for (const rule of RULES) {
      text = replace(
        text,
        rule.pattern,
        (original, found) => rule.replace(original, found[0], this.hide),
        rule.digits,
      );
    }
    if (this.names) {
      text = replace(text, this.names, (_, found) =>
        this.hide(
          "names",
          this.owners.get(found[1].toLowerCase()) ?? PLACEHOLDER.person,
        ),
      );
    }
    text = replace(text, HANDLE, (handle) =>
      /^@[\w.]/.test(handle)
        ? this.hide("ids", PLACEHOLDER.id)
        : this.hide("people", PLACEHOLDER.person),
    );
    text = this.people(text);
    return text.replace(
      TOKEN,
      (_, code: string) => this.values[decode(code)] ?? "",
    );
  }

  // Two people share 佐藤: the variant can't say which one, so it becomes [人].
  private own(name: string, replacement: string): void {
    for (const variant of variants(name)) {
      const key = variant.toLowerCase();
      const owner = this.owners.get(key);
      this.owners.set(
        key,
        owner === undefined || owner === replacement
          ? replacement
          : PLACEHOLDER.person,
      );
    }
  }

  // While the rules run, each hidden value is an opaque private-use token (normalize removed any from the input), so
  // no later rule matches inside an earlier placeholder or role; the tokens are expanded at the end.
  private readonly hide: Hide = (kind, value) => {
    this.counts[kind] += 1;
    return encode(this.values.push(value) - 1);
  };

  // A line about a password, PIN or 暗証番号 goes entirely (its list marker stays), whatever else it holds. When the
  // keyword ends the line (金庫の暗証番号, 暗証番号は?), the value is on the next one: that line goes too if it's short
  // and has letters or digits, also when it's the next message of a chat.
  private carry = false;

  private secrets(text: string): string {
    return text
      .split("\n")
      .map((line) => {
        if (!line.trim()) return line;
        const keywords = [...line.matchAll(SECRET)];
        const value =
          this.carry && [...line].length < 40 && /[A-Za-z0-9]/.test(line);
        this.carry = false;
        const last = keywords.at(-1);
        if (!last && !value) return line;
        if (last) {
          const rest = line
            .slice(last.index + last[0].length)
            .replace(FILLER, "");
          this.carry = !/[\p{L}\p{N}]/u.test(rest);
        }
        return (
          (LIST_MARKER.exec(line)?.[0] ?? "") +
          this.hide("secrets", PLACEHOLDER.secret)
        );
      })
      .join("\n");
  }

  // A word before さん・くん・ちゃん・先輩・先生・様 is someone's name, unless it's a role, an office or a family word:
  // 顧問の先生, 学生課さん, 皆さん, 業者さん, お母さん stay. See candidates() for which names also go without it.
  learn(text: string): void {
    for (const match of text.matchAll(NAMED)) {
      for (const [name, alone] of candidates(
        match[1] ?? match[2] ?? match[3],
      )) {
        if (this.named.get(name) === true || this.named.get(name) === alone) {
          continue;
        }
        this.named.set(name, alone);
        this.namedPattern = undefined;
      }
    }
  }

  private readonly named = new Map<string, boolean>(); // name → may go without its honorific
  private namedPattern: RegExp | undefined;

  private people(text: string): string {
    this.learn(text);
    this.namedPattern ??= alternation([...this.named], PERSON_HONORIFIC);
    return this.namedPattern
      ? replace(text, this.namedPattern, () =>
          this.hide("people", PLACEHOLDER.person),
        )
      : text;
  }
}

// Rules, in order --------------------------------------------------------------------------------------------------

type Rule = {
  pattern: RegExp; // global
  digits?: boolean; // matched where 〇一二…九 read as digits (〇九〇の一二三四の五六七八)
  replace: (original: string, found: string, hide: Hide) => string;
};

const always =
  (kind: Kind, value: string): Rule["replace"] =>
  (_original, _found, hide) =>
    hide(kind, value);

// 暗唱番号 is the usual slip for 暗証番号; パス alone only as パスは / パス: / パス教えて (パスタ, 今日はパス and 定期パスは
// stay).
const SECRET =
  /パスワード|暗[証唱](?:番号|コード)?|あんしょう(?:ばんごう)?|パスコード|(?<!定期|フリー|年間|コン|バイ)パス(?=\s*(?:は|:|=|教え|変え|変わ))|(?:金庫|鍵|カギ|ロッカー|南京錠)の?(?:番号|ダイヤル)|ダイヤル(?:番号)?(?=\s*(?:は|:))|(?<![A-Za-z])(?:pin|pw|password|passcode|passwd)(?:\s?(?:code|コード|番号))?(?![A-Za-z])/gi;
// What may follow a keyword when the value is on the next line.
const FILLER =
  /[\s:=?!、。.]|は|が|を|も|です|でした|になります|教えて|ください|変わった|変わりました|変えた|変えました|変更しました|新しい/g;
const LIST_MARKER = /^\s*(?:[-*•・]\s+|#+\s+|\d{1,2}[.)]\s+)?/;

// A URL keeps only its host (the path can hold a form's or a private document's key), and only a service's or an
// institution's host: a personal site's can hold a name (taro-yamada.github.io).
const SERVICE_HOST =
  /(?:^|\.)(?:google\.com|forms\.gle|goo\.gl|bit\.ly|line\.me|youtube\.com|youtu\.be|x\.com|twitter\.com|instagram\.com|facebook\.com|notion\.so|notion\.site|zoom\.us|microsoft\.com|office\.com|dropbox\.com|ac\.jp|go\.jp|lg\.jp|ed\.jp)$/i;
const URL_CHARS = String.raw`[\w\-.~:/?#@!$&'*+,;=%]`;
const URL_PATTERN = new RegExp(
  String.raw`(?:https?://|www\.)${URL_CHARS}+|(?<![\w.@/-])(?:[a-z0-9-]+\.)+(?:com|net|org|info|jp|io|ly|gle|me|app|dev|co|us|link)/${URL_CHARS}*`,
  "gi",
);

// Also kaikei@gmail and kaikei@example。com; and written to dodge scrapers, kaikei (at) example (dot) com or
// kaikei アットマーク example.com, when the host has a dot.
const EMAIL = /[\w.+-]+@\s?[\w-]+(?:[.。][\w-]+)*/g;
const HIDDEN_EMAIL =
  /[\w.+-]+\s*(?:@|\(at\)|\[at\]|<at>|アットマーク|あっと)\s*[\w-]+(?:\s*(?:[.。]|\(dot\)|\[dot\]|ドット)\s*[A-Za-z][\w-]*)+/gi;

// The value after the keyword: 学籍番号 21B12345, LINE ID: smash_kaikei, IDは smash2025, LINE: smash_kaikei,
// インスタは smash_tennis, X: smash_tennis, アカウントは smash_official.
const STUDENT_ID =
  /(?<=(?:学籍番号|学生番号|学生証番号|学生証|学籍|student\s?(?:id|number|no\.?))\s*(?::|=|は|が)?\s*)(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,15}(?![A-Za-z0-9-])/giu;
const LINE_ID =
  /(?<=(?<![A-Za-z])(?:LINE\s?|ライン\s?)?ID\s*(?:は|が|を)?\s*:?\s*|(?:LINE|ライン|(?<![A-Za-z])X)\s*:\s*|(?:インスタ(?:グラム)?|instagram|insta|ツイッター|twitter|tiktok|ティックトック|threads|スレッズ|discord|ディスコ(?:ード)?|アカウント|垢)(?:の)?(?:アカウント)?(?:名)?\s*(?:は|:)?\s*)[\w.-]{3,32}(?![\w.-]|[年月日円人])/giu;

// 4111 1111 1111 1111, 3782-822463-10005, or digits after カード番号.
const CARD =
  /(?<!\d)\d{4}([- ]?)\d{4}\1\d{4}\1\d{2,4}(?!\d)|(?<!\d)\d{4}[- ]?\d{6}[- ]?\d{5}(?!\d)|(?<=(?:カード番号|クレジットカード|card\s?(?:number|no\.?))[^\n\d]{0,10})\d(?:[- ]?\d){11,18}(?!\d)/giu;

// The shapes lib/engine/guard.ts blocks in cards: an area code and an exchange that make ten digits with the
// subscriber's four (03-1234-5678, 0466-12-3456), mobile and IP numbers (090-1234-5678), free dial (0120-123-456),
// +81 for the 0; then bare digits, a run of digit groups that adds up to a number (090 1234 5678, 090、1234、5678),
// and digits right after 電話 or TEL.
const SEPARATOR = "[-‐‑‒–—―−ー ().・の]";
const PHONE = new RegExp(
  `(?<!\\d)(?:0|\\+81${SEPARATOR}{0,3}(?:0\\)?)?)` +
    `(?:(?:\\d${SEPARATOR}{1,3}\\d{4}|\\d{2}${SEPARATOR}{1,3}\\d{3}|\\d{3}${SEPARATOR}{1,3}\\d{2}|\\d{4}${SEPARATOR}{1,3}\\d|[5789]0${SEPARATOR}{1,3}\\d{4})${SEPARATOR}{1,3}\\d{4}` +
    `|(?:120|570|800)${SEPARATOR}{1,3}\\d{3}${SEPARATOR}{1,3}\\d{3,4})(?!\\d)`,
  "g",
);
const PHONE_DIGITS = /(?<!\d)(?:\+?810?\d{9,10}|0\d{9,10})(?!\d)/g;
const DIGIT_RUN =
  /\+?\d+(?:(?:[^\p{L}\p{N}\n:\uE000-\uF8FF]|[のー]){1,3}\d+)*/gu;
const PHONE_NEAR =
  /(?<=(?:電話|(?<![A-Za-z])TEL|携帯|ケータイ|でんわ)[^\n\d]{0,6})\d(?:[-‐−() ]?\d){6,13}(?!\d)/giu;

// Bank accounts are seven digits: after 口座, 普通, 振込… (also 123-4567), a ゆうちょ 記号-番号, or any seven digits
// that aren't an amount or a count.
const ACCOUNT_NEAR =
  /(?<=(?:口座|普通|当座|預金|貯金|振込|振り込み|ゆうちょ|支店|銀行)[^\n\d]{0,12})(?:\d{3}[-‐− ]\d{4}|\d{6,8})(?![\d,.円万])/gu;
const YUCHO = /(?<!\d)1\d{4}[-‐− ]?\d{7,8}(?!\d)/g;
const BARE_ACCOUNT =
  /(?<![\d,.¥$-])\d{7}(?![\d,.]|\s?[円万人年月日時分件個枚回歳%])/gu;

// 〒113-0033, and a street address: 東京都文京区本郷7-3-1, 本郷7丁目3番1号, メゾン本郷203号室. A ward or town alone stays.
const POSTAL =
  /〒\s?\d{3}[-‐−ー]?\d{4}(?!\d)|(?<=郵便番号\s*:?\s*)\d{3}[-‐−]?\d{4}(?!\d)|(?<![\d-])\d{3}[-‐−]\d{4}(?![\d-])/gu;
const PLACE = String.raw`[\p{sc=Han}\p{sc=Katakana}々ヶー]`;
const BLOCK = String.raw`\d{1,4}(?:丁目|番地|番|号|[-‐−])(?:\d{1,4}(?:丁目|番地|番|号|[-‐−])?){0,4}`;
const ROOM = String.raw`(?:\s?${PLACE}{1,12}?\d{1,4}号室)?`;
const ADDRESS = new RegExp(
  `(?:${PLACE}{1,4}[都道府県])?${PLACE}{1,6}?[市区郡町村]${PLACE}{0,8}?${BLOCK}${ROOM}` +
    `|${PLACE}{1,8}?\\d{1,2}丁目(?:\\d{1,4}(?:番地?|[-‐−]))?(?:\\d{1,4}号?)?${ROOM}` +
    `|(?<=${PLACE})\\d{1,2}[-‐−]\\d{1,3}[-‐−]\\d{1,3}(?![\\d-])`,
  "gu",
);

const RULES: Rule[] = [
  {
    pattern: URL_PATTERN,
    replace: (url, _found, hide) => {
      const name = host(url);
      return hide(
        "urls",
        name && SERVICE_HOST.test(name) ? `[URL: ${name}]` : PLACEHOLDER.url,
      );
    },
  },
  { pattern: EMAIL, replace: always("emails", PLACEHOLDER.email) },
  { pattern: HIDDEN_EMAIL, replace: always("emails", PLACEHOLDER.email) },
  { pattern: STUDENT_ID, replace: always("ids", PLACEHOLDER.studentId) },
  { pattern: LINE_ID, replace: always("ids", PLACEHOLDER.id) },
  {
    pattern: CARD,
    digits: true,
    replace: always("accounts", PLACEHOLDER.card),
  },
  {
    pattern: PHONE,
    digits: true,
    replace: always("phones", PLACEHOLDER.phone),
  },
  {
    pattern: PHONE_DIGITS,
    digits: true,
    replace: always("phones", PLACEHOLDER.phone),
  },
  {
    pattern: DIGIT_RUN,
    digits: true,
    replace: (original, found, hide) =>
      /^(?:0\d{9,10}|810?\d{9,10})$/.test(found.replace(/\D/g, ""))
        ? hide("phones", PLACEHOLDER.phone)
        : original,
  },
  {
    pattern: PHONE_NEAR,
    digits: true,
    replace: always("phones", PLACEHOLDER.phone),
  },
  {
    pattern: ACCOUNT_NEAR,
    digits: true,
    replace: always("accounts", PLACEHOLDER.account),
  },
  {
    pattern: YUCHO,
    digits: true,
    replace: always("accounts", PLACEHOLDER.account),
  },
  {
    pattern: POSTAL,
    digits: true,
    replace: always("addresses", PLACEHOLDER.address),
  },
  {
    pattern: ADDRESS,
    digits: true,
    replace: always("addresses", PLACEHOLDER.address),
  },
  {
    pattern: BARE_ACCOUNT,
    digits: true,
    replace: always("accounts", PLACEHOLDER.account),
  },
];

// Remaining @handles become [ID] and @mentions of a name [人]; @500円 is a unit price and @all everyone.
const HANDLE =
  /(?<![\w.@])@(?!(?:all|everyone|here|channel|全員)(?![\w\p{L}]))(?:(?=[\w.]*[A-Za-z_])[\w.]{2,30}|[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー々][\p{L}\p{N}ー々]{0,15})/giu;

// Names --------------------------------------------------------------------------------------------------------------

// After a known name, any honorific goes with it; on its own, only the ones that mark a person.
const HONORIFIC = "(?:さん|さま|様|くん|君|ちゃん|氏|殿|先輩|先生)";
// 様 only after two characters or more: 同様, 仕様 and 模様 are words. Hiragana only before ちゃん, くん, 先輩 and 先生:
// before さん it's too often a word (たくさん, みなさん), and ちゃんと is "properly".
const PERSON_HONORIFIC = "(?:さん|くん|ちゃん|先輩|先生|様)";
const WORD = String.raw`[\p{sc=Han}\p{sc=Katakana}ー々]`;
const LATIN_NAME = "(?<![A-Za-z])(?:[A-Z][a-z]+ )?[A-Za-z][A-Za-z'.-]{1,19}"; // Taro Yamadaさん
const NAMED = new RegExp(
  `(${WORD}{1,8}|${LATIN_NAME})(?:さん|くん|ちゃん|先輩|先生)` +
    `|(${WORD}{2,8}|${LATIN_NAME})様` +
    String.raw`|([\p{sc=Hiragana}ー]{2,4})(?:ちゃん(?!と)|くん|先輩|先生)`,
  "gu",
);
const ROLE =
  /(?:係|課|局|会|店|社|協|庁|館|校|院|団|班|組|隊|担当|長|員|役|者|師|医|官|家|大学|東大|京大|阪大|早大|名大|北大|九大|幹事|会計|書記|顧問|監督|コーチ|マネージャー|マネ|リーダー|キャプテン|主将|代表|前任|後任|先代|歴代|年度|窓口|事務|業者|大家|皆|客|後輩|同期|上級生|新入生|学生|年生|院生|留学生|新人|本人|友人|知人|管理人|社会人|大人|選手|運転手|相手|助手|弁護士|税理士|会計士|先方|親方|親|母|父|兄|姉|弟|妹|婆|爺|赤|奥|旦那|神|メンバー|スタッフ|ゲスト|オーナー|ママ|パパ|OB|OG|[〇一二三四五六七八九十百]+[名人])$/u;
// 部, 屋, 所, 室 and 園 end surnames too (阿部, 土屋, 田所, 小室, 前園). A word ending in one is a role only as one of
// these short words, or with three characters or more unless its end is such a surname (学生部 and 保健所 are roles;
// 長谷部 and 日下部 are names).
const PLACE_ROLE =
  /^(?:幹部|本部|学部|支部|外部|内部|全部|本屋|花屋|肉屋|魚屋|酒屋|米屋|宿屋|部屋|問屋|床屋|薬屋|質屋|役所|近所|台所|部室|教室|和室|個室|公園|学園|農園)$/u;
const SURNAME_END =
  /(?:阿部|安部|服部|岡部|渡部|矢部|磯部|武部|長部|南部|卜部|占部|綾部|坂部|岩部|谷部|下部|我部|土屋|古屋|長屋|守屋|高屋|塩屋|杉屋|森屋|関屋|新屋|小屋|田所|別所|小室|氷室|大室|小園|花園|西園|前園|外園|宮園|森園)$/u;
// Hiragana before ちゃん・くん that is a family word, not a name: あかちゃん, おにいちゃん, みんなくん.
const KANA_WORD =
  /^(?:かあ|とう)$|(?:みな|みんな|あか|おかあ|おとう|ばあ|じい|にい|ねえ|おじ|おば|だんな|いもうと|おとうと)$/u;
const GREETING = /^(?:hi|hello|hey|thanks|thank|dear|mr|ms|mrs|dr|prof)\.?$/i;

function isRole(word: string): boolean {
  if (!/[部屋所室園]$/u.test(word)) return ROLE.test(word);
  return (
    PLACE_ROLE.test(word) || ([...word].length >= 3 && !SURNAME_END.test(word))
  );
}

// The names a word before an honorific stands for, and whether each also goes without it. A two- to four-kanji or a
// Latin name does (田中先輩 … 田中に聞く); a one-character, katakana, hiragana or longer word only with its honorific
// (マイク is a microphone). A long kanji run often has the name at its end (今日高橋さん): its last two and three
// characters count as names too.
function candidates(word: string): [string, boolean][] {
  if (/^[\p{sc=Hiragana}ー]+$/u.test(word)) {
    return KANA_WORD.test(word) ? [] : [[word, false]];
  }
  if (/^[A-Za-z]/.test(word)) {
    const parts = word
      .split(" ")
      .filter((part) => !GREETING.test(part) && !isRole(part));
    return parts.length > 0
      ? [
          [parts.join(" "), true],
          ...parts.map((part): [string, boolean] => [part, true]),
        ]
      : [];
  }
  if (isRole(word)) return [];
  const found: [string, boolean][] = [
    [word, /^[\p{sc=Han}々]{2,4}$/u.test(word)],
  ];
  if (/^[\p{sc=Han}々]{3,}$/u.test(word)) {
    for (const size of [2, 3]) {
      const end = word.slice(-size);
      if (end.length < word.length && !isRole(end)) found.push([end, true]);
    }
  }
  return found;
}

// 山田太郎 → 山田太郎, 山田, 太郎; Taro Yamada → Taro, Yamada, TaroYamada; 佐藤花子(会計) → 佐藤花子 too. Emoji and
// symbols in a display name don't count.
function variants(name: string): string[] {
  const full = normalize(name)
    .replace(/[\p{Extended_Pictographic}\p{So}]/gu, "")
    .trim();
  const bare = full.replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, " ").trim();
  const parts = bare.split(/[\s・_.]+/).filter((part) => part.length > 0);
  const joined = parts.join("");
  const found = new Set([full, bare, joined, ...parts]);
  // Without a space, the starts and ends of a three- to five-kanji name stand for the family and given names.
  if (/^[\p{sc=Han}々]{3,5}$/u.test(joined)) {
    for (let i = 1; i < joined.length; i++) {
      found.add(joined.slice(0, i));
      found.add(joined.slice(i));
    }
  }
  return [...found].filter((variant) => /[\p{L}\p{N}]/u.test(variant));
}

// One pattern for a set of words, longest first, each with an optional @ before and honorific after; a word that may
// not stand alone needs the honorific. Latin words match whole words only.
function alternation(
  words: [string, boolean][],
  honorific: string,
): RegExp | undefined {
  const options = words
    .sort(([a], [b]) => b.length - a.length)
    .map(([word, alone]) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const whole = /^[\x20-\x7e]+$/.test(word)
        ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`
        : escaped;
      return alone ? whole : `${whole}(?=${honorific})`;
    });
  return options.length > 0
    ? new RegExp(`@?(${options.join("|")})${honorific}?`, "giu")
    : undefined;
}

// Helpers ----------------------------------------------------------------------------------------------------------

// Replace every match; found is the match as the pattern saw it (with kanji digits read as digits when digits is set,
// which keeps every index: each kanji digit is one character, as is its digit).
function replace(
  text: string,
  pattern: RegExp,
  replacer: (original: string, found: RegExpExecArray) => string,
  digits = false,
): string {
  const haystack = digits
    ? text.replace(/[〇一二三四五六七八九]/g, (digit) =>
        String("〇一二三四五六七八九".indexOf(digit)),
      )
    : text;
  let out = "";
  let last = 0;
  for (const match of haystack.matchAll(pattern)) {
    const end = match.index + match[0].length;
    out +=
      text.slice(last, match.index) +
      replacer(text.slice(match.index, end), match);
    last = end;
  }
  return out + text.slice(last);
}

function host(url: string): string | undefined {
  try {
    const { hostname } = new URL(
      /^https?:\/\//i.test(url) ? url : `http://${url}`,
    );
    return hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

const TOKEN = /\uE000([\uE010-\uE01F]+)\uE001/g;

function encode(index: number): string {
  const code = [...index.toString(16)].map((digit) =>
    String.fromCharCode(0xe010 + Number.parseInt(digit, 16)),
  );
  return `\uE000${code.join("")}\uE001`;
}

function decode(code: string): number {
  return Number.parseInt(
    [...code]
      .map((char) => (char.charCodeAt(0) - 0xe010).toString(16))
      .join(""),
    16,
  );
}
