# Internationalization (i18n) & Multi-Currency

This project supports 18 languages and 21 currencies. Locale is stored in a cookie
(`NEXT_LOCALE`); currency is stored in `NEXT_CURRENCY`. Both auto-detect on first
visit using the browser's `Accept-Language` header and the CDN's `x-vercel-ip-country`
/ `cf-ipcountry` header respectively, then the user can override from the topbar.

## Supported locales

`en, es, fr, de, nl, it, pt, ja, ko, zh, ar, he, hi, sv, no, da, fi, pl`

RTL locales (`ar`, `he`) set `<html dir="rtl">` automatically via the root layout.

## Supported currencies

`USD, EUR, GBP, CAD, AUD, NZD, INR, JPY, KRW, CNY, SGD, AED, SAR, ILS, BRL, MXN,
CHF, SEK, NOK, DKK, PLN`

## How to translate a string

1. **Client component** — use `useTranslations`:

   ```tsx
   "use client";
   import { useTranslations } from "next-intl";

   export function MyButton() {
     const t = useTranslations("common");
     return <button>{t("save")}</button>;
   }
   ```

2. **Server component** — use `getTranslations`:

   ```tsx
   import { getTranslations } from "next-intl/server";

   export default async function Page() {
     const t = await getTranslations("dashboard");
     return <h1>{t("title")}</h1>;
   }
   ```

3. **Add the string** to every file in `messages/*.json` under the correct
   namespace. If you only add it to `en.json`, next-intl will fall back to the
   key name in other locales.

## How to add a new language

1. Add the code to `src/i18n/config.ts` (both `locales` and `localeNames`).
2. Add to `rtlLocales` if the script runs right-to-left.
3. Copy `messages/en.json` → `messages/<new-code>.json` and translate every
   value. JSON structure must remain identical.
4. Done. The switcher picks it up automatically.

## How to format prices

```tsx
"use client";
import { useCurrency } from "@/components/layout/currency-provider";

export function Price() {
  const { formatFromUSD } = useCurrency();
  // Base prices live in USD. They auto-convert + format.
  return <span>{formatFromUSD(29)}</span>;
}
```

`formatFromUSD(29)` produces:
- **USD** → `$29.00`
- **GBP** → `£22.91`
- **EUR** → `€26,68`
- **INR** → `₹2,421.50`
- **JPY** → `¥4,379`

## Geo-detection (server-side)

On first request for a new user the root layout calls `resolveCurrency()` which
checks, in order:

1. `NEXT_CURRENCY` cookie — set when the user picks a currency
2. `x-vercel-ip-country` header (Vercel edge) or `cf-ipcountry` (Cloudflare)
3. Falls back to `USD`

If you deploy behind a proxy that sets a different header, add it to
`src/lib/currency-server.ts`.

## Exchange rates

The rates in `src/lib/currency.ts` are hardcoded estimates. For production,
replace with a scheduled job that pulls from a real FX API (e.g. openexchangerates.org,
exchangerate.host) and caches the results in Redis or the DB for 1 hour. Do
**not** pull FX on every request.

## Stripe multi-currency

Next step (not implemented here): in Stripe Dashboard, create a `Price` per
currency on your Product. Then in your checkout flow, pass the correct
`price` ID based on `resolveCurrency()`. Stripe handles the actual charge in
that currency; `formatFromUSD` is only for display.

## Translation quality note

The initial 17 non-English translations were AI-generated and are suitable for
launch but should be reviewed by native speakers before large ad spend. Check
especially:
- Japanese, Korean, Chinese — honorifics/formality levels
- Arabic, Hebrew — RTL layout with mixed-direction content (numbers, English brand)
- Hindi — Devanagari font rendering

To fix an entry, edit the appropriate `messages/<locale>.json`. No code change
needed — the translations are hot-reloaded in dev, served fresh on each build
in production.
