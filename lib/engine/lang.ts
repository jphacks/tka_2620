// questions.lang (docs/SPEC.md → Data model). The ask field is one text box, so the server reads the question's
// language from its script. The lang travels with the question: the predecessor's inbox shows it (InboxItem.lang),
// and the live loop's re-answer is written in it (waiting_questions() in 0003).
import type { Lang } from "@/lib/contracts";

const KANA = /[぀-ヿｦ-ﾟ]/; // hiragana, katakana, half-width katakana
const KANJI = /[㐀-䶿一-鿿]/;
const LATIN = /[A-Za-zＡ-Ｚａ-ｚ]/; // full-width letters too

// Kana means Japanese. Kanji alone can be a Japanese word inside an English question (When is the 保健所 deadline?),
// so without kana a question is Japanese only when it has no Latin letters either.
export function questionLang(text: string): Lang {
  if (KANA.test(text)) return "ja";
  return KANJI.test(text) && !LATIN.test(text) ? "ja" : "en";
}
