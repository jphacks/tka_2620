// The way in for a dropped or picked file (docs/SPEC.md → F5, step 1): decide what it is, then let the parser turn it
// into text on the device. The screens show the text in the redaction preview and only that text goes to
// POST /api/import; the file itself is never uploaded, stored or sent to a model.
//
//   import { extractFile, fileTypeOf } from "@/lib/ingest/extract";
//   const extracted = await extractFile(file);          // throws IngestError with a code, and nothing else
//   type: fileTypeOf(file)                             // "pdf" | "docx" | "txt" | "md", for ImportRequest
//
// The parsers are imported on demand, so a page that only pastes text never downloads pdfjs-dist or mammoth.
import {
  type Extracted,
  type FileType,
  IngestError,
  MAX_TEXT_CHARS,
} from "./types";

const BY_EXTENSION: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
  txt: "txt",
  md: "md",
};

const BY_MEDIA_TYPE: Record<string, FileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};

// The extension decides first: a .md file Windows reports as text/plain is still markdown. The media type is only a
// fallback for a file with no or an unknown extension. .doc (binary Word), .csv, .xlsx and the rest are unsupported.
export function fileTypeOf(
  file: Pick<File, "name" | "type">,
): FileType | undefined {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return (
    BY_EXTENSION[extension] ?? BY_MEDIA_TYPE[file.type.trim().toLowerCase()]
  );
}

// Text the preview can show and POST /api/import accepts, or an IngestError. A parser's own error becomes
// `unreadable`, since its message could quote the file. Blank text is `no_text` for every type (a Word file of
// pasted scans too), and text over the request's limit is refused here, at the drop, not after the consent.
export async function extractFile(file: File): Promise<Extracted> {
  const extracted = await parse(file).catch((error: unknown) => {
    throw error instanceof IngestError ? error : new IngestError("unreadable");
  });
  if (!extracted.text.trim()) throw new IngestError("no_text");
  if (extracted.text.length > MAX_TEXT_CHARS)
    throw new IngestError("too_large");
  return extracted;
}

async function parse(file: File): Promise<Extracted> {
  switch (fileTypeOf(file)) {
    case "pdf":
      return (await import("./pdf")).extractPdf(file);
    case "docx":
      return (await import("./docx")).extractDocx(file);
    case "txt":
    case "md":
      return (await import("./text")).extractTextFile(file);
    default:
      throw new IngestError("unsupported");
  }
}
