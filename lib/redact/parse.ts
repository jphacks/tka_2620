// Chats become messages on the device (docs/SPEC.md → adding knowledge, step 1): a LINE export or pasted messages
// turn into { at, speaker, text }, without stickers, photos, files, system lines or messages under four characters.
// The speakers are what the preview lists for the role picker; lib/redact/redact.ts then hides every name. Nothing
// here leaves the browser, and nothing is logged.

export type ChatMessage = {
  at: string | null; // local time as the export writes it, without a zone (2024-04-12T21:03); null in a paste
  speaker: string; // the display name as exported; "" when a pasted line names no one
  text: string;
};

export type ChatPlatform = "line" | "paste"; // WhatsApp is #32

export function parseChat(raw: string, platform: ChatPlatform): ChatMessage[] {
  return platform === "line" ? parseLine(raw) : parsePaste(raw);
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
    draft.speaker = words.slice(0, k).join(" ");
    draft.text = words.slice(k).join(" ") + draft.text;
  }
}

function at(day: string, time: RegExpExecArray): string {
  const half = time[1]?.toUpperCase();
  let hour = Number(time[2]) % (half ? 12 : 24);
  if (half === "午後" || half === "PM") hour += 12;
  return `${day}T${pad(String(hour))}:${time[3]}`;
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

// Paste ----------------------------------------------------------------------------------------------------------
// Copied messages from Slack, Discord, X or Instagram have no fixed format. Lines that name a speaker are 名前: 本文
// (or 名前：本文), and the headers 名前 — 2024/04/12 21:03 (Discord) or 名前 [21:03] (Slack); other lines continue the
// message above them, or stand alone without a speaker. Common field labels are never speakers (締切: 10/20).

const COLON_LINE = /^([^\s:][^:]{0,23}?)\s*:\s*(.*)$/;
const HEADER_LINE =
  /^(\S.{0,23}?)\s+(?:[—–]\s+.*\d{1,2}:\d{2}.*|\[(?:(?:午前|午後|AM|PM)\s?)?\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\])$/i;
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
    const colon = header ? null : COLON_LINE.exec(trimmed);
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
    !/[/。、!?「」]|^\d/.test(name) &&
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
