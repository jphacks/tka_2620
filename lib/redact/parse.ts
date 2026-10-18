// Chats become messages on the device (docs/SPEC.md → adding knowledge, step 1): a LINE or WhatsApp export or pasted
// messages turn into { at, speaker, text }, without stickers, photos, files, system lines or messages under four
// characters. The speakers are what the preview lists for the role picker; lib/redact/redact.ts then hides every name.
// Nothing here leaves the browser, and nothing is logged.

export type ChatMessage = {
  at: string | null; // local time as the export writes it, without a zone (2024-04-12T21:03); null in a paste
  speaker: string; // the display name as exported; "" when a pasted line names no one
  text: string;
};

export type ChatPlatform = "line" | "whatsapp" | "paste";

export function parseChat(raw: string, platform: ChatPlatform): ChatMessage[] {
  switch (platform) {
    case "line":
      return parseLine(raw);
    case "whatsapp":
      return parseWhatsApp(raw);
    case "paste":
      return parsePaste(raw);
  }
}

// Every speaker with their message count, in order of first appearance (the preview's role rows).
export function speakers(
  messages: ChatMessage[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { speaker } of messages) {
    if (speaker) counts.set(speaker, (counts.get(speaker) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

// NFKC, as the redaction does: full-width digits and letters, half-width katakana and ＠ become one form.
function lines(raw: string): string[] {
  return raw
    .replace(/^﻿/, "")
    .normalize("NFKC")
    .split(/\r\n|\r|\n/);
}

// LINE ------------------------------------------------------------------------------------------------------------
// トーク → 設定 → トーク履歴を送信: a header (the group's or the other person's name, the save date), then per day a
// date line, 2024/04/12(金) or 2024.04.12 金曜日, and one line per message: 21:03⇥山田太郎⇥本文 (older Android
// exports: spaces instead of tabs). A message with line breaks is quoted, "…\n…", with " doubled inside; a system
// line (joins, unsends, calls) has no speaker field.

const DATE_LINE =
  /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s*\([^)]*\)|\s+\S*曜日)?$/;
const TIME = String.raw`(?:(午前|午後|AM|PM)\s?)?(\d{1,2}):(\d{2})`;
const TAB_LINE = new RegExp(`^${TIME}\\t(.*)$`, "i");
const SPACE_LINE = new RegExp(`^${TIME} +(\\S.*)$`, "i");

type Draft = ChatMessage & { at: string; words?: string[] };

export function parseLine(raw: string): ChatMessage[] {
  const drafts: Draft[] = [];
  let day: string | null = null;
  let current: Draft | null = null; // the message that unquoted continuation lines join
  let open = false; // inside a quoted multi-line message

  for (const line of lines(raw)) {
    const tab = day ? TAB_LINE.exec(line) : null;
    // Inside quotes every line belongs to the message, even one that looks like a date; only a new message line
    // ends it, so a message that merely starts with a quote can't swallow the rest of the chat.
    if (open && current && !tab) {
      current.text += `\n${line}`;
      if (closesQuote(line)) open = false;
      continue;
    }
    open = false;

    const date = DATE_LINE.exec(line.trim());
    if (date) {
      day = `${date[1]}-${pad(date[2])}-${pad(date[3])}`;
      current = null;
      continue;
    }
    if (!day) continue; // the header

    if (tab) {
      const fields = tab[4].split("\t");
      if (fields.length < 2) {
        current = null; // a system line: 山田太郎がグループに参加しました
        continue;
      }
      const text = fields.slice(1).join("\t");
      current = { at: at(day, tab), speaker: fields[0].trim(), text };
      drafts.push(current);
      open = text.startsWith('"') && !closesQuote(text.slice(1));
      continue;
    }

    const space = SPACE_LINE.exec(line);
    if (space) {
      current = {
        at: at(day, space),
        speaker: "",
        text: "",
        words: space[4].split(/ +/),
      };
      drafts.push(current);
      continue;
    }

    if (current && line.trim()) current.text += `\n${line}`;
  }

  splitSpaced(drafts);
  return drafts.flatMap(({ at, speaker, text }) => {
    const message = { at, speaker, text: unquote(text).trim() };
    return speaker && keep(message.text) ? [message] : [];
  });
}

// 21:03 山田 太郎 本文: the name may have spaces too. A second (and third) word joins the name when every message that
// starts with the first word continues with it, at least twice; a line with one word is a system line.
function splitSpaced(drafts: Draft[]): void {
  const spaced = drafts.filter((draft) => draft.words);
  const prefixes = (words: string[]) =>
    [1, 2, 3]
      .filter((k) => words.length > k)
      .map((k) => words.slice(0, k).join(" "));
  const seen = new Map<string, number>();
  for (const { words = [] } of spaced) {
    for (const prefix of prefixes(words)) {
      seen.set(prefix, (seen.get(prefix) ?? 0) + 1);
    }
  }
  for (const draft of spaced) {
    const words = draft.words ?? [];
    const options = prefixes(words);
    if (options.length === 0) continue; // speaker stays "", so the line is dropped
    const first = seen.get(options[0]) ?? 0;
    let k = 1;
    for (let i = options.length; i > 1; i--) {
      const count = seen.get(options[i - 1]) ?? 0;
      if (count >= 2 && count === first) {
        k = i;
        break;
      }
    }
    // Someone who wrote once can't show where their name ends: a second word that could be a name goes with it
    // (losing a word of their message is better than sending half a name).
    if (
      k === 1 &&
      first < 2 &&
      words.length > 2 &&
      /^[^。、!?,.]{1,10}$/u.test(words[1])
    ) {
      k = 2;
    }
    draft.speaker = words.slice(0, k).join(" ");
    draft.text = words.slice(k).join(" ") + draft.text;
  }
}

function at(day: string, time: RegExpExecArray): string {
  return `${day}T${clock(time[1], time[2], time[3])}`;
}

// 21:03, 午後9:03 and 9:03 PM → 21:03.
function clock(half: string | undefined, hour: string, minute: string): string {
  const marker = half?.toUpperCase();
  let hours = Number(hour) % (marker ? 12 : 24);
  if (marker === "午後" || marker === "PM") hours += 12;
  return `${pad(String(hours))}:${minute}`;
}

function pad(value: string): string {
  return value.padStart(2, "0");
}

// A closing quote is an odd run of " at the end of the line ("" is an escaped quote).
function closesQuote(line: string): boolean {
  const run = /"*$/.exec(line.trimEnd())?.[0].length ?? 0;
  return run % 2 === 1;
}

function unquote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/""/g, '"')
    : text;
}

