// Plain text files (docs/SPEC.md → F5, step 1): .txt and .md, read on the device as UTF-8. LINE and WhatsApp
// exports carry a BOM (and Windows editors sometimes UTF-16), so the BOM picks the decoder instead of garbling the
// first line. The repair helper below is small but load-bearing: see its comment.
import { assertWithinSize, type Extracted } from "./types";

export async function extractTextFile(file: Blob): Promise<Extracted> {
  assertWithinSize(file);
  return { text: decodeText(new Uint8Array(await file.arrayBuffer())) };
}

export function decodeText(bytes: Uint8Array): string {
  // utf-8's decoder drops a leading BOM itself; the replace covers encodings that keep it.
  const decoder =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? new TextDecoder("utf-16le")
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? new TextDecoder("utf-16be")
        : new TextDecoder("utf-8");
  return decoder.decode(bytes).replace(/^\uFEFF/, "");
}

// A subset PDF font (seed/notice-2026.sample.pdf) maps 大 to the Kangxi radical ⼤ (U+2F24) and 月 to ⽉, so pdf.js
// faithfully returns 「10⽉19⽇」. NFKC maps a radical back to the character it stands for; without this the model
// reads a date it may not recognise. Only the radical blocks are touched, never the rest of the text.
const RADICALS = /[\u2E80-\u2FDF]/g; // CJK Radicals Supplement + Kangxi Radicals

export function repairRadicals(text: string): string {
  return text.replace(RADICALS, (char) => char.normalize("NFKC"));
}
