"use client";
// docs/DESIGN.md → MissingList: what the added text leaves out (a deadline without its date, a step it calls necessary
// without explaining it, a checklist topic nothing covers), each as a blank line with the dashed stamp outline where a
// predecessor's stamp would go, 「〇〇が書かれていません」, why, and a blue 「先輩に聞く」. Calm, like AbstainEntry: never red.
// 「先輩に聞く」 makes the item's prompt a gap prompt of the seat (POST /api/handover/prompts), which the seat's holders
// read among the handover prompts; asking twice is one prompt.
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { Api, MissingItem } from "@/lib/contracts";
import { questionLang } from "@/lib/engine/lang";

type Ask = "asking" | "asked" | "failed";

export function MissingList({
  slug,
  missing,
  api,
}: {
  slug: string;
  missing: MissingItem[];
  api: Pick<Api, "gap">;
}) {
  const t = useTranslations();
  const headingId = useId();
  const [asks, setAsks] = useState<Record<number, Ask>>({});

  async function ask(index: number) {
    setAsks((current) => ({ ...current, [index]: "asking" }));
    try {
      await api.gap({ seat: slug, text: missing[index].prompt });
      setAsks((current) => ({ ...current, [index]: "asked" }));
    } catch {
      setAsks((current) => ({ ...current, [index]: "failed" }));
    }
  }

  return (
    <section
      className="dd-col"
      style={{ gap: "var(--s-3)" }}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className="dd-h">
        {t("import.missingTitle")}
      </h3>
      <ul className="dd-missing">
        {missing.map((item, index) => {
          const state = asks[index];
          const lang = questionLang(`${item.topic}${item.reason}`);
          return (
            // The model's list for this one import: it never reorders while shown.
            // biome-ignore lint/suspicious/noArrayIndexKey: a missing item has no id, and the list never changes
            <li key={index} className="dd-col" style={{ gap: "var(--s-1)" }}>
              <div className="dd-ruled dd-blank" aria-hidden="true">
                <span className="dd-stamp-blank" />
              </div>
              <p
                className="dd-phrase"
                lang={lang}
                style={{ margin: 0, fontWeight: 700 }}
              >
                {t("import.missingItem", { topic: item.topic })}
              </p>
              <p className="dd-cap dd-phrase" lang={lang} style={{ margin: 0 }}>
                {item.reason}
              </p>
              {state === "asked" ? (
                <output
                  className="dd-phrase"
                  style={{ display: "block", color: "var(--blue)" }}
                >
                  {t("import.asked")}
                </output>
              ) : (
                <button
                  type="button"
                  className="dd-btn"
                  style={{ justifySelf: "start" }}
                  disabled={state === "asking"}
                  onClick={() => ask(index)}
                >
                  {t(
                    state === "asking" ? "import.sending" : "import.askLeaver",
                  )}
                </button>
              )}
              {state === "failed" && (
                <p role="alert" className="dd-phrase" style={{ margin: 0 }}>
                  {t("import.askFailed")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
