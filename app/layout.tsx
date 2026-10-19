import type { Metadata, Viewport } from "next";
import {
  BIZ_UDGothic,
  BIZ_UDPGothic,
  Klee_One,
  Yusei_Magic,
} from "next/font/google";
import { cookies, headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { PAPER, readTheme, THEME_COOKIE } from "@/lib/display-prefs";
import "./globals.css";

// The theme the viewer chose on this device (SeatBar's switch), or none: then the system's setting decides
// (styles/tokens.css → prefers-color-scheme).
async function chosenTheme() {
  return readTheme((await cookies()).get(THEME_COOKIE)?.value);
}

// Every page names itself (WCAG 2.4.2): 「会計（テニスサークル Smash）｜代々」 in the tab, history and bookmarks, read out
// by Next's route announcer on each navigation, and in the preview when a seat link is shared in LINE. Pages set their
// own part (generateMetadata); the template adds the app's name. metadataBase is the address the page was opened at,
// so a preview's image link works on the demo laptop, through a tunnel or deployed. iOS doesn't turn dates and counts
// into phone links.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  const locale = await getLocale();
  const request = await headers();
  const host = request.get("x-forwarded-host") ?? request.get("host");
  const protocol = request.get("x-forwarded-proto") ?? "http";
  return {
    ...(host && { metadataBase: new URL(`${protocol}://${host}`) }),
    title: { template: t("template"), default: t("app") },
    description: t("description"),
    applicationName: t("app"),
    appleWebApp: { capable: true, title: t("app"), statusBarStyle: "default" },
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: {
      siteName: t("app"),
      type: "website",
      locale: locale === "en" ? "en_US" : "ja_JP",
    },
    twitter: { card: "summary_large_image" },
  };
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
