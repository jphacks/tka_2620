// Daidai's mark for icons and link previews (app/icon.tsx, app/apple-icon.tsx, app/opengraph-image.tsx): the club-room key
// tag of docs/DESIGN.md (a sheet with an ink edge, the punched hole, the ring through it) with the notebook's ruled lines
// in the viewer's blue. Shapes only, so next/og draws it without a font. The colours repeat styles/tokens.css (light).
export const PAPER = "#F9FAFB";
const SHEET = "#FFFFFF";
export const INK = "#1D2433";
const INK_2 = "#566074";
const BLUE = "#2141B8";

/** size: the square's side in px; padded: room around the tag (a home-screen icon gets cut to a rounded square). */
export function AppMark({
  size,
  padded = true,
}: {
  size: number;
  padded?: boolean;
}) {
  // The tag and the ring's half outside it span 1.25 tag widths: 88% of the square padded, 95% for the 32px favicon.
  const w = size * (padded ? 0.7 : 0.76);
  const h = w * 0.66;
  const stroke = Math.max(2, Math.round(size / 26));
  const ring = h * 0.62;
  const overhang = ring * 0.62; // the ring's part left of the tag
  const hole = h * 0.28;
  const holeEdge = Math.max(2, Math.round(stroke * 0.6));
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
      <div
        style={{
          position: "relative",
          display: "flex",
          width: w,
          height: h,
          marginLeft: overhang, // so the tag and its ring, not the tag alone, sit in the middle
        }}
      >
        {/* the key ring, half of it outside the tag */}
        <div
          style={{
            position: "absolute",
            left: -overhang,
            top: (h - ring) / 2,
            width: ring,
            height: ring,
            borderRadius: "50%",
            border: `${stroke}px solid ${INK_2}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            background: SHEET,
            border: `${stroke}px solid ${INK}`,
            borderRadius: h * 0.2,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: h * 0.12,
            top: (h - hole) / 2,
            width: hole,
            height: hole,
            borderRadius: "50%",
            background: PAPER,
            border: `${holeEdge}px solid ${INK}`,
          }}
        />
        {[0.3, 0.5, 0.7].map((y, i) => (
          <div
            key={y}
            style={{
              position: "absolute",
              left: h * 0.52,
              top: h * y - stroke / 2,
              width: w * (i === 1 ? 0.42 : 0.52),
              height: stroke,
              borderRadius: stroke,
              background: BLUE,
            }}
          />
        ))}
      </div>
    </div>
  );
}
