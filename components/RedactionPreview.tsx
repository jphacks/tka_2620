"use client";

import { useTranslations } from "next-intl";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  blackoutSegments,
  hiddenKinds,
  hideWords,
  memberLetter,
  type Source,
} from "@/components/redaction";
import type { RedactionCounts } from "@/lib/contracts";
import { questionLang } from "@/lib/engine/lang";
import { MAX_TEXT_CHARS } from "@/lib/ingest/types";
import { speakers } from "@/lib/redact/parse";
import { redactChat, redactText } from "@/lib/redact/redact";

// RedactionPreview (docs/SPEC.md → adding knowledge, steps 3–5; docs/DESIGN.md): a chat first gives each speaker a
// role, the only place a name shows. Then the preview is exactly the text the request sends, every hidden value a black
// bar, with the counts in green, a field for more words to hide, and the consent the person ticks before sending.
// The parent keys it by source, so a new file or paste starts over with the default roles and no consent.
export function RedactionPreview({
  source,
  roleChoices,
  sending,
  onSend,
  onAsDoc,
  onAsChat,
}: {
  source: Source;
  /** The seat's label-pack roles (部長, 会計 …), offered after each speaker's default メンバーA/B/C. */
  roleChoices: string[];
  sending: boolean;
  onSend: (text: string, redaction: RedactionCounts) => void;
  /** A chat guessed from what came as a doc: read it as the doc instead (its names then show, to be hidden by hand). */
  onAsDoc?: () => void;
  /** A pasted doc with lines like 名前: 本文: read them as a chat instead, so each speaker gets a role. */
  onAsChat?: () => void;
}) {
  const t = useTranslations("import");
  const ids = useId();
  const people = useMemo(
    () => (source.kind === "chat" ? speakers(source.messages) : []),
    [source],
  );
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        people.map(({ name }, index) => [
          name,
          t("member", { letter: memberLetter(index) }),
        ]),
      ),
    [people, t],
  );
  const [step, setStep] = useState<"roles" | "preview">(
    people.length > 0 ? "roles" : "preview",
  );
  const [roles, setRoles] = useState<Record<string, string>>(defaults);
  const [typed, setTyped] = useState("");
  const [hide, setHide] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const countsLine = useRef<HTMLParagraphElement>(null);
  const speakersHeading = useRef<HTMLHeadingElement>(null);

  // What the request sends. A chat keeps the last 12 months and what looks like handover knowledge, within the request's
  // cap (lib/redact → redactChat, docs/SPEC.md → F5 step 2); 「全部使う」 keeps every message instead. Its counts are
  // what the sent messages hid.
  const [keepAll, setKeepAll] = useState(false);
  const sent = useMemo(() => {
    if (step === "roles") return undefined;
    if (source.kind !== "chat") {
      return { ...redactText(source.text, { hide }), chat: undefined };
    }
    const run = redactChat(source.messages, { roles, hide, keepAll });
    return {
      text: run.text,
      counts: run.counts,
      chat: { kept: run.kept, total: run.total },
    };
  }, [step, source, roles, hide, keepAll]);

  // The preview body changes only with the text, not with each keystroke in the field below it (a long chat is
  // thousands of nodes). Its lang follows the text, as notes' and questions' do (docs/DESIGN.md → Japanese settings).
  const preview = useMemo(
    () =>
      sent && {
        lang: questionLang(sent.text),
        body: blackoutSegments(sent.text).map((segment) =>
          "bar" in segment ? (
            <span key={segment.at} className="dd-blackout">
              {segment.host
                ? t("bars.urlHost", { host: segment.host })
                : t(`bars.${segment.bar}`)}
            </span>
          ) : (
            <Fragment key={segment.at}>{segment.text}</Fragment>
          ),
        ),
      },
    [sent, t],
  );

  // Each step starts with its first thing to read: the speakers, then the counts line.
  useEffect(() => {
    (step === "preview" ? countsLine : speakersHeading).current?.focus();
  }, [step]);

  // Words are applied on Enter or when the field is left, not per keystroke: half-typed kana (やま) would be hidden.
  // Until then the request can't be sent, so a typed name never goes out unhidden by mistake.
  const pending = hideWords(typed).join("\n") !== hide.join("\n");
  function applyHide() {
    if (pending) setHide(hideWords(typed));
  }

  if (!sent) {
    return (
      <section
        className="dd-col"
        style={{ gap: "var(--s-4)" }}
        aria-labelledby={`${ids}-speakers`}
      >
        <div className="dd-col" style={{ gap: "var(--s-1)" }}>
          <h3
            ref={speakersHeading}
            id={`${ids}-speakers`}
            tabIndex={-1}
            className="dd-h"
          >
            {t("speakers")}
          </h3>
          <p className="dd-cap" style={{ margin: 0 }}>
            {t("rolesHint")}
          </p>
        </div>
        <ul className="dd-roles">
          {people.map(({ name, count }) => (
            <li key={name}>
              <label>
                <span>
                  <b className="dd-roles-name">{name}</b>{" "}
                  <span className="dd-cap dd-fig">
                    {t("messageCount", { count })}
                  </span>
                </span>
                <select
                  className="dd-select"
                  value={roles[name]}
                  onChange={(event) => {
                    const role = event.target.value;
                    setRoles((current) => ({ ...current, [name]: role }));
                  }}
                >
                  {[
                    defaults[name],
                    ...roleChoices.filter((role) => role !== defaults[name]),
                  ].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="dd-btn dd-btn-primary"
          style={{ justifySelf: "start" }}
          onClick={() => setStep("preview")}
        >
          {t("rolesDone")}
        </button>
        {onAsDoc && (
          <button
            type="button"
            className="dd-link"
            style={{ justifySelf: "start", minHeight: "44px" }}
            onClick={onAsDoc}
          >
            {t("asDoc")}
          </button>
        )}
      </section>
    );
  }

  const kinds = hiddenKinds(sent.counts);
  const separator = t("listSeparator");
  const empty = !sent.text.trim(); // a chat where nothing looked like handover knowledge
  const tooLong = sent.text.length > MAX_TEXT_CHARS;
  const shownRoles = [...new Set(people.map(({ name }) => roles[name]))];
  // lib/redact hides a one-character word only before an honorific (翔くん, not 翔に聞く): say which words are still
  // there, and wait to send until the person types them with more around them or takes them out of the field.
  const missed = pending ? [] : hide.filter((word) => sent.text.includes(word));
  return (
    <section className="dd-col" style={{ gap: "var(--s-4)" }}>
      <p
        ref={countsLine}
        tabIndex={-1}
        aria-live="polite"
        className="dd-phrase"
        style={{ margin: 0, fontWeight: 700 }}
      >
        {kinds.length === 0
          ? t("hiddenNone")
          : t.rich("hiddenList", {
              list: () =>
                kinds.map(({ kind, count }, index) => (
                  <Fragment key={kind}>
                    {index > 0 && separator}
                    {t.rich(`kinds.${kind}`, {
                      count,
                      fig: (chunks) => (
                        <span className="dd-safe">{chunks}</span>
                      ),
                    })}
                  </Fragment>
                )),
            })}
      </p>
      {onAsChat && (
        <p className="dd-phrase" style={{ margin: 0 }}>
          <span className="dd-cap">{t("asChatHint")}</span>{" "}
          <button
            type="button"
            className="dd-link"
            style={{ minHeight: "44px" }}
            onClick={onAsChat}
          >
            {t("asChat")}
          </button>
        </p>
      )}
      {people.length > 0 && (
        <p style={{ margin: 0 }}>
          <span className="dd-cap">{t("speakers")}</span>{" "}
          {shownRoles.map((role, index) => (
            // A line may break between roles, never inside one (メンバー / C).
            <Fragment key={role}>
              {index > 0 && separator}
              <span style={{ whiteSpace: "nowrap" }}>{role}</span>
            </Fragment>
          ))}{" "}
          <button
            type="button"
            className="dd-link"
            style={{ minHeight: "44px" }}
            onClick={() => setStep("roles")}
          >
            {t("changeRoles")}
          </button>
        </p>
      )}
      {sent.chat && (
        <p className="dd-phrase" style={{ margin: 0 }}>
          {sent.chat.kept === 0
            ? t("noneKept")
            : t("used", { kept: sent.chat.kept, total: sent.chat.total })}{" "}
          {(keepAll || sent.chat.kept < sent.chat.total) && (
            <button
              type="button"
              className="dd-link"
              style={{ minHeight: "44px" }}
              onClick={() => setKeepAll(!keepAll)}
            >
              {t(keepAll ? "useKept" : "useAll")}
            </button>
          )}
        </p>
      )}
      <div className="dd-col" style={{ gap: "var(--s-1)" }}>
        <label className="dd-label" htmlFor={`${ids}-hide`}>
          {t("hideMore")}
        </label>
        <input
          id={`${ids}-hide`}
          className="dd-input"
          value={typed}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="done"
          aria-describedby={`${ids}-hide-hint`}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={applyHide}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            applyHide();
          }}
        />
        <p id={`${ids}-hide-hint`} className="dd-cap" style={{ margin: 0 }}>
          {t(pending ? "hidePending" : "hideMoreHint")}
        </p>
        {missed.length > 0 && (
          <p className="dd-phrase" style={{ margin: 0 }}>
            {t("notHidden", { words: missed.join(separator) })}
          </p>
        )}
      </div>
      <div className="dd-col" style={{ gap: "var(--s-1)" }}>
        <h3 id={`${ids}-preview`} className="dd-label" style={{ margin: 0 }}>
          {t("preview")}
        </h3>
        {/* Exactly the request's text: a black bar stands for each placeholder, with its type inside. Focusable, so
            the box scrolls by keyboard in Safari too. */}
        <section
          className="dd-preview"
          aria-labelledby={`${ids}-preview`}
          lang={preview?.lang}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
          tabIndex={0}
        >
          {preview?.body}
        </section>
      </div>
      <p className="dd-cap" style={{ margin: 0 }}>
        {t(source.kind === "file" ? "notStored" : "staysHere")}
      </p>
      {tooLong && (
        <p className="dd-cap" style={{ margin: 0 }}>
          {t("tooLong")}
        </p>
      )}
      <label className="dd-check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>{t(source.kind === "chat" ? "consent" : "consentFile")}</span>
      </label>
      <button
        type="button"
        className="dd-btn dd-btn-primary"
        style={{ justifySelf: "start" }}
        disabled={
          !consent ||
          sending ||
          empty ||
          tooLong ||
          pending ||
          missed.length > 0
        }
        onClick={() => onSend(sent.text, sent.counts)}
      >
        {sending ? t("sending") : t("sendRedacted")}
      </button>
    </section>
  );
}