// WhatsApp --------------------------------------------------------------------------------------------------------
// Chat → Export chat → without media: one line per message, 16/10/2025, 17:03 - 名前: 本文 (Android) or
// [16/10/2025, 17:03:12] 名前: 本文 (iPhone), with a message's further lines below it. The phone's settings write the
// date (2025/10/16 in Japan, 10/16/25 in the US, 16.10.25) and the time (17:03, 5:03 PM, 午後5:03). A system line
// (someone added, someone left, a new group name) has no name on Android; an iPhone gives it the chat's own name and
// starts its text with a direction mark (U+200E), as it does for media.

const WA_STAMP = String.raw`(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),? {1,2}(?:(午前|午後) ?)?(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?(?: ?([AaPp])\.? ?[Mm]\.?)?`;
const WA_ANDROID = new RegExp(`^${WA_STAMP} [-–] (.*)$`);
const WA_IPHONE = new RegExp(`^\\[${WA_STAMP}\\] ?(.*)$`);
// 名前: 本文, or 名前: alone when the text starts on the next line. The shortest name that fits, so a colon in the text
// stays there (加藤: 締切: 10/20).
const WA_SPEAKER = /^(.{1,60}?):(?: (.*))?$/;
const MARK = /^\s*[‎‏]/;

// A message with no text of its own: <Media omitted> or <メディアなし> (any words in those brackets), null, a file
// (IMG-20251016-WA0001.jpg (file attached)), image omitted, a deleted message, one still on its way, a shared location,
// a missed call.
const WA_MEDIA = new RegExp(
  [
    String.raw`^<[^<>\n]{1,80}>$`,
    "^null$",
    String.raw`^[^\n]{1,120}\.[A-Za-z0-9]{2,5} \([^()\n]{1,30}\)$`,
    "(?:image|video|audio|sticker|GIF|document|contact card) omitted$",
    "^(?:This message was deleted|You deleted this message|Waiting for this message|(?:この)?メッセージ(?:は削除されました|を削除しました|を待)|Live location shared|Missed (?:group )?(?:voice|video) call|不在着信)",
    String.raw`^(?:location|位置情報): ?https?://\S+$`,
  ].join("|"),
  "i",
);

