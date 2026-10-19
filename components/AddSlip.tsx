"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dropped } from "@/components/AddPanel";
import { FileDrop } from "@/components/FileDrop";
import { ImportReview } from "@/components/ImportReview";
import { RedactionPreview } from "@/components/RedactionPreview";
import { readSource, type Source, splitRoles } from "@/components/redaction";
import {
  type Provenance,
  provenanceOf,
  todayInJapan,
} from "@/components/review";
import {
  type Api,
  ApiError,
  type ImportRequest,
  type ImportResponse,
  type RedactionCounts,
  type SeatView,
} from "@/lib/contracts";
import { extractFile, fileTypeOf } from "@/lib/ingest/extract";
import { extractTextFile } from "@/lib/ingest/text";
import { type FileType, IngestError, MAX_TEXT_CHARS } from "@/lib/ingest/types";
import { createMockApi } from "@/lib/mocks";

// The 「＋ 追加」 slip (docs/SPEC.md → adding knowledge, steps 1–5; docs/DESIGN.md → AddPanel): pasted text, a file or a
// chat becomes text on this device, RedactionPreview hides names, contact details and secrets, and only the text the
// person saw and agreed to goes to POST /api/import. The file, the raw text and the chat's names live only in this
// component's state and go with 「やり直す」, 「閉じる」 or a sent request. Nothing here is logged. What comes back is
// reviewed in ImportReview (steps 8–10): the missing list, then the drafted notes to publish.

type Tab = "text" | "file" | "chat";
const TABS = [
  { tab: "text", label: "tabDoc" },
  { tab: "file", label: "tabFile" },
  { tab: "chat", label: "tabChat" },
] as const;

// What the picker offers; iOS greys out files whose type isn't listed.
const FILE_ACCEPT =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
const CHAT_ACCEPT = ".txt,text/plain";

type Problem =
  | "tooLarge"
  | "scanned"
  | "unreadable"
  | "unsupported"
  | "notChat"
  | "noSpeakers";

// Problems that pasting the text by hand gets around: the notice offers 「貼り付けに切り替える」. Not for a chat with
// nobody speaking: as a doc its names would stay, so the person goes there knowingly, by the notice's words.
const PASTE_INSTEAD: ReadonlySet<Problem> = new Set([
  "scanned",
  "unreadable",
  "notChat",
]);

function problemOf(error: unknown, fileType: FileType | undefined): Problem {
  if (!(error instanceof IngestError)) return "unreadable";
  switch (error.code) {
    case "too_large":
    case "too_many_pages":
      return "tooLarge";
    case "no_text": // a PDF without a text layer gets the paste hint
      return fileType === "pdf" ? "scanned" : "unreadable";
    case "unsupported":
      return "unsupported";
    default:
      return "unreadable";
  }
}

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

