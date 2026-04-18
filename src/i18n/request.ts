import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, type Locale } from "./config";

export const LOCALE_COOKIE = "NEXT_LOCALE";

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;

  const hdrs = await headers();
  const acceptLanguage = hdrs.get("accept-language") || "";
  const primary = acceptLanguage
    .split(",")[0]
    ?.split("-")[0]
    ?.trim()
    .toLowerCase();
  if (primary && isLocale(primary)) return primary;

  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
