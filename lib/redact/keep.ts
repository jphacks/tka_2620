// Keep what matters in a chat (docs/SPEC.md → adding knowledge, step 2): by default the last 12 months, counted back
// from the chat's last message, and the messages that look like handover knowledge, each with the message before and
// after it from the same day. What still doesn't fit the request is cut from the oldest end. redactChat runs this on
// the redacted messages: the placeholders mark contact details, and the cap counts what is actually sent.
import { ImportRequest } from "@/lib/contracts";
import type { ChatMessage } from "@/lib/redact/parse";

// The request's cap on text (lib/contracts.ts → ImportRequest); every kind of import shares it.
export const MAX_TEXT =
  ImportRequest.options[0].shape.text.maxLength ?? Number.POSITIVE_INFINITY;

export const KEEP_MONTHS = 12;

// The messages from the last months before the chat's last message, by the export's own dates, so no time zone is
// involved. Messages without a date, as in a paste, all stay.
export function recent(
  messages: ChatMessage[],
  months = KEEP_MONTHS,
): ChatMessage[] {
  const last = messages.reduce(
    (latest, { at }) => (at && at > latest ? at : latest),
    "",
  );
  if (!last) return messages;
  const from = monthsBefore(last, months);
  return messages.filter(({ at }) => !at || at >= from);
}

// 2025-03-10T21:10 and 12 → 2024-03-10T21:10. A day the month doesn't have (2025-03-31 back to 2025-02-31) still
// sorts between that month's last day and the next month's first.
function monthsBefore(at: string, months: number): string {
  const index =
    Number(at.slice(0, 4)) * 12 + Number(at.slice(5, 7)) - 1 - months;
  const month = String((index % 12) + 1).padStart(2, "0");
  return `${Math.floor(index / 12)}-${month}${at.slice(7)}`;
}

// Handover knowledge: a date or a time, an amount, a deadline or a procedure, an office, a rule or a pitfall, or a
// contact detail or secret the redaction replaced. Not what every chat is full of (来週, 明日, 練習, 休み), and no
// role words: the redaction puts roles in (副会計です).
const KNOWLEDGE = new RegExp(
  [
    // 5/10, 2025-10-20, 10月, 20日, 21:00, 9時, 2週間前, 毎月, 月末, 年度末, 火曜
    String.raw`\d{1,4}[/.-]\d{1,2}|\d{1,2}月|\d{1,2}日|\d{1,2}:\d{2}|\d{1,2}時|\d+(?:週間|か月|ヶ月|カ月|日前|日後)`,
    "毎月|毎週|毎年|月末|月初|年度末|年度初め|上旬|中旬|下旬|[月火水木金土日]曜|去年|来年",
    // 3000円, ¥500, 2万
    String.raw`\d[\d,]*\s?円|¥\s?\d|\d+万`,
    "集金|会費|部費|参加費|予算|精算|立て替え|立替|返金|払|振込|振り込|口座|銀行|通帳|現金|領収書|レシート|見積|請求|会計報告",
    "締切|締め切り|〆切|期限|申請|申込|申し込|提出|予約|手続|届出|届け出|書類|許可|登録|更新|キャンセル|代表者|引き継|引継|ハンコ|印鑑|判子|署名",
    "学生課|保健所|事務|窓口|顧問|連絡先|問い合わせ|金庫|鍵|備品|必要|注意|気をつけ|忘れずに|必ず|ルール|決まり",
    // What the redaction put in place of a contact detail, an ID, an account or a secret
    String.raw`\[(?:電話番号|メール|URL|ID|住所|口座番号|カード番号|学籍番号|秘密)`,
  ].join("|"),
  "u",
);

export function looksLikeKnowledge(text: string): boolean {
  return KNOWLEDGE.test(text);
}

// Which messages to send: those that look like knowledge, and the message before and after each from the same day
// (the question it answers, the answer it gets). A message from another day is no context: on the seed, the health
// message of 2024-06-03 would come back as the neighbour of the 精算 message of 2024-04-12.
export function relevant(messages: ChatMessage[]): boolean[] {
  const knowledge = messages.map(({ text }) => looksLikeKnowledge(text));
  const day = (index: number) => messages[index]?.at?.slice(0, 10);
  return messages.map(
    (_, index) =>
      knowledge[index] ||
      [index - 1, index + 1].some(
        (other) => knowledge[other] && day(other) === day(index),
      ),
  );
}

// How many of the newest messages fit in max characters, from each one's length as sent; they're joined by line
// breaks.
export function newest(lengths: number[], max: number): number {
  let used = -1;
  for (let count = 1; count <= lengths.length; count++) {
    used += lengths[lengths.length - count] + 1;
    if (used > max) return count - 1;
  }
  return lengths.length;
}
