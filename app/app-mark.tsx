// Daidai's mark for icons and link previews (app/icon.tsx, app/apple-icon.tsx, app/opengraph-image.tsx): the fan of
// three notes from components/AppIcon.tsx (the mark top left on every screen), the same drawing in the light theme's
// colours, set on the paper. next/og can't read the page's tokens, so the colours repeat styles/tokens.css (light), and
// it takes the drawing as an SVG image, which needs no font.
import { markSvg } from "@/components/AppIcon";

export const PAPER = "#F9FAFB";
const SHEET = "#FFFFFF";
export const INK = "#1D2433";
const INK_2 = "#566074";
const BLUE = "#2141B8";

const MARK = `data:image/svg+xml;base64,${btoa(
  markSvg({ paper: PAPER, sheet: SHEET, ink: INK, ink2: INK_2, blue: BLUE }),
)}`;

/** size: the square's side in px; padded: room around the fan (a home-screen icon gets cut to a rounded square). */
export function AppMark({
  size,
  padded = true,
}: {
  size: number;
  padded?: boolean;
}) {
  const side = Math.round(size * (padded ? 0.78 : 1));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: PAPER,
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/og draws the PNG icons; next/image doesn't exist there */}
      <img src={MARK} width={side} height={side} alt="" />
    </div>
  );
}
