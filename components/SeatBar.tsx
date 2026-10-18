"use client";
// docs/DESIGN.md → SeatBar: a quiet row above every seat page (app/(seat)/layout.tsx) with the language and theme
// switches and the 「あなた」 tag, which opens who you are at this seat (/me). It isn't a fourth verb: 聞く · 残す ·
// 自分のメモ stay the only tabs. The seat comes from the URL: /s/<seat>… or ?seat= on the /me pages.
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageToggle, ThemeToggle } from "@/components/DisplayToggles";
import { SeatSlug } from "@/lib/contracts";

export function SeatBar() {
  const t = useTranslations("bar");
  const params = useParams();
  const search = useSearchParams();
  const pathname = usePathname();
  const seat = SeatSlug.safeParse(
    typeof params.seat === "string" ? params.seat : search.get("seat"),
  ).data;
  const profile = seat ? `/me?seat=${encodeURIComponent(seat)}` : "/me";
  return (
    <nav className="dd-bar dd-noprint" aria-label={t("label")}>
      <LanguageToggle />
      <ThemeToggle />
      <Link
        href={profile}
        className="dd-you"
        aria-current={pathname === "/me" ? "page" : undefined}
      >
        {t("you")}
      </Link>
    </nav>
  );
}
