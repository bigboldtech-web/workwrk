import "server-only";
import { cookies, headers } from "next/headers";
import {
  countryToCurrency,
  defaultCurrency,
  isCurrency,
  type Currency,
} from "./currency";

export const CURRENCY_COOKIE = "NEXT_CURRENCY";

/** Detect currency from (1) cookie, (2) CDN geo header, (3) default. */
export async function resolveCurrency(): Promise<Currency> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(CURRENCY_COOKIE)?.value;
  if (cookieValue && isCurrency(cookieValue)) return cookieValue;

  const hdrs = await headers();
  const country =
    hdrs.get("x-vercel-ip-country") ||
    hdrs.get("cf-ipcountry") ||
    hdrs.get("x-country-code") ||
    "";
  const mapped = country ? countryToCurrency[country.toUpperCase()] : undefined;
  return mapped ?? defaultCurrency;
}
