import { ImageResponse } from "next/og";
import { AppMark, INK, PAPER } from "@/app/app-mark";

// The picture in a link preview (LINE, Slack, X): the app's mark (the folded note with 々) and the name in Latin
// letters, which the default font draws; the page's title and description carry the Japanese.
export const alt = "Daidai";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 48,
        background: PAPER,
      }}
    >
      <AppMark size={360} />
      <div
        style={{
          display: "flex",
          fontSize: 112,
          fontWeight: 700,
          color: INK,
          letterSpacing: 4,
        }}
      >
        Daidai
      </div>
    </div>,
    size,
  );
}
