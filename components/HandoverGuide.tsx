"use client";
// /s/[seat]/guide (docs/DESIGN.md → HandoverGuide): 引き継ぎ書, the handover nobody writes, put together from what the
// predecessors left. The deadlines coming up, every note the viewer may read grouped by kind, what isn't written yet
// (blank lines, never hidden), and the viewer's own questions with their answers, each stamp still opening its note.
// The filters (kind, who wrote it, order) shape the page and the export alike: print / PDF through the browser, or a
// Markdown file built here. Nothing is sent or stored by exporting; RLS already decided what the page received
// (GET /api/seats/[slug]/guide). People appear only as bylines (「2025年度 会計」), never by name. On mocks as a26; on real
// data as the account signed in on this device, or the login screen in place (components/SignInGate.tsx).
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AnswerEntry } from "@/components/AnswerEntry";
import { DateStamp } from "@/components/DateStamp";
import {
  ALL,
  bylinesOf,
  filterNotes,
  type GuideFilter,
  type GuideSort,
  groupByKind,
  guideFileName,
  guideMarkdown,
  KINDS,
  type KindFilter,
  matches,
  SORTS,
  sortNotes,
} from "@/components/guide";
import { kindMarks } from "@/components/marks";
import { SignInGate } from "@/components/SignInGate";
import { plannerDate, tokyoToday } from "@/components/seat-page";
import { UpcomingList } from "@/components/UpcomingList";
import type { Api, GuideOpen, GuideView, SeatView } from "@/lib/contracts";
import { createMockApi, USE_MOCKS } from "@/lib/mocks";

const START: GuideFilter = {
  kind: ALL,
  byline: ALL,
  sort: "newest",
  query: "",
};

// A YYYY-MM-DD date as a calendar day in Tokyo, whatever the device's clock says.
const tokyoDay = (date: string) => new Date(`${date}T00:00:00+09:00`);

