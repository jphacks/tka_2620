"use client";
// A drafted note on the import review (docs/DESIGN.md → NoteEntry; docs/SPEC.md → adding knowledge, step 10): kind mark
// and title in bold UI text, the date in figures with the highlighter on a deadline, the body in Klee One on the ruled
// grid, the provenance chip and the scope it will have, and the date stamp it will carry at the bottom right, signed
// with the viewer's own byline. 「直す」 opens the title, body and date as fields; 「外す」 folds the entry to one line
// and leaves it out of 公開する. The 自分のメモ entry is NoteEntry.tsx.
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { DateStamp } from "@/components/DateStamp";
import { DuplicateHint } from "@/components/DuplicateHint";
import { kindMarks } from "@/components/marks";
import type { Entry, Problem } from "@/components/review";
import {
  type ImportedCard,
  type ImportResponse,
  IsoDate,
  type SeatView,
} from "@/lib/contracts";

// A deadline as the page's language writes a full date: 2025年2月28日, February 28, 2025.
function dateLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function DraftEntry({
  entry,
  seat,
  termLabel,
  provenance,
  similar,
  problem,
  published = false,
  onChange,
}: {
  entry: Entry;
  /** The seat's words (scope, byline); without the seat view the entry has no scope line and no stamp. */
  seat?: SeatView["seat"];
  /** The viewer's latest term at the seat, which publishing signs with; no stamp without it. */
  termLabel?: string;
  /** The provenance chip, worded; a card's own wins. */
  provenance: string;
  similar?: ImportResponse["duplicates"][number];
  problem?: Problem;
  /** Published: read-only, and the stamp lands. */
  published?: boolean;
  onChange: (next: Entry) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  // The control to focus after the person's own step (opening, closing, leaving out, putting back), never on mount.
  const focusNext = useRef<"title" | "toggle" | "restore" | undefined>(
    undefined,
  );
  const { card } = entry;

  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = undefined;
    if (next === "title") titleField.current?.focus();
    if (next === "toggle") toggle.current?.focus();
    if (next === "restore") restore.current?.focus();
  });

  const update = (fields: Partial<ImportedCard>) =>
    onChange({ ...entry, card: { ...card, ...fields } });
  const titleId = `${ids}-title`;
  const fieldsId = `${ids}-fields`;
  const problemId = `${ids}-problem`;

  if (entry.dropped) {
    return (
      <article className="dd-slip dd-entry" aria-labelledby={titleId}>
        <p
          id={titleId}
          className="dd-phrase"
          style={{ margin: 0, color: "var(--ink-2)" }}
        >
          {t("import.dropped", { title: card.title.trim() })}
        </p>
        <button
          ref={restore}
          type="button"
          className="dd-link"
          style={{ justifySelf: "start", minHeight: "44px" }}
          onClick={() => {
            focusNext.current = "toggle";
            onChange({ ...entry, dropped: false });
          }}
        >
          {t("import.restore")}
        </button>
      </article>
    );
  }

  const date =
    card.kind === "deadline" && IsoDate.safeParse(card.deadline_date).success
      ? card.deadline_date
      : undefined;
  const scope =
    seat &&
    t(`seatTypes.${seat.seatType}.scope.${card.suggested_scope}`, {
      seat: seat.name,
      group: seat.group,
      institution: seat.institution,
    });
  const term =
    seat && termLabel
      ? t(`seatTypes.${seat.seatType}.term`, { term: termLabel })
      : undefined;

  return (
    <article
      className="dd-slip dd-entry"
      aria-labelledby={editing ? undefined : titleId}
      aria-label={editing ? t(`kinds.${card.kind}`) : undefined}
    >
      <p className="dd-kind" style={{ margin: 0 }}>
        <span className="dd-kind-mark" aria-hidden="true">
          {kindMarks[card.kind]}
        </span>
        {t(`kinds.${card.kind}`)}
      </p>
      {editing ? (
        <div id={fieldsId} className="dd-col" style={{ gap: "var(--s-2)" }}>
          <label className="dd-label" htmlFor={`${ids}-title-field`}>
            {t("import.fieldTitle")}
          </label>
          <input
            ref={titleField}
            id={`${ids}-title-field`}
            className="dd-input"
            lang={card.lang}
            value={card.title}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={problem ? problemId : undefined}
            onChange={(event) => update({ title: event.target.value })}
          />
          {card.kind === "deadline" && (
            <>
              <label className="dd-label" htmlFor={`${ids}-date-field`}>
                {t("import.fieldDate")}
              </label>
              <input
                id={`${ids}-date-field`}
                type="date"
                className="dd-input dd-fig"
                value={card.deadline_date ?? ""}
                aria-describedby={problem ? problemId : undefined}
                onChange={(event) =>
                  update({ deadline_date: event.target.value || undefined })
                }
              />
            </>
          )}
          <label className="dd-label" htmlFor={`${ids}-body-field`}>
            {t("import.fieldBody")}
          </label>
          <textarea
            id={`${ids}-body-field`}
            className="dd-voice-text"
            rows={4}
            lang={card.lang}
            value={card.body}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={problem ? problemId : undefined}
            onChange={(event) => update({ body: event.target.value })}
          />
        </div>
      ) : (
        <>
          <h3 id={titleId} className="dd-h dd-phrase" lang={card.lang}>
            {card.title}
          </h3>
          {date && (
            <p className="dd-fig" style={{ margin: 0 }}>
              <mark className="dd-marker">{dateLabel(date, locale)}</mark>
            </p>
          )}
          <div className="dd-ruled" lang={card.lang}>
            <p className="dd-phrase">{card.body}</p>
          </div>
        </>
      )}
      <div className="dd-entry-foot">
        <div className="dd-col" style={{ gap: 0, minWidth: 0 }}>
          <p className="dd-cap dd-phrase" style={{ margin: 0 }}>
            {card.provenance ?? provenance}
          </p>
          {scope && (
            <p className="dd-cap" style={{ margin: 0 }}>
              {scope}
            </p>
          )}
        </div>
        {seat && termLabel && (
          <DateStamp seat={seat} termLabel={termLabel} land={published} />
        )}
      </div>
      {similar && (
        <DuplicateHint
          similar={similar}
          term={term}
          choice={entry.choice}
          disabled={published}
          onChoose={(choice) => onChange({ ...entry, choice })}
        />
      )}
      {problem && !published && (
        <p id={problemId} className="dd-phrase" style={{ margin: 0 }}>
          {t(`import.problem.${problem}`)}
        </p>
      )}
      {!published && (
        <div className="dd-row" style={{ gap: "var(--s-3)" }}>
          <button
            ref={toggle}
            type="button"
            className="dd-btn"
            aria-expanded={editing}
            aria-controls={editing ? fieldsId : undefined}
            aria-describedby={editing ? undefined : titleId}
            onClick={() => {
              focusNext.current = editing ? "toggle" : "title";
              setEditing(!editing);
            }}
          >
            {t(editing ? "import.editDone" : "import.edit")}
          </button>
          <button
            type="button"
            className="dd-link"
            style={{ minHeight: "44px" }}
            aria-describedby={editing ? undefined : titleId}
            onClick={() => {
              focusNext.current = "restore";
              setEditing(false);
              onChange({ ...entry, dropped: true });
            }}
          >
            {t("import.drop")}
          </button>
        </div>
      )}
    </article>
  );
}
