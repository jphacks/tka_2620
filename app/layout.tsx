import type { Viewport } from "next";
import {
  BIZ_UDGothic,
  BIZ_UDPGothic,
  Klee_One,
  Yusei_Magic,
} from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { PAPER, readTheme, THEME_COOKIE } from "@/lib/display-prefs";
import "./globals.css";

// The theme the viewer chose on this device (SeatBar's switch), or none: then the system's setting decides
// (styles/tokens.css → prefers-color-scheme).
async function chosenTheme() {
  return readTheme((await cookies()).get(THEME_COOKIE)?.value);
}

// viewport-fit=cover lets the page reach under an iPhone's home indicator, so env(safe-area-inset-bottom) is real and
// the verb tabs (.dd-verbs) keep their labels above it. The browser's bars take the page colour of the theme shown.
// No colorScheme here: the light theme sets none (tokens.css), and a forced-light page on a dark phone would get dark
// scrollbars and form controls.
export async function generateViewport(): Promise<Viewport> {
  const theme = await chosenTheme();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: theme
      ? PAPER[theme]
      : [
          { media: "(prefers-color-scheme: light)", color: PAPER.light },
          { media: "(prefers-color-scheme: dark)", color: PAPER.dark },
        ],
  };
}

// preload is off because Google serves the Japanese glyphs in unicode-range slices that next/font can't preload.
// Each variable replaces the whole font stack in styles/tokens.css, so the fallbacks repeat the token's stack.
const hand = Klee_One({
  weight: ["400", "600"],
  variable: "--font-hand",
  preload: false,
  fallback: ["Hiragino Sans", "Noto Sans JP", "system-ui", "sans-serif"],
});
const ui = BIZ_UDPGothic({
  weight: ["400", "700"],
  variable: "--font-ui",
  preload: false,
  fallback: ["Hiragino Sans", "Noto Sans JP", "system-ui", "sans-serif"],
});
const figures = BIZ_UDGothic({
  weight: ["400", "700"],
  variable: "--font-figures",
  preload: false,
  fallback: ["Hiragino Sans", "Noto Sans JP", "system-ui", "sans-serif"],
});
const marker = Yusei_Magic({
  weight: "400",
  variable: "--font-marker",
  preload: false,
  fallback: ["BIZ UDPGothic", "Hiragino Sans", "system-ui", "sans-serif"],
});

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = await chosenTheme();
  return (
    // Browser extensions add attributes to <html> before React loads; this ignores them on this element only.
    // translate="no": Chrome/Safari translation rewrites text React owns (hydration error, then crashes on update).
    // English comes from the NEXT_LOCALE cookie instead (SeatBar's language switch sets it).
    // data-theme is rendered here, so a chosen theme is there before the first paint: no flash of the other one.
    <html
      lang={locale}
      data-theme={theme}
      translate="no"
      className={`${hand.variable} ${ui.variable} ${figures.variable} ${marker.variable}`}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
