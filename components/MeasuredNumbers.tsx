"use client";
// 「測定の内訳」 on the console (docs/DESIGN.md → MeasuredNumbers): every number `pnpm metrics` measured
// (metrics/latest.json), one line per check, so the rest of the trust proof can be read in the app and not only in the
// README. Collapsed by default: on stage the meter and the leak counter are the claim. A check that didn't run says so;
// a missing number is never shown as 0 (docs/SPEC.md → Numbers). Green only for 漏れ 0 and the privacy counts.
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Metrics } from "@/lib/contracts";

const fig = (chunks: ReactNode) => <span className="dd-fig">{chunks}</span>;
const green = (safe: boolean) => (chunks: ReactNode) => (
  <span className={safe ? "dd-fig dd-safe" : "dd-fig"}>{chunks}</span>
);

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function MeasuredNumbers({
  metrics,
  resetHint,
}: {
  metrics?: Metrics;
  /** Real data: say how a reset works there (a terminal command; the service-role key stays out of the app). */
  resetHint: boolean;
}) {
  const t = useTranslations("measured");
  const format = useFormatter();
  const none = t("notMeasured");

  return (
    <details className="dd-measured">
      <summary>{t("title")}</summary>
      {metrics ? (
        <>
          <dl>
            <Line label={t("leaksLabel")}>
              {metrics.leaks
                ? t.rich("leaks", {
                    found: metrics.leaks.found,
                    total: metrics.leaks.totalAttempts,
                    outsider: metrics.leaks.outsiderAttempts,
                    fig,
                    safe: green(metrics.leaks.found === 0),
                  })
                : none}
            </Line>
            <Line label={t("withdrawLabel")}>
              {metrics.withdraw
                ? t.rich("withdraw", {
                    median: metrics.withdraw.medianS,
                    max: metrics.withdraw.maxS,
                    runs: metrics.withdraw.runs,
                    fig,
                  })
                : none}
            </Line>
            <Line label={t("citationsLabel")}>
              {metrics.citations && metrics.citations.sentences > 0
                ? t.rich("citations", {
                    cited: metrics.citations.cited,
                    sentences: metrics.citations.sentences,
                    percent: Math.round(
                      (metrics.citations.cited / metrics.citations.sentences) *
                        100,
                    ),
                    fig,
                  })
                : none}
            </Line>
            <Line label={t("loopLabel")}>
              {metrics.loop
                ? t.rich("loop", {
                    runs: metrics.loop.runs,
                    failures: metrics.loop.failures,
                    median: metrics.loop.medianS,
                    fig,
                  })
                : none}
            </Line>
            <Line label={t("redactionLabel")}>
              {metrics.redaction
                ? t.rich("redaction", {
                    hidden: metrics.redaction.hidden,
                    chats: metrics.redaction.chats,
                    files: metrics.redaction.files,
                    left: metrics.redaction.leftBrowser,
                    fig,
                    hid: green(true),
                    out: green(metrics.redaction.leftBrowser === 0),
                  })
                : none}
            </Line>
          </dl>
          <p className="dd-cap" style={{ margin: 0 }}>
            {t("at", {
              at: format.dateTime(new Date(metrics.measuredAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        </>
      ) : (
        <p style={{ margin: 0 }}>{t("notRun")}</p>
      )}
      {resetHint && (
        <p className="dd-cap" style={{ margin: "var(--s-2) 0 0" }}>
          {t("resetHint")}
        </p>
      )}
    </details>
  );
}
