"use client";
// The import review (docs/SPEC.md → adding knowledge, steps 8–10; docs/DESIGN.md → AddPanel): what POST /api/import
// drafted, for the person adding to check before anything is kept. First what the text leaves out (MissingList, the
// cold start's punchline, in view as soon as the drafts arrive), then the cards the output guard refused, then the
// drafted notes to edit, leave out or match with a similar note, and 公開する: only the kept cards are published, signed
// with the viewer's own byline. Nothing here is stored: the drafts live in this component until they are published.
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { DraftEntry } from "@/components/DraftEntry";
import { MissingList } from "@/components/MissingList";
import {
  cardProblem,
  duplicateOf,
  type Entry,
  entriesOf,
  type Provenance,
  publishCards,
  publishHold,
} from "@/components/review";
import {
  type Api,
  ApiError,
  type ImportResponse,
  type SeatView,
} from "@/lib/contracts";

// The chip as the page words it: 「LINEグループ・2025年3月」, "LINE group · March 2025".
function useProvenanceLabel(provenance: Provenance): string {
  const t = useTranslations("import");
  const locale = useLocale();
  const month = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${provenance.month}-01T00:00:00Z`));
  return t("provenance", { platform: t(`from.${provenance.from}`), month });
}

export function ImportReview({
  slug,
  view,
  response,
  provenance,
  api,
}: {
  slug: string;
  /** The seat as the viewer sees it: the labels, and the term publishing signs with. */
  view?: SeatView;
  response: ImportResponse;
  provenance: Provenance;
  api: Pick<Api, "publish" | "gap">;
}) {
  const t = useTranslations();
  const ids = useId();
  const chip = useProvenanceLabel(provenance);
  const [entries, setEntries] = useState<Entry[]>(() => entriesOf(response));
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<number>();
  const [failed, setFailed] = useState<"unredacted" | "failed">();
  const done = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    if (published !== undefined) done.current?.focus();
  }, [published]);

  const hold = publishHold(entries, response.duplicates, chip);
  const kept = entries.filter((entry) => !entry.dropped).length;

  async function publish() {
    if (hold || publishing) return;
    const cards = publishCards(entries, response.duplicates, chip);
    setPublishing(true);
    setFailed(undefined);
    try {
      await api.publish({ seat: slug, cards });
      setPublished(cards.length);
    } catch (error) {
      // The server's guard found a name, contact details or a placeholder in what a reader would see.
      const code = ApiError.safeParse(error).data?.error;
      setFailed(code === "unredacted" ? "unredacted" : "failed");
    } finally {
      setPublishing(false);
    }
  }

  const draftsId = `${ids}-drafts`;
  const holdId = `${ids}-hold`;
  return (
    <div className="dd-col" style={{ gap: "var(--s-5)" }}>
      {response.missing.length > 0 && (
        <MissingList slug={slug} missing={response.missing} api={api} />
      )}
      {response.blocked.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: "var(--s-2)",
          }}
        >
          {response.blocked.map((blocked, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a blocked card has no id, and the list never changes
            <li key={index} className="dd-phrase">
              {blocked.title && (
                <span style={{ fontWeight: 700 }}>{blocked.title} </span>
              )}
              <span style={{ color: "var(--ink-2)" }}>
                {t(`import.blockedReason.${blocked.reason}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <section
          className="dd-col"
          style={{ gap: "var(--s-4)" }}
          aria-labelledby={draftsId}
        >
          <h3 id={draftsId} className="dd-h">
            {t("import.draftsTitle")}
          </h3>
          {entries.map((entry, index) =>
            published !== undefined && entry.dropped ? null : (
              <DraftEntry
                // biome-ignore lint/suspicious/noArrayIndexKey: the drafts keep their order; a dropped one keeps its place
                key={index}
                entry={entry}
                seat={view?.seat}
                termLabel={view?.viewer.termLabel}
                provenance={chip}
                similar={duplicateOf(response.duplicates, index)}
                problem={cardProblem(entry.card, chip)}
                published={published !== undefined}
                onChange={(next) =>
                  setEntries((current) =>
                    current.map((old, at) => (at === index ? next : old)),
                  )
                }
              />
            ),
          )}
          {published === undefined ? (
            <div className="dd-col" style={{ gap: "var(--s-2)" }}>
              <button
                type="button"
                className="dd-btn dd-btn-primary"
                style={{ justifySelf: "start", minHeight: "52px" }}
                // aria-disabled, not disabled: the button stays reachable by keyboard, with what holds it back.
                aria-disabled={hold !== undefined || publishing}
                aria-describedby={hold ? holdId : undefined}
                onClick={publish}
              >
                {publishing
                  ? t("import.publishing")
                  : t("import.publishCount", { count: kept })}
              </button>
              {hold && (
                <p id={holdId} className="dd-phrase" style={{ margin: 0 }}>
                  {t(`import.hold.${hold}`)}
                </p>
              )}
              {failed && (
                <p role="alert" className="dd-phrase" style={{ margin: 0 }}>
                  {t(
                    failed === "unredacted"
                      ? "import.publishUnredacted"
                      : "import.publishFailed",
                  )}
                </p>
              )}
            </div>
          ) : (
            <output ref={done} tabIndex={-1} className="dd-live-note">
              {t("import.published", { count: published })}
            </output>
          )}
        </section>
      )}
    </div>
  );
}
