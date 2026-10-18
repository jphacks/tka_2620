"use client";
// docs/DESIGN.md → DisplayToggles: the two display switches in SeatBar, so a viewer can read Daidai in English or on
// the blackboard without knowing about a cookie. Each choice is this device's only (lib/display.ts).
import { Moon, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { locales } from "@/i18n/config";
import { saveLocale, saveTheme } from "@/lib/display";
import { type Locale, readTheme, type Theme } from "@/lib/display-prefs";

const DARK = "(prefers-color-scheme: dark)";

// The theme on screen: the one chosen on this device (data-theme on <html>), else the system's.
function shownTheme(): Theme {
  const chosen = readTheme(document.documentElement.dataset.theme);
  if (chosen) return chosen;
  return window.matchMedia(DARK).matches ? "dark" : "light";
}

// 暗い画面 (the blackboard), pressed or not. The icon is the other theme, the one a press switches to; until the page
// has loaded, CSS picks it (styles/components.css → .dd-when-light), since the server can't see the system's setting.
export function ThemeToggle() {
  const t = useTranslations("bar");
  const [theme, setTheme] = useState<Theme>();

  useEffect(() => {
    setTheme(shownTheme());
    const media = window.matchMedia(DARK);
    const follow = () => setTheme(shownTheme());
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  function toggle() {
    const next: Theme = shownTheme() === "dark" ? "light" : "dark";
    // At once on this page; the cookie keeps it for the next one.
    document.documentElement.dataset.theme = next;
    setTheme(next);
    void saveTheme(next);
  }

  return (
    <button
      type="button"
      className="dd-icon-btn"
      aria-label={t("darkScreen")}
      title={t("darkScreen")}
      aria-pressed={theme === undefined ? undefined : theme === "dark"}
      onClick={toggle}
    >
      <Moon className="dd-when-light" aria-hidden="true" size={22} />
      <Sun className="dd-when-dark" aria-hidden="true" size={22} />
    </button>
  );
}

// The other language, named in itself (English / 日本語), so someone who can't read the page still finds it.
export function LanguageToggle() {
  const t = useTranslations("bar.language");
  const locale = useLocale();
  const [switching, startSwitch] = useTransition();
  const other: Locale = locales.find((known) => known !== locale) ?? "ja";
  return (
    <button
      type="button"
      className="dd-link dd-bar-link"
      lang={other}
      disabled={switching}
      onClick={() =>
        startSwitch(async () => {
          await saveLocale(other);
        })
      }
    >
      {t(other)}
    </button>
  );
}