function saveFile(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HandoverGuide({ slug }: { slug: string }) {
  const mock = useMemo(
    () => (USE_MOCKS ? createMockApi("a26") : undefined),
    [],
  );
  if (mock) return <Guide slug={slug} api={mock} />;
  return (
    <SignInGate>{({ api }) => <Guide slug={slug} api={api} />}</SignInGate>
  );
}

// The guide itself, for the signed-in client: its own page (/s/[seat]/guide) or, inline, under the deadlines on 聞く.
export function Guide({
  slug,
  api,
  inline = false,
}: {
  slug: string;
  api: Api;
  inline?: boolean;
}) {
  const Title = inline ? "h2" : "h1";
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const [view, setView] = useState<SeatView>();
  const [guide, setGuide] = useState<GuideView>();
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<GuideFilter>(START);
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    let alive = true;
    Promise.all([api.seat(slug), api.guide(slug)]).then(
      ([seatView, guideView]) => {
        if (!alive) return;
        setView(seatView);
        setGuide(guideView);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [api, slug]);

  if (failed) {
    return (
      <section className="dd-col" style={{ gap: "var(--s-4)" }}>
        <Title className="dd-h dd-guide-title">{t("guide.titlePlain")}</Title>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>{t("guide.failed")}</p>
      </section>
    );
  }
  if (!view || !guide) {
    return (
      <section className="dd-col" style={{ gap: "var(--s-4)" }}>
        <Title className="dd-h dd-guide-title">{t("guide.titlePlain")}</Title>
        <output className="dd-cap">{t("profile.loading")}</output>
      </section>
    );
  }

  const { seat } = view;
  const { open: openItems, openChecked } = guide; // the export below runs later, outside this check
  const today = tokyoToday();
  const shown = sortNotes(filterNotes(guide.notes, filter), filter.sort, today);
  const sections = groupByKind(shown);
  const bylines = bylinesOf(guide.notes);
  const query = (filter.query ?? "").trim();
  const filtered = filter.kind !== ALL || filter.byline !== ALL || query !== "";
  const upcoming = view.upcoming.filter(
    (item) =>
      (filter.kind === ALL || filter.kind === "deadline") &&
      (filter.byline === ALL || item.byline === filter.byline) &&
      matches(query, item.title, item.byline),
  );
  const answered = guide.asked.flatMap((asked) =>
    asked.answer ? [{ ...asked, answer: asked.answer }] : [],
  );
  const waiting = guide.asked.filter((asked) => !asked.answer);
  // The stamp's year comes from the term's label; the lineage has every term the seat's notes were written in.
  const termLabelOf = (termOrder: number) =>
    view.lineage.find((term) => term.termOrder === termOrder)?.termLabel;
  const kindWord = (kind: KindFilter) =>
    kind === ALL
      ? t("guide.allKinds")
      : `${kindMarks[kind]} ${t(`kinds.${kind}`)}`;
  const reason = (open: GuideOpen) =>
    t(`guide.reason.${open.reason}`, { group: seat.group, seat: seat.name });
  const asOf = t("guide.asOf", {
    date: format.dateTime(new Date(), { dateStyle: "long" }),
  });
  const filterNote = filtered
    ? [
        t("guide.filteredNote", {
          kind: kindWord(filter.kind),
          byline: filter.byline === ALL ? t("guide.allBylines") : filter.byline,
        }),
        query ? t("filter.searched", { query }) : "",
      ].join("")
    : undefined;

  function exportMarkdown() {
    const name = guideFileName(slug, today);
    const text = guideMarkdown({
      title: t("guide.title", { seat: seat.name }),
      where: t("guide.where", {
        group: seat.group,
        institution: seat.institution,
      }),
      asOf,
      rules: t("guide.rules"),
      filtered: filterNote,
      upcomingHeading: t("seat.upcoming"),
      upcoming: upcoming.map((item) => {
        const { monthDay, weekday } = plannerDate(item.date, locale);
        return t("guide.upcomingItem", {
          date: t("seat.upcomingDate", { date: monthDay, weekday }),
          title: item.title,
          byline: item.byline,
        });
      }),
      sections: sections.map(({ kind, notes }) => ({
        heading: kindWord(kind),
        notes: notes.map((note) => ({
          title: note.title,
          deadline: note.deadlineDate
            ? t("guide.deadline", {
                date: format.dateTime(tokyoDay(note.deadlineDate), {
                  dateStyle: "long",
                }),
              })
            : undefined,
          body: note.body,
          byline: note.byline,
        })),
      })),
      openHeading: t("guide.openTitle"),
      open: [
        ...openItems.map((open) =>
          t("guide.openItem", { text: open.text, reason: reason(open) }),
        ),
        ...waiting.map((asked) =>
          t("guide.openItem", {
            text: asked.text,
            reason: t("guide.yourQuestion"),
          }),
        ),
      ],
      openNote: openChecked ? undefined : t("guide.openUnchecked"),
      askedHeading: t("guide.askedTitle"),
      asked: answered.map((asked) => ({
        question: asked.text,
        sentences: asked.answer.sentences.map((sentence) =>
          t("guide.sentenceBy", {
            text: sentence.text,
            byline: sentence.citations
              .map((citation) => citation.byline)
              .join(t("guide.bylineSeparator")),
          }),
        ),
      })),
      source: t("guide.source", {
        url: `${window.location.origin}/s/${slug}/guide`,
      }),
    });
    saveFile(text, name);
    setSaved(name);
  }

  const openCount = guide.open.length + waiting.length;

  return (
    <div className="dd-col dd-guide" style={{ gap: "var(--s-6)" }}>
      <header className="dd-col" style={{ gap: "var(--s-2)" }}>
        <Title className="dd-h dd-guide-title">
          {t("guide.title", { seat: seat.name })}
        </Title>
        <p style={{ margin: 0 }}>
          <span className="dd-seat-group">{seat.group}</span>
          <br />
          <span className="dd-cap">{seat.institution}</span>
        </p>
        <p className="dd-cap" style={{ margin: 0 }}>
          {asOf}
          <br />
          {t.rich("guide.counts", {
            notes: guide.notes.length,
            open: openCount,
            fig: (chunks) => <span className="dd-fig">{chunks}</span>,
          })}
        </p>
        <p className="dd-cap dd-guide-rules">{t("guide.rules")}</p>
      </header>

      <section
        className="dd-col dd-noprint"
        style={{ gap: "var(--s-3)" }}
        aria-label={t("guide.toolsLabel")}
      >
        <div className="dd-row" style={{ gap: "var(--s-3)" }}>
          <button
            type="button"
            className="dd-btn dd-btn-primary"
            onClick={() => {
              // Inline on 聞く, the page around the guide stays off the paper (styles/components.css → print).
              const root = document.documentElement;
              root.classList.add("dd-printing-guide");
              window.addEventListener(
                "afterprint",
                () => root.classList.remove("dd-printing-guide"),
                { once: true },
              );
              window.print();
            }}
          >
            {t("guide.print")}
          </button>
          <button type="button" className="dd-btn" onClick={exportMarkdown}>
            {t("guide.saveText")}
          </button>
        </div>
        <p className="dd-cap" style={{ margin: 0 }} aria-live="polite">
          {saved ? t("guide.saved", { name: saved }) : t("guide.exportHint")}
        </p>
      </section>

      <fieldset className="dd-filter">
        <legend className="dd-h">{t("filter.title")}</legend>
        <div className="dd-filter-search">
          <label className="dd-cap" htmlFor="guide-search">
            {t("filter.search")}
          </label>
          <input
            id="guide-search"
            type="search"
            className="dd-input"
            value={filter.query ?? ""}
            placeholder={t("filter.searchNotes")}
            onChange={(event) =>
              setFilter({ ...filter, query: event.target.value })
            }
          />
        </div>
        <label>
          <span className="dd-cap">{t("guide.kind")}</span>
          <select
            className="dd-select"
            value={filter.kind}
            onChange={(event) =>
              setFilter({ ...filter, kind: event.target.value as KindFilter })
            }
          >
            {[ALL, ...KINDS].map((kind) => (
              <option key={kind} value={kind}>
                {kindWord(kind as KindFilter)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="dd-cap">{t("guide.byline")}</span>
          <select
            className="dd-select"
            value={filter.byline}
            onChange={(event) =>
              setFilter({ ...filter, byline: event.target.value })
            }
          >
            <option value={ALL}>{t("guide.allBylines")}</option>
            {bylines.map((byline) => (
              <option key={byline} value={byline}>
                {byline}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="dd-cap">{t("filter.sort")}</span>
          <select
            className="dd-select"
            value={filter.sort}
            onChange={(event) =>
              setFilter({ ...filter, sort: event.target.value as GuideSort })
            }
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`guide.sorts.${sort}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="dd-filter-count">
          <output aria-live="polite">
            {t.rich("filter.shown", {
              n: shown.length,
              fig: (chunks) => <span className="dd-fig">{chunks}</span>,
            })}
          </output>
          {filtered && (
            <button
              type="button"
              className="dd-link dd-filter-reset"
              onClick={() => setFilter({ ...START, sort: filter.sort })}
            >
              {t("filter.clear")}
            </button>
          )}
        </div>
      </fieldset>
      {filterNote && <p className="dd-cap dd-print-only">{filterNote}</p>}

      {/* Inline on 聞く the deadlines are right above it already */}
      {!inline && <UpcomingList items={upcoming} />}

      {guide.notes.length === 0 && (
        <p style={{ margin: 0, color: "var(--ink-2)" }}>{t("guide.noNotes")}</p>
      )}
      {guide.notes.length > 0 && shown.length === 0 && (
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          {t("filter.noneMatch")}
        </p>
      )}
      {sections.map(({ kind, notes }) => (
        // 12px from each heading to its notes, as in every section; 16px between the notes
        <section
          key={kind}
          className="dd-col"
          style={{ gap: "var(--s-3)" }}
          aria-labelledby={`guide-${kind}`}
        >
          <h2 id={`guide-${kind}`} className="dd-h">
            <span className="dd-kind-mark" aria-hidden="true">
              {kindMarks[kind]}
            </span>{" "}
            {t(`kinds.${kind}`)}
          </h2>
          <div className="dd-col" style={{ gap: "var(--s-4)" }}>
            {notes.map((note) => {
              const termLabel = termLabelOf(note.termOrder);
              return (
                <article key={note.id} className="dd-slip dd-entry">
                  <h3
                    className="dd-source-title"
                    lang={note.lang}
                    style={{ margin: 0 }}
                  >
                    {note.title}
                  </h3>
                  {note.deadlineDate && (
                    <p style={{ margin: 0 }}>
                      <span className="dd-marker dd-fig">
                        {t("guide.deadline", {
                          date: format.dateTime(tokyoDay(note.deadlineDate), {
                            dateStyle: "long",
                          }),
                        })}
                      </span>
                    </p>
                  )}
                  <p className="dd-ruled dd-guide-body" lang={note.lang}>
                    {note.body}
                  </p>
                  <div className="dd-entry-foot">
                    <span className="dd-cap">{note.byline}</span>
                    {termLabel && (
                      <DateStamp seat={seat} termLabel={termLabel} />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <section
        className="dd-col"
        style={{ gap: "var(--s-3)" }}
        aria-labelledby="guide-open"
      >
        <h2 id="guide-open" className="dd-h">
          {t("guide.openTitle")}
        </h2>
        {!guide.openChecked && (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            {t("guide.openUnchecked")}
          </p>
        )}
        {guide.openChecked && openCount === 0 && (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            {view.viewer.isHolder
              ? t("guide.openNone")
              : t("guide.openHolders")}
          </p>
        )}
        {openCount > 0 && (
          <ul className="dd-gaps">
            {guide.open.map((open) => (
              <li key={open.id}>
                <span className="dd-gap-text">{open.text}</span>
                <span className="dd-cap">{reason(open)}</span>
                <span className="dd-stamp-blank" aria-hidden="true" />
              </li>
            ))}
            {waiting.map((asked) => (
              <li key={asked.questionId}>
                <span className="dd-gap-text is-yours" lang={asked.lang}>
                  {asked.text}
                </span>
                <span className="dd-cap">{t("guide.yourQuestion")}</span>
                <span className="dd-stamp-blank" aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section
          className="dd-col"
          style={{ gap: "var(--s-5)" }}
          aria-labelledby="guide-asked"
        >
          <h2 id="guide-asked" className="dd-h">
            {t("guide.askedTitle")}
          </h2>
          {answered.map((asked) => (
            <article key={asked.questionId} className="dd-guide-answer">
              <AnswerEntry
                question={asked.text}
                answer={asked.answer}
                api={api}
              />
            </article>
          ))}
        </section>
      )}

      <p className="dd-cap dd-print-only">
        {t("guide.source", { url: `/s/${slug}/guide` })}
      </p>
    </div>
  );
}
