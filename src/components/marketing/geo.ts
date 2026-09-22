// The geo detected starting currency (decision 7).
//
// USD is the default and the answer whenever the country is unknown, which
// on this deployment is most of the time and deliberately so: the site is
// self hosted behind a reverse proxy that sets none of the three country
// headers a platform edge would, so the geo branch is usually dead. That is
// a fact worth writing down rather than hiding, because the failure mode of
// a guess is a visitor reading a price in a currency they cannot pay in.
//
// The toggle is the real mechanism. Detection only picks where it starts.
//
// Prices are AUTHORED per currency in the pricing source, never converted:
// the product's FX table is a stale static snapshot, so a multiplied price
// is wrong by whatever the market has moved since it was written.

import { headers } from "next/headers";

import { currencyFromCountry, pricing, type MarketingCurrency } from "./data/pricing";

/** The headers a platform edge or a CDN sets. Read in order, first wins. */
const COUNTRY_HEADERS = ["x-vercel-ip-country", "cf-ipcountry", "x-country-code"];

/**
 * Detection is OFF unless the deployment says it has the headers.
 *
 * `headers()` is a dynamic API: calling it opts the whole route out of
 * static rendering. The home page awaited this before anything painted, so
 * the site's LCP route was dynamic on every request for a branch this
 * module's own header describes as usually dead, because the reverse proxy
 * in front of it sets none of the three headers below.
 *
 * Paying for a dynamic render to read a header that is never there is the
 * wrong trade, and the wrong trade on the one route where it costs most. So
 * the read happens only where a platform edge or a CDN is actually setting
 * one, declared by the deployment rather than guessed at per request:
 *
 *   MARKETING_GEO_HEADERS=true
 *
 * With it off, every visitor starts on the default currency and changes it
 * with the toggle, which is the real mechanism in either case (decision 7).
 */
export const geoDetectionEnabled = process.env.MARKETING_GEO_HEADERS === "true";

export async function detectCurrency(): Promise<MarketingCurrency> {
  if (!geoDetectionEnabled) return pricing.defaultCurrency;
  try {
    const h = await headers();
    for (const name of COUNTRY_HEADERS) {
      const value = h.get(name);
      if (value && value.length === 2) return currencyFromCountry(value);
    }
  } catch {
    // A static render has no request. USD is the documented default.
  }
  return pricing.defaultCurrency;
}
