// FX rate provider.
//
// We touch FX in three places: paystubs paid in a currency other
// than the org's reporting currency, expenses incurred abroad,
// invoices in a foreign currency. For consistency, every conversion
// goes through this single helper so the rate source can swap
// without touching call sites.
//
// Today this is a stub that returns 1.0 unless the source matches
// the target. When the user picks a real source (open.er-api.com,
// FreeForexAPI, OpenExchangeRates, exchange-rates.io) the body of
// `getRate` swaps for an authenticated fetch with caching. Caching
// is essential — FX rates change at most hourly, so a per-request
// fetch would multiply latency for no accuracy gain.

export type FxRate = {
  source: string;        // ISO currency code, e.g. "EUR"
  target: string;        // ISO currency code, e.g. "USD"
  rate: number;          // 1 source = `rate` target
  asOf: Date;            // when the rate was published
  provider: string;      // "stub" | "open-er-api" | …
};

const STUB_TABLE: Record<string, Record<string, number>> = {
  USD: { EUR: 0.92, GBP: 0.79, INR: 84.0, AED: 3.67, SGD: 1.34, AUD: 1.51, CAD: 1.36 },
  EUR: { USD: 1.09, GBP: 0.86, INR: 91.4 },
  GBP: { USD: 1.27, EUR: 1.16 },
  INR: { USD: 0.012 },
};

export async function getRate(source: string, target: string): Promise<FxRate> {
  const s = source.trim().toUpperCase();
  const t = target.trim().toUpperCase();
  if (s === t) {
    return { source: s, target: t, rate: 1, asOf: new Date(), provider: "identity" };
  }
  const direct = STUB_TABLE[s]?.[t];
  if (direct !== undefined) {
    return { source: s, target: t, rate: direct, asOf: new Date(), provider: "stub" };
  }
  const inverse = STUB_TABLE[t]?.[s];
  if (inverse !== undefined) {
    return { source: s, target: t, rate: 1 / inverse, asOf: new Date(), provider: "stub-inverse" };
  }
  // Bridge through USD when neither direction is in the table.
  const sToUsd = STUB_TABLE[s]?.USD ?? (STUB_TABLE.USD?.[s] ? 1 / STUB_TABLE.USD[s] : null);
  const usdToT = STUB_TABLE.USD?.[t] ?? null;
  if (sToUsd != null && usdToT != null) {
    return { source: s, target: t, rate: sToUsd * usdToT, asOf: new Date(), provider: "stub-bridge-usd" };
  }
  throw new Error(`No FX rate available for ${s} → ${t}. Configure a real provider.`);
}

/** Convenience helper — convert a single amount and return the new value. */
export async function convert(amount: number, source: string, target: string): Promise<{ amount: number; rate: FxRate }> {
  const rate = await getRate(source, target);
  return { amount: amount * rate.rate, rate };
}
