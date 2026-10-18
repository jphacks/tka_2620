import { getTranslations } from "next-intl/server";

// The bare address opens no seat: a seat is entered from its own link (QR code or NFC sticker, docs/SPEC.md → One
// interface), and there is no seat switcher this weekend. So this page says where to go, instead of showing nothing.
export default async function Home() {
  const t = await getTranslations("home");
  return (
    <main
      className="dd-pad dd-col"
      style={{
        maxWidth: "640px",
        marginInline: "auto",
        minHeight: "100dvh",
        alignContent: "center",
        boxSizing: "border-box",
      }}
    >
      <h1
        className="dd-h"
        style={{ fontSize: "var(--text-xl)", lineHeight: 1.3 }}
      >
        {t("title")}
      </h1>
      <p style={{ margin: 0 }}>{t("open")}</p>
    </main>
  );
}
