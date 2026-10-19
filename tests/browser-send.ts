// What 「＋ 追加」 sends to POST /api/import for a file or a paste, built the way the browser builds it (docs/SPEC.md →
// adding knowledge, steps 1–5), for pnpm test:redact (scripts/check-redact.ts) and tests/redact-path.test.ts. No React:
// this follows components/AddSlip.tsx (readFile, check, importRequest) and components/RedactionPreview.tsx (`sent`,
// the default roles, 「全部使う」, when Send stays disabled), and tests/redact-path.test.ts fails when those lines
// change, so this copy follows them. The person adding does the least they can: the default roles メンバーA/B/C, no
// word typed into 「ほかに隠す言葉」. Nothing here prints a sample's text.
import { readdirSync, readFileSync } from "node:fs";
import { memberLetter, readSource, type Source } from "@/components/redaction";
import type { ImportRequest, RedactionCounts } from "@/lib/contracts";
import { extractFile, fileTypeOf } from "@/lib/ingest/extract";
import { extractTextFile } from "@/lib/ingest/text";
import { IngestError, MAX_TEXT_CHARS } from "@/lib/ingest/types";
import { speakers } from "@/lib/redact/parse";
import { redactChat, redactText } from "@/lib/redact/redact";
import ja from "@/messages/ja.json";

const SEED = new URL("../seed/", import.meta.url);

// Every made-up file in seed/ that 「＋ 追加」 could be handed (seed/*.sample.*), so a new sample, such as a WhatsApp
// export, is added by the checks without touching them.
export const SAMPLES = readdirSync(SEED)
  .filter((name) => name.includes(".sample."))
  .sort();

// One press of 「送る」: the request, and the body lib/api.ts puts on the wire for it.
export type Send = {
  request: ImportRequest;
  body: string;
  counts: RedactionCounts; // what the counts line in the preview says was hidden
  messages?: { kept: number; total: number }; // a chat's: how many of its messages go
  keepAll?: boolean; // a chat sent with 「全部使う」
};

export type Added = {
  name: string;
  // The text on the device before any redaction, for the checks' positive control. Never printed.
  raw: string;
  // Why nothing is sent: an IngestError code (a scan is no_text), what readSource made of the text (a chat it can't
  // read safely), or a Send button that stays disabled (nothing kept, or too long).
  refused?: string;
  // What can be sent: a chat as the preview opens it, then with 「全部使う」 when the preview offers it.
  sends: Send[];
};

// AddSlip.readFile: the file becomes text on the device, then goes where its text says: a document, unless its text
// turns out to be a chat (a LINE or WhatsApp export is one by its form). One ファイル tab takes both, and a file dropped
// anywhere on the page reads the same way.
// `asChat`: the person taps 「トークとして読む」 where a text file of messages offers it.
export async function addFile(
  name: string,
  seat: string,
  { asChat = false }: { asChat?: boolean } = {},
): Promise<Added> {
  const file = new File([readFileSync(new URL(name, SEED))], name);
  const fileType = fileTypeOf(file);
  let raw = "";
  try {
    if (!fileType) throw new IngestError("unsupported");
    const { text, pages } =
      fileType === "txt"
        ? await extractTextFile(file)
        : await extractFile(file);
    raw = text;
    const next = readSource(text, "text");
    if (!next) throw new IngestError("no_text");
    if (next.kind === "chat") return preview(name, raw, seat, next);
    if (next.kind !== "text")
      return { name, raw, refused: next.kind, sends: [] };
    if (text.length > MAX_TEXT_CHARS) throw new IngestError("too_large");
    if (asChat && next.messages && (fileType === "txt" || fileType === "md"))
      return preview(name, raw, seat, {
        kind: "chat",
        platform: "paste",
        messages: next.messages,
      });
    return preview(name, raw, seat, {
      kind: "file",
      fileType,
      text,
      name: file.name,
      pages,
    });
  } catch (error) {
    // problemOf: a parser's own error is unreadable.
    const refused = error instanceof IngestError ? error.code : "unreadable";
    return { name, raw, refused, sends: [] };
  }
}

// AddSlip.check: text pasted into 貼り付け as 「資料」 ("text") or 「コピーしたメッセージ」 ("chat"). `asChat`: the person taps
// 「トークとして読む」 where a doc with 名前: 本文 lines offers it.
export function addPaste(
  name: string,
  raw: string,
  seat: string,
  pasteAs: "text" | "chat",
  { asChat = false }: { asChat?: boolean } = {},
): Added {
  const next = readSource(raw, pasteAs);
  if (!next) return { name, raw, refused: "empty", sends: [] };
  if (next.kind === "chat") return preview(name, raw, seat, next);
  if (next.kind === "text" && asChat && next.messages)
    return preview(name, raw, seat, {
      kind: "chat",
      platform: "paste",
      messages: next.messages,
    });
  if (next.kind === "text")
    return preview(name, raw, seat, { kind: "text", text: next.text });
  return { name, raw, refused: next.kind, sends: [] };
}

// RedactionPreview: a doc is redacted as it is; a chat's speakers get the default roles, and the preview opens with
// what lib/redact keeps (the last 12 months and what matters), offering 「全部使う」 when that isn't every message.
// Send stays disabled while the text is empty or too long.
function preview(
  name: string,
  raw: string,
  seat: string,
  source: Source,
): Added {
  const sends: Send[] = [];
  let disabled: string | undefined;
  const add = (text: string, counts: RedactionCounts, extra: Partial<Send>) => {
    if (!text.trim()) disabled ??= "empty";
    else if (text.length > MAX_TEXT_CHARS) disabled ??= "too_long";
    else {
      const request = importRequest(seat, source, text, counts);
      sends.push({ request, body: JSON.stringify(request), counts, ...extra });
    }
  };
  if (source.kind !== "chat") {
    const sent = redactText(source.text, { hide: [] });
    add(sent.text, sent.counts, {});
  } else {
    const roles = Object.fromEntries(
      speakers(source.messages).map(({ name: speaker }, index) => [
        speaker,
        ja.import.member.replace("{letter}", memberLetter(index)),
      ]),
    );
    for (const keepAll of [false, true]) {
      const run = redactChat(source.messages, { roles, hide: [], keepAll });
      add(run.text, run.counts, {
        messages: { kept: run.kept, total: run.total },
        keepAll,
      });
      if (run.kept >= run.total) break; // every message already goes: no 「全部使う」
    }
  }
  return sends.length > 0
    ? { name, raw, sends }
    : { name, raw, refused: disabled ?? "empty", sends };
}

// AddSlip.importRequest, as it is.
function importRequest(
  seat: string,
  source: Source,
  text: string,
  redaction: RedactionCounts,
): ImportRequest {
  switch (source.kind) {
    case "text":
      return { seat, kind: "text", text, redaction };
    case "file":
      return { seat, kind: "file", fileType: source.fileType, text, redaction };
    case "chat":
      return { seat, kind: "chat", platform: source.platform, text, redaction };
  }
}
