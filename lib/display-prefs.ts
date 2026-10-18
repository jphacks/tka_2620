// How a device shows Daidai: the notebook (light) or the blackboard (dark), and the language. Both are the viewer's
// own choice on this device, kept in cookies so the server renders the page that way at once (no flash of the other
// theme, and next-intl reads NEXT_LOCALE in i18n/request.ts). The switches are on every seat page (SeatBar); the
// cookies are set by the server actions in lib/display.ts.
import { locales } from "@/i18n/config";

export type Locale = (typeof locales)[number];

// No cookie: follow the system's light or dark setting (styles/tokens.css → prefers-color-scheme).
export const THEME_COOKIE = "daidai-theme";
export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];

// next-intl's cookie, read by i18n/request.ts.
export const LOCALE_COOKIE = "NEXT_LOCALE";

// A year: a choice made on this device should outlast the weekend.
export const PREF_MAX_AGE = 60 * 60 * 24 * 365;

export function readTheme(value: string | undefined): Theme | undefined {
  return themes.find((theme) => theme === value);
}

export function readLocale(value: string | undefined): Locale | undefined {
  return locales.find((locale) => locale === value);
}

// The browser's own bars take the page colour, --paper in styles/tokens.css. A <meta name="theme-color"> can't read a
// CSS variable, so the two values are repeated here; change them together.
export const PAPER: Record<Theme, string> = {
  light: "#F9FAFB",
  dark: "#1B2723",
};