export function AddSlip({
  slug,
  api: given,
  dragging,
  dropped,
  onClose,
  onImported,
}: {
  slug: string;
  /** The signed-in client (SeatSignIn); mocks as a25 when left out, like the inbox above it. */
  api?: Api;
  /** A file is being dragged over the page (AddPanel catches the drop anywhere). */
  dragging: boolean;
  dropped?: Dropped;
  onClose: () => void;
  /** What POST /api/import drafted, for a caller that wants it; the review itself is shown here (ImportReview). */
  onImported?: (response: ImportResponse) => void;
}) {
  const t = useTranslations();
  const ids = useId();
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const notice = useRef<HTMLParagraphElement>(null);
  // Opened (a tap on 「＋ 追加」 or a dropped file), the slip's heading takes focus, so the keyboard and a screen reader
  // land in it instead of staying on the button above.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const summary = useRef<HTMLOutputElement>(null);
  // Each new input, 「やり直す」 and tab change starts a new round; a slow read or send from an older one is dropped.
  const round = useRef(0);
  const handledDrop = useRef(0);
  const [tab, setTab] = useState<Tab>("text");
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<Source>();
  const [sourceId, setSourceId] = useState(0);
  // The doc a guessed chat came as, for 「トークではなく資料として読む」.
  const [asDoc, setAsDoc] = useState<Source>();
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<Problem>();
  const [roleChoices, setRoleChoices] = useState<string[]>([]);
  const [seatView, setSeatView] = useState<SeatView>();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<"unredacted" | "failed">();
  const [result, setResult] = useState<ImportResponse>();
  // Where the reviewed notes came from, read before the source goes: the provenance chip, never a name.
  const [provenance, setProvenance] = useState<Provenance>();

  // The seat's label pack offers the roles (部長, 会計 …); without the seat view only メンバーA/B/C remain. The review
  // words the scope and signs the stamp from it too.
  useEffect(() => {
    let alive = true;
    api.seat(slug).then(
      (view) => {
        if (alive) {
          setSeatView(view);
          setRoleChoices(
            splitRoles(t(`seatTypes.${view.seat.seatType}.roles`)),
          );
        }
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, slug, t]);

  // A notice may appear below the fold of a phone: bring it into view.
  useEffect(() => {
    if (problem) notice.current?.scrollIntoView({ block: "nearest" });
  }, [problem]);

  useEffect(() => {
    if (result) summary.current?.focus();
  }, [result]);

  // A new round: whatever was shown or is still being read or sent is dropped.
  const begin = useCallback(() => {
    setSource(undefined);
    setAsDoc(undefined);
    setProblem(undefined);
    setFailed(undefined);
    setResult(undefined);
    setReading(false);
    return ++round.current;
  }, []);

  const show = useCallback((next: Source, on: Tab) => {
    setTab(on);
    setSource(next);
    setSourceId((id) => id + 1); // a new source starts the preview over
  }, []);

  // Every file becomes text first, then goes through the same router as pasted text: a LINE export saved as .md,
  // .docx or .pdf is a chat too. A .txt is read without the 100,000-character cap, so a long LINE export is
  // recognised before fitChat cuts it; as plain text it gets the cap here.
  const readFile = useCallback(
    async (file: File) => {
      const mine = begin();
      setDraft("");
      setReading(true);
      const fileType = fileTypeOf(file);
      try {
        if (!fileType) throw new IngestError("unsupported");
        const { text, pages } =
          fileType === "txt"
            ? await extractTextFile(file)
            : await extractFile(file);
        if (mine !== round.current) return;
        const next = readSource(
          text,
          fileType === "txt" && tab === "chat" ? "chat" : "text",
        );
        if (!next) throw new IngestError("no_text");
        const asFile: Source = {
          kind: "file",
          fileType,
          text,
          name: file.name,
          pages,
        };
        if (next.kind === "chat") {
          if (next.doc !== undefined) setAsDoc(asFile);
          return show(next, "chat");
        }
        if (next.kind !== "text") return setProblem(next.kind);
        if (text.length > MAX_TEXT_CHARS) throw new IngestError("too_large");
        show(asFile, "file");
      } catch (error) {
        if (mine === round.current) setProblem(problemOf(error, fileType));
      } finally {
        if (mine === round.current) setReading(false);
      }
    },
    [tab, begin, show],
  );

  // A file dropped on the page (AddPanel), read once.
  useEffect(() => {
    if (!dropped || dropped.id === handledDrop.current) return;
    handledDrop.current = dropped.id;
    readFile(dropped.file);
  }, [dropped, readFile]);

  // Switching tabs keeps the typed draft (both text tabs share it); only what was read or shown goes.
  function choose(next: Tab) {
    if (next === tab) return;
    begin();
    setTab(next);
  }

  // Back to an empty tab: the draft, the file's text and the chat are dropped.
  function startOver() {
    begin();
    setDraft("");
    // After the render: from the review, the tabs come back only then.
    const at = TABS.findIndex((item) => item.tab === tab);
    requestAnimationFrame(() => tabs.current[at]?.focus());
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((item) => item.tab === tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (at + TABS.length - 1) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    choose(TABS[to].tab);
    tabs.current[to]?.focus();
  }

  function check() {
    begin();
    const next = readSource(draft, tab === "chat" ? "chat" : "text");
    if (!next) return;
    if (next.kind === "chat") {
      if (next.doc !== undefined) setAsDoc({ kind: "text", text: next.doc });
      show(next, "chat");
    } else if (next.kind === "text") {
      show(next, "text");
    } else {
      setProblem(next.kind);
    }
  }

  async function send(text: string, redaction: RedactionCounts) {
    if (!source) return;
    const mine = round.current;
    const from = provenanceOf(source, todayInJapan());
    setSending(true);
    setFailed(undefined);
    try {
      const response = await api.import(
        importRequest(slug, source, text, redaction),
      );
      if (mine !== round.current) return;
      begin();
      setDraft("");
      setProvenance(from);
      setResult(response);
      onImported?.(response);
    } catch (error) {
      if (mine !== round.current) return;
      // The server's safety net found a phone number or an email the browser didn't.
      const code = ApiError.safeParse(error).data?.error;
      setFailed(code === "unredacted" ? "unredacted" : "failed");
    } finally {
      setSending(false);
    }
  }

  const panelId = `${ids}-panel`;
  return (
    <div className="dd-slip">
      <div
        className="dd-row"
        style={{
          flexWrap: "nowrap",
          justifyContent: "space-between",
          alignItems: "start",
          padding: "var(--s-3) var(--s-4) var(--s-2)",
        }}
      >
        <h2
          ref={heading}
          tabIndex={-1}
          className="dd-h"
          style={{ flex: 1, minWidth: 0 }}
        >
          {t("import.title")}
        </h2>
        <button
          type="button"
          className="dd-link"
          style={{ flex: "none", minHeight: "44px" }}
          onClick={onClose}
        >
          {t("import.close")}
        </button>
      </div>
      {/* No tabs during the review: a tab would start over and drop drafts not yet published. */}
      {!result && (
        <div
          role="tablist"
          aria-label={t("import.title")}
          className="dd-itabs"
          onKeyDown={onTabKey}
        >
          {TABS.map((item, index) => (
            <button
              key={item.tab}
              ref={(button) => {
                tabs.current[index] = button;
              }}
              id={`${ids}-${item.tab}`}
              type="button"
              role="tab"
              aria-selected={item.tab === tab}
              aria-controls={panelId}
              tabIndex={item.tab === tab ? 0 : -1}
              className="dd-itab"
              onClick={() => choose(item.tab)}
            >
              {t(`import.${item.label}`)}
            </button>
          ))}
        </div>
      )}
      <div
        // The tab's panel, or during the review (no tabs) a region named like the slip.
        {...(result
          ? { role: "region", "aria-label": t("import.title") }
          : { role: "tabpanel", "aria-labelledby": `${ids}-${tab}` })}
        id={panelId}
        className="dd-col dd-pad"
        style={{ gap: "var(--s-4)" }}
      >
        {result ? (
          <>
            <output
              ref={summary}
              tabIndex={-1}
              className="dd-phrase"
              style={{ display: "block", fontWeight: 700 }}
            >
              {t("import.drafted", {
                cards: result.cards.length,
                missing: result.missing.length,
              })}
            </output>
            {provenance && (
              <ImportReview
                key={sourceId}
                slug={slug}
                view={seatView}
                response={result}
                provenance={provenance}
                api={api}
              />
            )}
            <button
              type="button"
              className="dd-link"
              style={{ justifySelf: "start", minHeight: "44px" }}
              onClick={startOver}
            >
              {t("import.another")}
            </button>
          </>
        ) : source ? (
          <>
            {/* A chat never shows its file name: LINE names a one-to-one export after the other person. */}
            {source.kind === "file" && (
              <p className="dd-phrase" style={{ margin: 0 }}>
                {source.pages === undefined
                  ? t("import.fileReadText", { name: source.name })
                  : t("import.fileRead", {
                      name: source.name,
                      pages: source.pages,
                    })}
              </p>
            )}
            <RedactionPreview
              key={sourceId}
              source={source}
              roleChoices={roleChoices}
              sending={sending}
              onSend={send}
              onAsDoc={
                asDoc &&
                (() => {
                  setAsDoc(undefined);
                  show(asDoc, asDoc.kind === "file" ? "file" : "text");
                })
              }
            />
            {failed && (
              <p role="alert" className="dd-phrase" style={{ margin: 0 }}>
                {t(`import.${failed}`)}
              </p>
            )}
            <button
              type="button"
              className="dd-link"
              style={{ justifySelf: "start", minHeight: "44px" }}
              onClick={startOver}
            >
              {t("import.again")}
            </button>
          </>
        ) : (
          <>
            {/* Calm, never red (docs/DESIGN.md): what happened, and what to do instead. */}
            {problem && (
              <div className="dd-col" style={{ gap: "var(--s-1)" }}>
                <p
                  ref={notice}
                  role="alert"
                  className="dd-phrase"
                  style={{ margin: 0 }}
                >
                  {t(`import.${problem}`)}
                </p>
                {tab !== "text" && PASTE_INSTEAD.has(problem) && (
                  <button
                    type="button"
                    className="dd-link"
                    style={{ justifySelf: "start", minHeight: "44px" }}
                    onClick={() => choose("text")}
                  >
                    {t("import.toPaste")}
                  </button>
                )}
              </div>
            )}
            {reading && (
              <output className="dd-cap" style={{ display: "block" }}>
                {t("import.reading")}
              </output>
            )}
            {tab !== "text" && (
              <FileDrop
                hint={t(tab === "chat" ? "import.dropChat" : "import.dropFile")}
                pickLabel={t("import.pickFile")}
                accept={tab === "chat" ? CHAT_ACCEPT : FILE_ACCEPT}
                over={dragging}
                onFile={readFile}
              />
            )}
            {tab !== "file" && (
              <div className="dd-col" style={{ gap: "var(--s-2)" }}>
                <label className="dd-label" htmlFor={`${ids}-draft`}>
                  {t(tab === "chat" ? "import.pasteChat" : "import.paste")}
                </label>
                {/* Raw text: no spell check (Chrome's enhanced one sends it to a server), no autofill memory. */}
                <textarea
                  id={`${ids}-draft`}
                  className="dd-input"
                  value={draft}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="dd-btn dd-btn-primary"
                  style={{ justifySelf: "start" }}
                  disabled={!draft.trim()}
                  onClick={check}
                >
                  {t("import.check")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
