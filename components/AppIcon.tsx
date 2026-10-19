// The app's mark (Nico's call: not the seat's key tag, which 聞く shows right under it): three notes fanned like a hand
// of cards, the front one white with an ink edge and the notebook's three blue lines: notes handed down, which is what
// 代々 does. One drawing, twice:
// - AppIcon: on screen, in the theme's tokens, so it follows the dark screen. It stands top left on every screen in place
//   of the word 「代々」. Decorative: the link around it carries the name.
// - markSvg: the same shapes in fixed colours, for the PNG icons (app/app-mark.tsx: favicon, home screen, link preview).

type Colours = {
  paper: string;
  sheet: string;
  ink: string;
  ink2: string;
  blue: string;
};
const TOKENS: Colours = {
  paper: "var(--paper)",
  sheet: "var(--sheet)",
  ink: "var(--ink)",
  ink2: "var(--ink-2)",
  blue: "var(--blue)",
};

// Three 30 × 40 slips, each turned about a point below them, back to front; the front one carries the lines.
const SLIPS = [
  { turn: -14, fill: "paper", edge: "ink2", width: 3 },
  { turn: -2, fill: "sheet", edge: "ink2", width: 3 },
  { turn: 11, fill: "sheet", edge: "ink", width: 3.6 },
] as const;
const PIVOT = "32 58";
const LINES = [
  { y: 22, length: 18 },
  { y: 30, length: 13.5 },
  { y: 38, length: 18 },
];
// Square, around the fan with its strokes.
const VIEWBOX = "3 3 56 56";

export function AppIcon() {
  return (
    <svg
      className="dd-app-icon"
      viewBox={VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      {SLIPS.map((slip, index) => (
        <g key={slip.turn} transform={`rotate(${slip.turn} ${PIVOT})`}>
          <rect
            x="17"
            y="10"
            width="30"
            height="40"
            rx="4"
            strokeWidth={slip.width}
            style={{ fill: TOKENS[slip.fill], stroke: TOKENS[slip.edge] }}
          />
          {index === SLIPS.length - 1 &&
            LINES.map((line) => (
              <line
                key={line.y}
                x1="23"
                y1={line.y}
                x2={23 + line.length}
                y2={line.y}
                strokeWidth="3.6"
                strokeLinecap="round"
                style={{ stroke: TOKENS.blue }}
              />
            ))}
        </g>
      ))}
    </svg>
  );
}

/** The mark as an SVG document in fixed colours, for next/og (it can't read the page's tokens). */
export function markSvg(colours: Colours): string {
  const slips = SLIPS.map((slip, index) => {
    const lines =
      index === SLIPS.length - 1
        ? LINES.map(
            (line) =>
              `<line x1="23" y1="${line.y}" x2="${23 + line.length}" y2="${line.y}" stroke="${colours.blue}" stroke-width="3.6" stroke-linecap="round"/>`,
          ).join("")
        : "";
    return `<g transform="rotate(${slip.turn} ${PIVOT})"><rect x="17" y="10" width="30" height="40" rx="4" fill="${colours[slip.fill]}" stroke="${colours[slip.edge]}" stroke-width="${slip.width}"/>${lines}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}">${slips}</svg>`;
}
