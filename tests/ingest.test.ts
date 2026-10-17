// F5.3 (issue #33): a dropped file becomes text on the device (docs/SPEC.md → F5, step 1). The acceptance check is
// the seed samples: the Word handover and the text-layer PDF give their text, the image-only scan is reported as
// unreadable, and a file over the limit is refused before it is read. Nothing is uploaded, stored or logged, and an
// error carries a code only — never a line of the file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/ingest/docx";
import { extractFile, fileTypeOf } from "@/lib/ingest/extract";
import { extractPdf } from "@/lib/ingest/pdf";
import { decodeText, extractTextFile, repairRadicals } from "@/lib/ingest/text";
import { IngestError, MAX_FILE_BYTES } from "@/lib/ingest/types";

const DOCX = "handover-2024.sample.docx";
const NOTICE = "notice-2026.sample.pdf";
const SCAN = "scan.sample.pdf";
const HANDOVER_MD = "old-handover.sample.md";

// A real File, as the browser hands it to the drop zone.
function sample(name: string, type: string): File {
  return new File(
    [readFileSync(new URL(`../seed/${name}`, import.meta.url))],
    name,
    {
      type,
    },
  );
}

// The thrown IngestError, so a test can read its code. Anything else is rethrown and fails the test.
async function refusal(run: () => Promise<unknown>): Promise<IngestError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof IngestError) return error;
    throw error;
  }
  throw new Error("expected an IngestError");
}

describe("fileTypeOf", () => {
  it.each([
    ["notice.pdf", "application/pdf", "pdf"],
    ["handover.docx", "", "docx"],
    ["notes.txt", "", "txt"],
    ["old-handover.md", "text/plain", "md"], // the extension wins over a Windows media type
    ["export", "text/plain", "txt"], // no extension: the media type decides
    ["export", "application/pdf", "pdf"],
  ] as const)("%s (%s) → %s", (name, type, expected) => {
    expect(fileTypeOf({ name, type })).toBe(expected);
  });

  it.each([
    ["handover.doc", "application/msword"], // binary Word: a different format entirely
    ["budget.xlsx", "application/vnd.ms-excel"],
    ["photo.png", "image/png"],
    ["", ""],
  ])("rejects %s", (name, type) => {
    expect(fileTypeOf({ name, type })).toBeUndefined();
  });
});

describe("decodeText", () => {
  it("reads UTF-8, with or without a BOM", () => {
    const utf8 = new TextEncoder().encode("保健所の締切");
    expect(decodeText(utf8)).toBe("保健所の締切");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe(
      "保健所の締切",
    );
  });

  it("reads a UTF-16LE export, where each ASCII letter is two bytes", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
    expect(decodeText(bytes)).toBe("AB");
  });
});

describe("repairRadicals", () => {
  it("turns the Kangxi radicals a subset font emits back into characters", () => {
    expect(repairRadicals("みなと⼤学 10⽉19⽇ 3,000⾦")).toBe(
      "みなと大学 10月19日 3,000金",
    );
  });
});

describe("text files", () => {
  it("gives an added .md file its text through the dispatcher", async () => {
    const { text } = await extractFile(sample(HANDOVER_MD, "text/markdown"));
    expect(text).toContain("# 会計 引き継ぎ（2024年度 → 2025年度）");
    expect(text).toContain("保健所の書類がある（学生課でもらう）");
  });
});

describe("Word files", () => {
  it("gives seed/handover-2024.sample.docx its text", async () => {
    const { text, pages } = await extractDocx(sample(DOCX, ""));
    expect(text).toContain("会計 引き継ぎメモ（2024年度）");
    expect(text).toContain("保健所の書類は学生課でもらう。早めに出す。");
    expect(text).toContain("年度末（3月）に会計報告。");
    expect(pages).toBeUndefined(); // pages is a PDF notion
  });

  it("returns the file as written, name and phone included: redaction is the next step, not this one", async () => {
    const { text } = await extractFile(sample(DOCX, ""));
    expect(text).toContain("山田");
    expect(text).toContain("090-1234-5678");
  });
});

describe("PDF files", () => {
  it("gives seed/notice-2026.sample.pdf its text and its page count", async () => {
    const { text, pages } = await extractPdf(sample(NOTICE, "application/pdf"));
    expect(pages).toBe(1);
    expect(text).toContain("保健所への臨時営業届提出期限");
    expect(text).toContain("2026年10月19日"); // the font's radicals are repaired
    expect(text).not.toMatch(/[\u2e80-\u2fdf]/);
  });

  it("reports seed/scan.sample.pdf as having no text layer, with no page text in the error", async () => {
    const error = await refusal(() =>
      extractPdf(sample(SCAN, "application/pdf")),
    );
    expect(error.code).toBe("no_text");
    expect(error.message).toBe("no_text");
  });

  it("refuses a file over 10 MB before reading a byte of it", async () => {
    const huge = { size: MAX_FILE_BYTES + 1 } as unknown as File;
    expect((await refusal(() => extractPdf(huge))).code).toBe("too_large");
    expect((await refusal(() => extractTextFile(huge))).code).toBe("too_large");
    expect((await refusal(() => extractDocx(huge))).code).toBe("too_large");
  });
});

describe("extractFile", () => {
  it("refuses a type it cannot read, naming no file content", async () => {
    const doc = new File(["x"], "handover.doc", {
      type: "application/msword",
    });
    const error = await refusal(() => extractFile(doc));
    expect(error.code).toBe("unsupported");
    expect(error.message).toBe("unsupported");
  });
});
