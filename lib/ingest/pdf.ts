// PDF files (docs/SPEC.md → F5, step 1): pdfjs-dist reads the text layer in the browser, up to 10 MB / 30 pages.
// A PDF with no text layer — a photo or a scan — throws `no_text`, which the screens show as
// 「文字を読み取れないPDFです。文字をコピーして貼り付けてください」 (messages → import.scanned). The file is never
// uploaded and its bytes are dropped as soon as the text is out. Nothing here logs a page.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { repairRadicals } from "./text";
import {
  assertWithinSize,
  type Extracted,
  IngestError,
  MAX_PAGES,
} from "./types";

// pdfjs parses in a Web Worker. Next resolves the bare specifier in the URL (react-pdf's documented pattern); under
// vitest (Node) pdfjs parses on the main thread and never reads this. The legacy build is used in both so the parser
// is the same one the tests exercise.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

export async function extractPdf(file: Blob): Promise<Extracted> {
  assertWithinSize(file);
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise.catch(() => {
    throw new IngestError("unreadable");
  });
  try {
    if (doc.numPages > MAX_PAGES) throw new IngestError("too_many_pages");
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      // A line ends where pdf.js says it does (hasEOL). Joined without it, a heading runs into its body and a line's
      // last number into the next line's first (03-1234-5678 + 2026年 → 03-1234-56782026年), which no phone pattern
      // in the redaction or the server's safety net finds any more.
      pages.push(
        content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
          )
          .join("")
          .trimEnd(),
      );
      page.cleanup();
    }
    const text = repairRadicals(pages.join("\n\n")); // a blank line between pages
    // No text layer: whitespace only. The asker is told to copy the text instead of uploading a screenshot.
    if (!text.trim()) throw new IngestError("no_text");
    return { text, pages: doc.numPages };
  } finally {
    // Releases the document and the worker; the bytes are dropped here, before the text is redacted.
    await task.destroy();
  }
}
