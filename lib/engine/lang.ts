// questions.lang (docs/SPEC.md → Data model). The ask field is one text box, so the server reads the question's
// language from its script: kana, kanji or Japanese punctuation means Japanese, anything else English.
// Answers never use this: F2's model returns its own `language` with the sentences.
import type { Lang } from "@/lib/contracts";

// Hiragana, katakana (full- and half-width), CJK ideographs and CJK punctuation.
const JAPANESE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;

export function questionLang(text: string): Lang {
  return JAPANESE.test(text) ? "ja" : "en";
}