// The chat's own lines on an iPhone, for an export that lost its direction marks: who was added, removed, left or
// joined, the group made or changed, a new security code or number, the encryption notice. Only for such an export:
// a member may write the same words.
const WA_SYSTEM = new RegExp(
  [
    "end-to-end|エンドツーエンド|security code|セキュリティコード",
    String.raw`^[^\n]{1,60}? (?:added|removed) [^\n]{1,100}$`,
    String.raw`^[^\n]{1,60}? (?:left|joined using|joined from|created group|created this group|changed (?:the subject|the group|this group's|their phone number)|deleted this group's|pinned a message|turned (?:on|off) disappearing)`,
    String.raw`が[^\n]{1,60}を(?:追加|削除)しました$|が(?:退出|参加)しました$|(?:グループ|招待リンク|コミュニティ|アイコン|説明)[^\n]{0,40}(?:参加|作成|変更|削除|退出)しました$|電話番号を[^\n]{0,40}変更しました$`,
  ].join("|"),
  "i",
);

// What WhatsApp adds to a message edited after sending.
const EDITED = /[ ‎‏]{0,3}<[^<>\n]{0,40}(?:edited|編集)[^<>\n]{0,40}>$/i;

type WhatsAppDraft = {
  date: string; // as written (16/10/2025); which field is the day is decided from every date in the export
  time: string; // 17:03
  speaker: string;
  text: string;
  iphone: boolean;
};

export function parseWhatsApp(raw: string): ChatMessage[] {
  const drafts: WhatsAppDraft[] = [];
  let current: WhatsAppDraft | null = null; // the message that further lines join
  for (const line of lines(raw)) {
    const head = whatsAppHead(line);
    if (head) {
      current = head;
      drafts.push(head);
    } else if (isLineRow(line)) {
      current = null; // a LINE row (21:03⇥名前⇥本文) is no part of a message: its name would go out as text
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    }
  }

  const dayFirst = readsDayFirst(drafts.map(({ date }) => date));
  const marked = drafts.some(({ text }) => MARK.test(text)); // the export marks its system lines
  return drafts.flatMap(({ date, time, speaker, text, iphone }) => {
    const message = {
      at: whatsAppAt(date, dayFirst, time),
      speaker,
      text: text.replace(EDITED, "").trim(),
    };
    const dropped =
      MARK.test(message.text) ||
      WA_MEDIA.test(message.text) ||
      (iphone &&
        !marked &&
        !message.text.includes("\n") &&
        WA_SYSTEM.test(message.text));
    return speaker && !dropped && keep(message.text) ? [message] : [];
  });
}

// A WhatsApp message line as parseWhatsApp reads it, for telling a WhatsApp export from other text
// (components/redaction.ts).
export function isWhatsAppLine(line: string): boolean {
  return Boolean(whatsAppHead(line.normalize("NFKC"))?.speaker);
}

