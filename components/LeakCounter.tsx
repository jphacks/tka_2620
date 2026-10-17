"use client";
// docs/DESIGN.md → LeakCounter: 「漏れ 0 / 50 回」, the 0 in --green. Green is safe only: it never carries any
// other meaning (DESIGN.md → Color), so a count above 0 stays ink. The numbers are the leak test's (#28), read from
// metrics/latest.json (#29); until it has run the counter says so instead of showing a number.
import { useTranslations } from "next-intl";
import type { Metrics } from "@/lib/contracts";

export function LeakCounter({ leaks }: { leaks?: Metrics["leaks"] }) {
  const t = useTranslations("leak");
  if (!leaks) return <p className="dd-leak">{t("notRun")}</p>;
  return (
    <p className="dd-leak">
      {t.rich("counter", {
        leaks: leaks.found,
        probes: leaks.outsiderAttempts,
        // Figures so the digits stay fixed; green only when nothing leaked.
        safe: (chunks) => (
          <span className={leaks.found === 0 ? "dd-safe" : undefined}>
            {chunks}
          </span>
        ),
      })}
    </p>
  );
}
