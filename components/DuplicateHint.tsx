"use client";
// docs/DESIGN.md → DuplicateHint: a red-pen note on a drafted entry when the seat already has a similar live note
// (docs/SPEC.md → adding knowledge, step 9). The person chooses: 「更新する」 publishes the card as the note's update (it
// supersedes the old one, which leaves answers and stays as history), 「別のメモとして残す」 keeps both. Choosing update
// draws the correction mark: the old title crossed with the red double line and 「2026年度に更新」.
import { useTranslations } from "next-intl";
import type { ImportResponse } from "@/lib/contracts";

export function DuplicateHint({
  similar,
  term,
  widened,
  choice,
  onChoose,
  disabled = false,
}: {
  similar: ImportResponse["duplicates"][number];
  /** The viewer's term as the label pack words it (「2026年度」), which an update is signed with. */
  term?: string;
  /** The replaced note's scope, worded, when an update takes it over because it's wider than the draft's suggestion. */
  widened?: string;
  choice?: "update" | "keep";
  onChoose: (choice: "update" | "keep") => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="dd-margin dd-col" style={{ gap: "var(--s-2)" }}>
      <p className="dd-hint dd-phrase">
        {t("import.duplicate", {
          title: similar.title,
          byline: similar.byline,
        })}
      </p>
      {choice === "update" && (
        <p className="dd-phrase" style={{ margin: 0 }}>
          <span className="dd-double">{similar.title}</span>{" "}
          {term && (
            <span className="dd-margin-note">
              {t("import.superseded", { term })}
            </span>
          )}
        </p>
      )}
      {/* An update keeps the replaced note's readers, so the person sees that before publishing. */}
      {choice === "update" && widened && (
        <p className="dd-phrase" style={{ margin: 0 }}>
          {t("import.updateScope", { scope: widened })}
        </p>
      )}
      {choice === "keep" && (
        <p className="dd-cap" style={{ margin: 0 }}>
          {t("import.keptBoth")}
        </p>
      )}
      {!disabled && (
        <div className="dd-row" style={{ gap: "var(--s-2)" }}>
          <button
            type="button"
            className="dd-btn"
            aria-pressed={choice === "update"}
            onClick={() => onChoose("update")}
          >
            {t("import.update")}
          </button>
          <button
            type="button"
            className="dd-btn"
            aria-pressed={choice === "keep"}
            onClick={() => onChoose("keep")}
          >
            {t("import.keepBoth")}
          </button>
        </div>
      )}
    </div>
  );
}
