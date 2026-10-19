import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppIcon } from "@/components/AppIcon";
import { LanguageToggle, ThemeToggle } from "@/components/DisplayToggles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: { absolute: t("home") } };
}

// The demo's seat (docs/SPEC.md → The golden path): the one the stage opens, and its NFC sticker's link.
const DEMO_SEAT = "smash-kaikei";

// The start page: where the bare address lands, and where every seat page's 「代々」 leads. A seat is normally entered
// from its own link (the QR code or NFC sticker on the club-room key), and there is no seat switcher this weekend, so
// this page offers the demo's seat and the console: the trust proof on three screens side by side, which is the
// presenter's view and so not one of the seat's three verbs.
export default async function Home() {
  const t = await getTranslations("home");
  return (
    <>
      <nav className="dd-bar dd-noprint" aria-label={t("barLabel")}>
        {/* The app's mark in the top left, as on every screen; here it is the page itself, so no link */}
        <span className="dd-bar-mark">
          <AppIcon />
        </span>
        <LanguageToggle />
        <ThemeToggle />
      </nav>
      <main
        className="dd-pad dd-col dd-home"
        style={{ maxWidth: "640px", marginInline: "auto" }}
      >
        <header className="dd-col" style={{ gap: "var(--s-1)" }}>
          <h1 className="dd-home-title">{t("title")}</h1>
          <p className="dd-home-lead">{t("lead")}</p>
        </header>

        <section className="dd-col dd-home-part" aria-labelledby="home-seat">
          <h2 id="home-seat" className="dd-h">
            {t("seatTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("open")}</p>
          <Link
            className="dd-btn dd-btn-primary dd-btn-link"
            href={`/s/${DEMO_SEAT}`}
          >
            {t("demoSeat")}
          </Link>
        </section>

        <section className="dd-col dd-home-part" aria-labelledby="home-console">
          <h2 id="home-console" className="dd-h">
            {t("consoleTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("consoleText")}</p>
          <Link className="dd-btn dd-btn-link" href="/console">
            {t("openConsole")}
          </Link>
        </section>
      </main>
    </>
  );
}