function whatsAppHead(line: string): WhatsAppDraft | null {
  const bare = line.replace(/^[‎‏﻿]+/, "");
  const iphone = WA_IPHONE.exec(bare);
  const head = iphone ?? WA_ANDROID.exec(bare);
  if (!head) return null;
  const said = WA_SPEAKER.exec(head[6]);
  const speaker = said ? speakerName(said[1]) : "";
  return {
    date: head[1],
    time: clock(head[2] ?? (head[5] && `${head[5]}M`), head[3], head[4]),
    speaker,
    text: speaker ? (said?.[2] ?? "") : head[6],
    iphone: iphone !== null,
  };
}

// Without direction marks. A "name" holding quotes belongs to a system line that quotes a group's name (changed the
// subject to "練習: 土曜"); a name has a letter or a digit.
function speakerName(raw: string): string {
  const name = raw.replace(/\p{Cf}/gu, "").trim();
  return /[\p{L}\p{N}]/u.test(name) && !/["“”„「」『』]/.test(name) ? name : "";
}

function isLineRow(line: string): boolean {
  return TAB_LINE.exec(line)?.[4].includes("\t") ?? false;
}

// Whether 05/10/2025 is the 5th of October: a field over 12 is the day; else the reading under which the dates run in
// order; else day first, as most phones write it, but month first for a two-digit year after slashes (10/16/25, the
// US). A year first (2025/10/16) reads one way only.
function readsDayFirst(dates: string[]): boolean {
  const fields = dates
    .map((date) => date.split(/[/.-]/))
    .filter(([first]) => first.length <= 2)
    .map((parts) => parts.map(Number));
  const dayFirst = fields.every(([, second]) => second <= 12);
  const monthFirst = fields.every(([first]) => first <= 12);
  if (dayFirst !== monthFirst) return dayFirst;
  if (dayFirst) {
    const backwards = (day: number, month: number) =>
      fields.filter(
        (date, index) =>
          index > 0 &&
          ordinal(date, day, month) < ordinal(fields[index - 1], day, month),
      ).length;
    const dm = backwards(0, 1);
    const md = backwards(1, 0);
    if (dm !== md) return dm < md;
  }
  return !dates.some((date) => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(date));
}

function ordinal(fields: number[], day: number, month: number): number {
  return fields[2] * 10000 + fields[month] * 100 + fields[day];
}

// 2025-10-16T17:03, or null for a date no calendar has.
function whatsAppAt(
  date: string,
  dayFirst: boolean,
  time: string,
): string | null {
  const [a, b, c] = date.split(/[/.-]/);
  const [year, month, day] =
    a.length > 2 ? [a, b, c] : dayFirst ? [c, b, a] : [c, a, b];
  const full = year.length <= 2 ? `20${year.padStart(2, "0")}` : year;
  const valid =
    full.length === 4 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31;
  return valid ? `${full}-${pad(month)}-${pad(day)}T${time}` : null;
}

// Paste ----------------------------------------------------------------------------------------------------------
// Copied messages from Slack, Discord, X or Instagram have no fixed format. Lines that name a speaker are 名前: 本文
// (or 名前：本文), and the headers 名前 — 2024/04/12 21:03 (Discord) or 名前 [21:03] (Slack); other lines continue the
// message above them, or stand alone without a speaker. Common field labels are never speakers (締切: 10/20).

const COLON_LINE = /^([^\s:][^:]{0,23}?)\s*:\s*(.*)$/;
const CLOCK = String.raw`(?:(?:午前|午後|AM|PM)\s?)?\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?`;
// 名前 — 2024/04/12 21:03, 名前 [21:03], 名前␣␣21:03 (two spaces) or 名前 9:03 PM. 練習 19:00 and 新歓⇥18:30 (a
// schedule copied from a spreadsheet) are no headers.
const HEADER_LINE = new RegExp(
  String.raw`^(\S.{0,23}?)(?:\s+[—–]\s+.*\d{1,2}:\d{2}.*|\s+\[${CLOCK}\]| {2,}${CLOCK}|\s\d{1,2}:\d{2}\s?[AP]M)$`,
  "i",
);
const LEADING_CLOCK = new RegExp(String.raw`^\[${CLOCK}\]\s*`, "i"); // [21:05] 名前: 本文

// A line shaped like a copied chat's header, which a doc doesn't have: the 「＋ 追加」 panel (components/redaction.ts)
// reads text pasted as a doc as a chat when it holds one, so its speakers get roles.
export function isChatHeader(line: string): boolean {
  return HEADER_LINE.test(line) || LEADING_CLOCK.test(line);
}
const LABELS = new Set([
  "日時",
  "日付",
  "時間",
  "時刻",
  "場所",
  "会場",
  "集合",
  "解散",
  "締切",
  "締め切り",
  "〆切",
  "期限",
  "期間",
  "日程",
  "内容",
  "詳細",
  "備考",
  "注意",
  "注意事項",
  "件名",
  "宛先",
  "宛名",
  "金額",
  "費用",
  "料金",
  "会費",
  "部費",
  "参加費",
  "持ち物",
  "連絡先",
  "連絡",
  "担当",
  "担当者",
  "住所",
  "電話",
  "メール",
  "申込",
  "申し込み",
  "申請",
  "提出",
  "提出先",
  "目的",
  "対象",
  "定員",
  "予算",
  "方法",
  "手順",
  "結果",
  "理由",
  "補足",
  "追記",
  "メモ",
  "例",
  "質問",
  "回答",
  "答え",
  "q",
  "a",
  "url",
  "tel",
  "fax",
  "id",
  "pin",
  "to",
  "from",
  "cc",
  "subject",
  "date",
  "time",
  "place",
  "note",
  "re",
  "fwd",
  "ps",
]);

export function parsePaste(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let current: ChatMessage | null = null;
  for (const line of lines(raw)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = HEADER_LINE.exec(trimmed);
    const colon = header
      ? null
      : COLON_LINE.exec(trimmed.replace(LEADING_CLOCK, ""));
    const name = header?.[1] ?? colon?.[1];
    if (name && isSpeaker(name) && !colon?.[2].startsWith("//")) {
      current = { at: null, speaker: name.trim(), text: colon?.[2] ?? "" };
      messages.push(current);
    } else if (current) {
      current.text += current.text ? `\n${line.trimEnd()}` : trimmed;
    } else {
      current = { at: null, speaker: "", text: trimmed };
      messages.push(current);
    }
  }
  return messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => keep(message.text));
}

