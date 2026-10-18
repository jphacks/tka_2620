"use server";
// The two display switches on every seat page (components/DisplayToggles.tsx) save the viewer's choice here, as
// cookies on this device only (lib/display-prefs.ts). Setting a cookie in a server action renders the page again, so a
// new language arrives with its messages, and the theme stays the same after a reload. Anyone can call a server
// action, so each one takes only a known value and sets nothing else: no user, no seat, no note.
import { cookies } from "next/headers";
import {
  LOCALE_COOKIE,
  type Locale,
  PREF_MAX_AGE,
  readLocale,
  readTheme,
  THEME_COOKIE,
  type Theme,
} from "@/lib/display-prefs";

const options = {
  path: "/",
  maxAge: PREF_MAX_AGE,
  sameSite: "lax",
} as const;

export async function saveTheme(theme: Theme): Promise<void> {
  const known = readTheme(theme);
  if (!known) return;
  (await cookies()).set(THEME_COOKIE, known, options);
}

export async function saveLocale(locale: Locale): Promise<void> {
  const known = readLocale(locale);
  if (!known) return;
  (await cookies()).set(LOCALE_COOKIE, known, options);
}
