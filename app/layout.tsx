import {
  BIZ_UDGothic,
  BIZ_UDPGothic,
  Klee_One,
  Yusei_Magic,
} from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";

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
  return (
    <html
      lang={locale}
      className={`${hand.variable} ${ui.variable} ${figures.variable} ${marker.variable}`}
    >
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