function isSpeaker(label: string): boolean {
  const name = label.trim();
  const plain = name
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toLowerCase();
  return (
    /\p{L}/u.test(name) &&
    !/[/。、!?「」]|^\d|\s\d{1,2}$/.test(name) && // 名前 21:03 split at the colon is no name
    name.split(" ").length <= 3 &&
    !LABELS.has(plain)
  );
}

// Dropped messages -----------------------------------------------------------------------------------------------

const MEDIA =
  /^(?:\[(?:スタンプ|写真|動画|ファイル|ボイスメッセージ|アルバム|位置情報|連絡先|ノート|sticker|photo|video|file|voice message|album|location|contact|note)\](?:\s.*)?|<(?:media omitted|メディアなし|メディアは含まれていません)>)$/i;
const SYSTEM =
  /(?:送信を取り消しました|グループに参加しました|退会しました|を招待しました|が参加しました|グループ名を.*に変更しました|アイコンを変更しました|アルバム.*を(?:作成|追加|削除|変更)しました|ノートに投稿しました|unsent a message|joined the group|left the group|to the group)$|^(?:☎\s*)?(?:通話時間\s*\d|不在着信$|通話をキャンセルしました$|グループ通話が(?:開始|終了)されました$|missed call$|call time\s*\d)/i;

function keep(text: string): boolean {
  if ([...text].length < 4) return false;
  if (MEDIA.test(text)) return false;
  return text.includes("\n") || !SYSTEM.test(text);
}
