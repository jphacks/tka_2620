import type { locales } from "@/i18n/config";
import type messages from "@/messages/ja.json";

// Typed message keys: a t("…") key that isn't in messages/ja.json fails `pnpm typecheck`.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: typeof messages;
  }
}
