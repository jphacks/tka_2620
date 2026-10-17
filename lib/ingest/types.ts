// Adding knowledge (docs/SPEC.md → F5, step 1): a file becomes plain text on the device; the file itself never leaves
// the browser. This holds what the three parsers share. A failure carries a code and nothing else — never a line of
// the file — so lib/ingest/ contains no copy: the screens turn the code into a message (messages/*.json →
// import.scanned / import.tooLarge / import.dropFile).
import type { ImportRequest } from "@/lib/contracts";

// What POST /api/import calls a file; the dispatcher and the request agree on it (lib/contracts.ts → ImportRequest).
export type FileType = Extract<ImportRequest, { kind: "file" }>["fileType"];

// A parsed file. pages is set for PDFs only: the screens show it (「資料.pdf（3ページ）を読み込みました」).
export type Extracted = {
  text: string;
  pages?: number;
};

export type IngestErrorCode =
  | "too_large" // over 10 MB, or more text than POST /api/import takes
  | "too_many_pages" // a PDF over 30 pages
  | "no_text" // nothing but whitespace: for a PDF, no text layer (an image or a scan)
  | "unsupported" // not a PDF, .docx, .txt or .md
  | "unreadable"; // the bytes are not the file they claim to be

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode) {
    super(code);
    this.name = "IngestError";
    this.code = code;
  }
}

// docs/SPEC.md → F5: a file with a text layer, up to 10 MB / 30 pages. The limits are the same for every type.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 30;
// The most text POST /api/import takes (lib/contracts.ts → ImportRequest.text; tests/ingest.test.ts pins the two).
// Only extractFile applies it: a chat export is cut down to what matters before it is sent.
export const MAX_TEXT_CHARS = 100_000;

// The size is checked before anything is read, so an oversized file is never decoded and never held in memory twice.
export function assertWithinSize(file: Blob): void {
  if (file.size > MAX_FILE_BYTES) throw new IngestError("too_large");
}
