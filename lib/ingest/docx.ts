// Word files (docs/SPEC.md → F5, step 1): .docx becomes raw text with mammoth, in the browser. mammoth unzips the
// .docx (a zip) and reads word/document.xml; the file, its XML and its images never leave the device, and nothing is
// stored. A legacy .doc is a different, binary format: the dispatcher rejects it rather than returning mojibake.
import mammoth from "mammoth";
import { assertWithinSize, type Extracted, IngestError } from "./types";

type MammothInput = Parameters<typeof mammoth.extractRawText>[0];

export async function extractDocx(file: Blob): Promise<Extracted> {
  assertWithinSize(file);
  const arrayBuffer = await file.arrayBuffer();
  // mammoth's Node build (vitest) reads `buffer`; its browser build reads `arrayBuffer`. Both keys are set so one
  // code path serves the browser and the tests; buffer is typed as a Node Buffer only to satisfy the declaration.
  const input: MammothInput = {
    arrayBuffer,
    buffer: arrayBuffer as unknown as Buffer,
  };
  try {
    const { value } = await mammoth.extractRawText(input);
    return { text: value };
  } catch {
    throw new IngestError("unreadable");
  }
}
