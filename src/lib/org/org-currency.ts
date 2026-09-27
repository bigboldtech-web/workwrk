// The workspace's currency (settings.currency, edited on Settings > Locale
// and work week), read once for every money figure on screen
// (spec-tools-misc section 3 useOrgCurrency). Pure, with the hook beside it.
//
// The fallback is USD, which is what every page that hard-coded a currency
// (Assets among them) already showed, so an org that never set the field
// sees exactly what it saw before.
//
// Two shapes. Compact ("$12.4K") is for a total in a footer or a tile.
// Exact ("$12,400" or "$1,234.50") is for a record: a register row, a
// drawer field, anything a person typed and expects to read back as typed.

export const ORG_CURRENCY_FALLBACK = "USD";

/** A three-letter ISO code from the org settings, or the fallback. */
export function orgCurrencyFromSettings(settings: unknown): string {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return ORG_CURRENCY_FALLBACK;
  const raw = (settings as Record<string, unknown>).currency;
  return typeof raw === "string" && /^[A-Za-z]{3}$/.test(raw.trim()) ? raw.trim().toUpperCase() : ORG_CURRENCY_FALLBACK;
}

export interface OrgMoneyOptions {
  /** The full figure with grouping, cents only when there are any. Default: compact above a thousand. */
  exact?: boolean;
}

/** Money in the org currency: compact above a thousand ("$12.4K", "₹1.2M"), or exact. */
export function formatOrgMoney(amount: number, currency: string, locale?: string, opts?: OrgMoneyOptions): string {
  const compact = !opts?.exact && Math.abs(amount) >= 1_000;
  const hasCents = opts?.exact ? Math.abs(amount % 1) > 0.000001 : false;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: compact ? 1 : hasCents ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${(opts?.exact ? amount : Math.round(amount)).toLocaleString(locale)}`;
  }
}
