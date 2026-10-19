// F5.8 (#38): what leaves the browser for every made-up file in seed/, offline, so each change to lib/redact,
// lib/ingest or the 「＋ 追加」 slip meets it in pnpm test. tests/browser-send.ts builds the requests the way the browser
// does; pnpm test:redact (scripts/check-redact.ts) sends the same ones through the real route and model. A failure
// names a sample by its file name and a canary by its line in seed/chat-canaries.txt, never a text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportRequest, RedactionCounts } from "@/lib/contracts";
import { decoded, joined } from "@/scripts/outgoing";
import { addFile, addPaste, SAMPLES } from "./browser-send";
import { foundLines } from "./canaries";

const SEAT = "smash-kaikei";
// What the slip refuses on purpose: a scan has no text layer, so it shows the paste hint (docs/SPEC.md → F5).
const REFUSED: Record<string, string> = { "scan.sample.pdf": "no_text" };

const added = await Promise.all(SAMPLES.map((name) => addFile(name, SEAT)));

function sample(name: string) {
  const found = added.find((item) => item.name === name);
  if (!found) throw new Error(`no ${name} in seed/`);
  return found;
}

const inBody = (body: string) => foundLines(joined(decoded(body)));

describe("what the browser sends for each made-up file in seed/", () => {
  it("adds every sample but the scan, which gets the paste hint", () => {
    expect(
      added.map(({ name, refused }) => [name, refused ?? "added"]),
    ).toEqual(SAMPLES.map((name) => [name, REFUSED[name] ?? "added"]));
    for (const { refused, sends } of added) {
      expect(sends.length > 0).toBe(!refused);
    }
  });

  it("sends no canary, for the chat and for the files", () => {
    const leaks = added.flatMap(({ name, sends }) =>
      sends
        .map((send) => [name, inBody(send.body)] as const)
        .filter(([, lines]) => lines.length > 0),
    );
    expect(leaks).toEqual([]);
  });

  // The control: without canaries in the samples, "no canary sent" would prove nothing.
  it("has something to find: the chat and the Word file hold canaries as exported", () => {
    expect(
      foundLines(sample("chat-line.sample.txt").raw).length,
    ).toBeGreaterThan(0);
    expect(
      foundLines(sample("handover-2024.sample.docx").raw).length,
    ).toBeGreaterThan(0);
  });

  it("sends the request's own fields and nothing else: no file name, no raw text", () => {
    const own = {
      text: ["kind", "redaction", "seat", "text"],
      file: ["fileType", "kind", "redaction", "seat", "text"],
      chat: ["kind", "platform", "redaction", "seat", "text"],
    };
    for (const { sends } of added) {
      for (const { body } of sends) {
        const sent = JSON.parse(body);
        expect(ImportRequest.safeParse(sent).success).toBe(true);
        expect(Object.keys(sent).sort()).toEqual(
          own[sent.kind as keyof typeof own],
        );
        expect(Object.keys(sent.redaction).sort()).toEqual(
          Object.keys(RedactionCounts.shape).sort(),
        );
      }
    }
  });

  it("sends a chat with 「全部使う」 too when the preview keeps fewer messages than it has", () => {
    for (const { sends } of added) {
      const [first, second] = sends;
      if (!first?.messages) continue;
      expect(first.keepAll).toBe(false);
      if (first.messages.kept < first.messages.total) {
        expect(second?.keepAll).toBe(true);
        expect(second?.messages?.kept).toBe(second?.messages?.total);
      } else {
        expect(sends).toHaveLength(1);
      }
    }
  });

  it("sends the chat the same when it's pasted as either choice, and the handover pasted as text", () => {
    const chat = sample("chat-line.sample.txt");
    const sent = chat.sends.map(({ body }) => body).join("\n");
    for (const pasteAs of ["text", "chat"] as const) {
      const pasted = addPaste("chat", chat.raw, SEAT, pasteAs);
      expect(pasted.sends.map(({ body }) => body).join("\n") === sent).toBe(
        true,
      );
    }
    const handover = addPaste(
      "handover",
      sample("old-handover.sample.md").raw,
      SEAT,
      "text",
    );
    expect(handover.sends.map(({ request }) => request.kind)).toEqual(["text"]);
    expect(handover.sends.flatMap(({ body }) => inBody(body))).toEqual([]);
  });

  // 「トークとして読む」: two people saying one thing each read as a doc first; read as a chat, neither name is sent.
  it("sends no speaker's name once a doc with 名前: 本文 lines is read as a chat", () => {
    const raw =
      "加藤一樹: 部費は5/10までにお願いします\n高橋美咲: 振込先を教えてください";
    const asDoc = addPaste("lines", raw, SEAT, "text");
    expect(asDoc.sends.map(({ request }) => request.kind)).toEqual(["text"]);
    const asChat = addPaste("lines", raw, SEAT, "text", { asChat: true });
    expect(asChat.sends.length).toBeGreaterThan(0);
    for (const { request, body } of asChat.sends) {
      expect(request.kind).toBe("chat");
      expect(body).not.toContain("加藤");
      expect(body).not.toContain("高橋");
    }
    expect(asChat.sends.flatMap(({ body }) => inBody(body))).toEqual([]);
  });
});

// tests/browser-send.ts copies these lines of the slip, the preview and the client, down to the two that decide what
// is sent: the preview's Send hands over the redacted text and its counts, and the slip puts them in the request. When
// one changes, make the copy follow, then update the line here.
const COPIED: Record<string, string[]> = {
  "components/AddSlip.tsx": [
    'fileType === "txt" ? await extractTextFile(file) : await extractFile(file);',
    'const next = readSource(text, "text");',
    'if (!next) throw new IngestError("no_text");',
    'if (next.kind !== "text") return setProblem(next.kind);',
    'if (text.length > MAX_TEXT_CHARS) throw new IngestError("too_large");',
    "const next = readSource(draft, pasteAs);",
    'show({ kind: "text", text: next.text }, "text");',
    'setAsChat({ kind: "chat", platform: "paste", messages: next.messages });',
    'if (next.messages && (fileType === "txt" || fileType === "md"))',
    'show(asChat, source.kind === "file" ? "file" : "text");',
    "await api.import(importRequest(slug, source, text, redaction))",
    'return { seat, kind: "text", text, redaction };',
    'return { seat, kind: "file", fileType: source.fileType, text, redaction };',
    'return { seat, kind: "chat", platform: source.platform, text, redaction };',
  ],
  "components/RedactionPreview.tsx": [
    't("member", { letter: memberLetter(index) })',
    "return { ...redactText(source.text, { hide }), chat: undefined };",
    "const run = redactChat(source.messages, { roles, hide, keepAll });",
    "(keepAll || sent.chat.kept < sent.chat.total)",
    "const empty = !sent.text.trim();",
    "const tooLong = sent.text.length > MAX_TEXT_CHARS;",
    "onClick={() => onSend(sent.text, sent.counts)}",
  ],
  "lib/api.ts": [
    "body: body === undefined ? undefined : JSON.stringify(body),",
    'import: (request) => call(ImportResponse, "/api/import", request),',
  ],
};

// Compared without spaces, line breaks or trailing commas, so a reformat doesn't trip it but a changed word does.
const squash = (code: string) =>
  code.replace(/\s+/g, "").replace(/,(?=[)}\]]|$)/g, "");

describe("tests/browser-send.ts follows the browser's code", () => {
  it.each(Object.entries(COPIED))("still matches %s", (file, lines) => {
    const code = squash(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    );
    expect(lines.filter((line) => !code.includes(squash(line)))).toEqual([]);
  });
});
