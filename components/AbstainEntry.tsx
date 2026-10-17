"use client";

import { useTranslations } from "next-intl";
import type { AbstainedResult, SeatView } from "@/lib/contracts";

// 空欄: what nobody knows (docs/DESIGN.md → AbstainEntry). A calm, first-class state: never red, never an error icon.
export function AbstainEntry({
  result,
  seat,
}: {
  result: AbstainedResult;
  seat: SeatView["seat"];
}) {
  const t = useTranslations();
  return (
    <div className="dd-col">
      {/* The blank line, with a dashed stamp outline where a predecessor's stamp would go. */}
      <div
        className="dd-ruled"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          height: "32px",
        }}
      >
        <span className="dd-stamp-blank" aria-hidden="true" />
      </div>
      <p style={{ margin: 0, color: "var(--ink-2)" }}>
        {t(`seatTypes.${seat.seatType}.abstain`, { seat: seat.name })}
      </p>
      {result.routedTo > 0 && (
        <output style={{ display: "block", color: "var(--blue)" }}>
          {t(`seatTypes.${seat.seatType}.routed`, { seat: seat.name })}
        </output>
      )}
    </div>
  );
}
