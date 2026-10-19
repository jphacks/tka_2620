// The app's mark, top left on every screen in place of the word 「代々」 (Nico's call): the club-room key tag of the
// home-screen icon (app/app-mark.tsx: the ring, the sheet with its ink edge, the punched hole, three blue lines), drawn
// here in the theme's tokens so it follows the dark screen. Decorative: the link around it carries the name.
// Same proportions as the icon: the tag 100 × 66, the ring 0.62 of its height, half of it outside the tag.
export function AppIcon() {
  return (
    <svg
      className="dd-app-icon"
      viewBox="0 0 126 66"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="20.5"
        cy="33"
        r="17.5"
        strokeWidth="6"
        style={{ fill: "none", stroke: "var(--ink-2)" }}
      />
      <rect
        x="28.4"
        y="3"
        width="94"
        height="60"
        rx="11"
        strokeWidth="6"
        style={{ fill: "var(--sheet)", stroke: "var(--ink)" }}
      />
      <circle
        cx="42.5"
        cy="33"
        r="7.4"
        strokeWidth="3.6"
        style={{ fill: "var(--paper)", stroke: "var(--ink)" }}
      />
      <g
        strokeWidth="6"
        strokeLinecap="round"
        style={{ stroke: "var(--blue)" }}
      >
        <line x1="62.7" y1="19.8" x2="108.7" y2="19.8" />
        <line x1="62.7" y1="33" x2="98.7" y2="33" />
        <line x1="62.7" y1="46.2" x2="108.7" y2="46.2" />
      </g>
    </svg>
  );
}
