"use client";
// docs/DESIGN.md → WithdrawMeter: figures face, 39px on the console. It counts in --red from the click and
// freezes in --ink when the last pane drops the note: 「0.8秒」. The frozen number is what the trust proof
// says out loud (SPEC F4: withdrawal median under 1 s).
import { useTranslations } from "next-intl";

export function WithdrawMeter({
  ms,
  running,
}: {
  /** Elapsed milliseconds; the frozen value once running is false. */
  ms: number;
  /** true while the control room is still waiting for the last pane to drop the note. */
  running: boolean;
}) {
  const t = useTranslations("console");
  return (
    <output
      className={`dd-meter${running ? "" : " is-frozen"}`}
      aria-label={t("meter")}
      aria-live={running ? "off" : "polite"}
    >
      {t("seconds", { s: (ms / 1000).toFixed(1) })}
    </output>
  );
}
