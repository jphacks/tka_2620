import { cookies } from "next/headers";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, locales } from "./config";

// No locale in the URL: Japanese unless the NEXT_LOCALE cookie asks for English. Never read from
// Accept-Language, so a laptop set to English still shows Japanese on stage.
export default getRequestConfig(async () => {
  const requested = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = hasLocale(locales, requested) ? requested : defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: "Asia/Tokyo",
  };
});
