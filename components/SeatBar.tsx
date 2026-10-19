"use client";
// docs/DESIGN.md → SeatBar: a quiet row above every seat page (app/(seat)/layout.tsx): the app's mark (AppIcon) on the
// left (named 「代々」 for a screen reader), which leads
// to the start page (the demo's seat and the console), then the language and theme switches and the 「あなた」 tag,
// the account on this device: its menu says who is signed in here and switches (components/AccountMenu.tsx). It isn't
// a fourth verb: 聞く · 残す · 自分のメモ stay the only tabs, and who you are at the seat opens 自分のメモ.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AccountMenu } from "@/components/AccountMenu";
import { AppIcon } from "@/components/AppIcon";
import { LanguageToggle, ThemeToggle } from "@/components/DisplayToggles";

export function SeatBar() {
  const t = useTranslations("bar");
  const home = useTranslations("home");
  return (
    <nav className="dd-bar dd-noprint" aria-label={t("label")}>
      <Link href="/" className="dd-bar-home" title={t("home")}>
        <AppIcon />
        <span className="dd-sr-only">{home("title")}</span>
      </Link>
      <LanguageToggle />
      <ThemeToggle />
      <AccountMenu />
    </nav>
  );
}
