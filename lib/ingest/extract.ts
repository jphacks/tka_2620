// The way in for a dropped or picked file (docs/SPEC.md → F5, step 1): decide what it is, then let the parser turn it
// into text on the device. The screens show the text in the redaction preview and only that text goes to
// POST /api/import; the file itself is never uploaded, stored or sent to a model.
//
//   import { extractFile, fileTypeOf } from "@/lib/ingest/extract";
//   const extracted = await extractFile(file);          // throws IngestError with a code
//   type: fileTypeOf(file)                             // "pdf" | "docx" | "txt" | "md", for ImportRequest
//
// The parsers are imported on demand, so a page that only pastes text never downloads pdfjs-dist or mammoth.
import { type Extracted, type FileType, IngestError } from "./types";

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

export async function extractFile(file: File): Promise<Extracted> {
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
