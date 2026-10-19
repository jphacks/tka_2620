"use client";
// 引き継ぎ書 on 聞く (docs/DESIGN.md → GuideSheet). The guide's cover, one slip that says what it is, opens the whole guide
// over the page as a reading sheet, so 聞く itself never moves (Nico's call: the inline dropdown made the page long and
// shifted it).
// - Full height on a phone; a 560px panel on the right from 720px.
// - A native <dialog> (showModal): the page behind is inert, Esc closes it, and focus comes back to the cover.
// - The sheet has its own address (#guide): the phone's back button closes it, and a link with #guide opens it.
// - Its header keeps 保存 (print or PDF) and 閉じる in reach while reading.
// - The guide loads only once the sheet is opened.
import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Guide } from "@/components/HandoverGuide";
import type { Api } from "@/lib/contracts";

const HASH = "#guide";

export function GuideSheet({
  slug,
  api,
  seatName,
}: {
  slug: string;
  api: Api;
  /** The seat's name, for the guide's title (「会計の引き継ぎ書」). */
  seatName: string;
}) {
  const t = useTranslations("guide");
  const sheet = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  // Whether opening added the #guide entry to the history: a tap did, arriving on a #guide link didn't.
  const pushed = useRef(false);
  const sheetId = useId();
  const titleId = useId();
  const leadId = useId();
  const actId = useId();
  const headId = useId();
  const title = t("title", { seat: seatName });

  // The sheet's content mounts first, then the dialog opens as a modal, with focus on its title for a screen reader.
  useEffect(() => {
    const node = sheet.current;
    if (!open || !node || node.open) return;
    node.showModal();
    heading.current?.focus();
  }, [open]);

  const show = useCallback((push: boolean) => {
    if (push && window.location.hash !== HASH) {
      window.history.pushState(window.history.state, "", HASH);
      pushed.current = true;
    }
    setOpen(true);
  }, []);

  // Arriving on …#guide opens the sheet; the back button, which takes the #guide entry away, closes it.
  useEffect(() => {
    if (window.location.hash === HASH) show(false);
    const back = () => {
      if (window.location.hash !== HASH && sheet.current?.open) {
        sheet.current.close();
      }
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [show]);

  // Closed by 閉じる, Esc, the backdrop or back: the #guide entry goes too, so back afterwards leaves 聞く as usual. While
  // printing, the sheet closes and opens again at once (below); by the time that close event arrives it is open, so
  // it isn't a close.
  function closed() {
    if (sheet.current?.open) return;
    setOpen(false);
    if (window.location.hash === HASH) {
      if (pushed.current) window.history.back();
      else {
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
      }
    }
    pushed.current = false;
  }

  // Printing while the sheet is open (保存, or ⌘P / Ctrl+P): the guide alone goes on paper. A modal dialog sits in the
  // top layer, where printing can't run it across pages, so for the print it opens in the page instead, then goes back
  // to being modal.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = () => {
      const node = sheet.current;
      if (!node?.open) return;
      node.close();
      node.show();
      root.classList.add("dd-printing-guide");
    };
    const after = () => {
      if (!root.classList.contains("dd-printing-guide")) return;
      root.classList.remove("dd-printing-guide");
      sheet.current?.close();
      sheet.current?.showModal();
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [open]);
  // 保存: print the guide alone, or save it as a PDF (the print dialog offers both).
  const print = useCallback(() => window.print(), []);
  // Where a press began and ended: a drag between the sheet and the backdrop (selecting a note's text, either way) isn't
  // a tap on the backdrop.
  const pressedOn = useRef<EventTarget | null>(null);
  const releasedOn = useRef<EventTarget | null>(null);

  return (
    <>
      {/* The cover: the guide as a slip that says what it is; the whole slip is the button */}
      <button
        type="button"
        className="dd-slip dd-guide-cover"
        aria-haspopup="dialog"
        aria-controls={sheetId}
        aria-labelledby={`${titleId} ${actId}`}
        aria-describedby={leadId}
        onClick={() => show(true)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 6.5C10.5 5.3 8.3 4.8 4 5v13c4.3-.2 6.5.3 8 1.5 1.5-1.2 3.7-1.7 8-1.5V5c-4.3-.2-6.5.3-8 1.5Z" />
          <path d="M12 6.5v13" />
        </svg>
        <span className="dd-guide-cover-text">
          <span id={titleId} className="dd-guide-cover-title">
            {title}
          </span>
          <span id={leadId} className="dd-cap dd-phrase">
            {t("coverLead")}
          </span>
        </span>
        <span className="dd-guide-cover-act">
          <span id={actId}>{t("read")}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      </button>
      {/* A tap on the backdrop (pressed and released there) closes the sheet like Esc does (the dialog answers Esc itself) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the native dialog closes on Esc; the click is only the backdrop */}
      <dialog
        id={sheetId}
        ref={sheet}
        className="dd-sheet"
        aria-labelledby={headId}
        onClose={closed}
        onPointerDown={(event) => {
          pressedOn.current = event.target;
        }}
        onPointerUp={(event) => {
          releasedOn.current = event.target;
        }}
        onClick={(event) => {
          const backdrop = sheet.current;
          if (
            event.target === backdrop &&
            pressedOn.current === backdrop &&
            releasedOn.current === backdrop
          ) {
            backdrop.close();
          }
        }}
      >
        {open && (
          <>
            <header className="dd-sheet-head">
              <h2
                ref={heading}
                id={headId}
                tabIndex={-1}
                className="dd-sheet-title"
              >
                {title}
              </h2>
              <button
                type="button"
                className="dd-btn dd-sheet-save"
                aria-label={t("print")}
                onClick={print}
              >
                <Download size={20} aria-hidden="true" />
                {t("saveShort")}
              </button>
              <button
                type="button"
                className="dd-sheet-close"
                aria-label={t("close")}
                onClick={() => sheet.current?.close()}
              >
                <X size={22} aria-hidden="true" />
              </button>
            </header>
            <div className="dd-sheet-body">
              <Guide slug={slug} api={api} inline onPrint={print} />
              {/* The end of a long guide: close it from here too, and land back on the cover */}
              <button
                type="button"
                className="dd-link dd-guide-close dd-noprint"
                onClick={() => sheet.current?.close()}
              >
                {t("close")}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
