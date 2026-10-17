"use client";
// docs/DESIGN.md → LeakCounter: 「漏れ 0 / 50 回」, the 0 in --green. Green is safe only: it never carries any
// other meaning (DESIGN.md → Color). The numbers come from the leak test (#28) via metrics/latest.json (#29).
import { useTranslations } from "next-intl";

export function LeakCounter({
  leaks,
  probes,
}: {
  leaks: number;
  probes: number;
}) {
  const t = useTranslations("leak");
  return (
    <p className="dd-cap" style={{ margin: 0 }}>
      {t.rich("counter", {
        leaks,
        probes,
        // The 0 is the safe number: green, and figures so the digits stay fixed.
        safe: (chunks) => <span className="dd-safe">{chunks}</span>,
      })}
    </p>
  );
}
