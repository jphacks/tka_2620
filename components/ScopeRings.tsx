"use client";
// docs/DESIGN.md → ScopeRings and ReaderCount: who a card will reach, picked while writing it. Four concentric rings in
// 1.5px --blue, the chosen one filled with --blue-wash (a wider scope holds the narrower ones), the four scopes as
// radios worded by the seat's label pack, and 「12人が読めます」 in figures beside them (GET /api/handover/readers:
// people besides the author, counts only). Scope defaults to successor; the parent holds the value.
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { type Api, Scope, type SeatView } from "@/lib/contracts";

const RADII: Record<Scope, number> = {
  successor: 9,
  group: 17,
  institution: 25,
  public: 33,
};

export function ScopeRings({
  seat,
  value,
  onChange,
  api,
  disabled = false,
}: {
  seat: SeatView["seat"];
  value: Scope;
  onChange: (scope: Scope) => void;
  api: Pick<Api, "readers">;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const name = useId();
  // The count per scope, read once each. Only the chosen ring's own count shows, taken from it while rendering, so
  // not even one frame says another ring's readers (the first change, from successor, would understate them).
  const [counts, setCounts] = useState<Partial<Record<Scope, number>>>({});
  const [reading, setReading] = useState(false);
  const shown = counts[value];

  useEffect(() => {
    if (counts[value] !== undefined) return;
    setReading(true);
    let alive = true;
    api.readers({ seat: seat.slug, scope: value }).then(
      ({ count }) => {
        if (!alive) return;
        setCounts((current) => ({ ...current, [value]: count }));
        setReading(false);
      },
      () => {
        if (alive) setReading(false); // no number rather than a wrong one
      },
    );
    return () => {
      alive = false;
    };
  }, [api, seat.slug, value, counts]);

  return (
    <div className="dd-scope">
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
        {/* Outermost first, so the filled ring sits behind the narrower ones inside it. */}
        {[...Scope.options].reverse().map((scope) => (
          <circle
            key={scope}
            cx="36"
            cy="36"
            r={RADII[scope]}
            className={scope === value ? "is-on" : undefined}
          />
        ))}
      </svg>
      <fieldset disabled={disabled}>
        <legend className="dd-label" style={{ padding: 0 }}>
          {t("handover.scopeLegend")}
        </legend>
        {Scope.options.map((scope) => (
          <label key={scope}>
            <input
              type="radio"
              name={name}
              value={scope}
              checked={scope === value}
              onChange={() => onChange(scope)}
            />
            {t(`seatTypes.${seat.seatType}.scope.${scope}`, {
              seat: seat.name,
              group: seat.group,
              institution: seat.institution,
            })}
          </label>
        ))}
      </fieldset>
      <output
        className="dd-fig"
        aria-live="polite"
        aria-busy={reading && shown === undefined}
      >
        {shown !== undefined && t("handover.readers", { n: shown })}
      </output>
    </div>
  );
}
