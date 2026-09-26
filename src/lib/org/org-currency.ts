// The workspace's currency (settings.currency, edited on Settings > Locale
// and work week), read once for every money figure on screen
// (spec-tools-misc section 3 useOrgCurrency). Pure, with the hook beside it.
//
// The fallback is USD, which is what every page that hard-coded a currency
// (Assets among them) already showed, so an org that never set the field
// sees exactly what it saw before.

export const ORG_CURRENCY_FALLBACK = "USD";

/** A three-letter ISO code from the org settings, or the fallback. */
export function orgCurrencyFromSettings(settings: unknown): string {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return ORG_CURRENCY_FALLBACK;
  const raw = (settings as Record<string, unknown>).currency;
  return typeof raw === "string" && /^[A-Za-z]{3}$/.test(raw.trim()) ? raw.trim().toUpperCase() : ORG_CURRENCY_FALLBACK;
}

/** Money in the org currency, compact above a thousand ("$12.4K", "₹1.2M"). */
export function formatOrgMoney(amount: number, currency: string, locale?: string): string {
  const compact = Math.abs(amount) >= 1_000;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString(locale)}`;
  }
}
