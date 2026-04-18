export type Currency =
  | "USD"
  | "EUR"
  | "GBP"
  | "CAD"
  | "AUD"
  | "NZD"
  | "INR"
  | "JPY"
  | "KRW"
  | "CNY"
  | "SGD"
  | "AED"
  | "SAR"
  | "ILS"
  | "BRL"
  | "MXN"
  | "CHF"
  | "SEK"
  | "NOK"
  | "DKK"
  | "PLN";

export interface CurrencyInfo {
  code: Currency;
  symbol: string;
  name: string;
  /** Rough FX multiplier relative to 1 USD. Refresh via an FX API in production. */
  usdRate: number;
  /** Locale used for Intl.NumberFormat. */
  formatLocale: string;
}

export const currencies: Record<Currency, CurrencyInfo> = {
  USD: { code: "USD", symbol: "$", name: "US Dollar", usdRate: 1, formatLocale: "en-US" },
  EUR: { code: "EUR", symbol: "€", name: "Euro", usdRate: 0.92, formatLocale: "de-DE" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", usdRate: 0.79, formatLocale: "en-GB" },
  CAD: { code: "CAD", symbol: "CA$", name: "Canadian Dollar", usdRate: 1.36, formatLocale: "en-CA" },
  AUD: { code: "AUD", symbol: "A$", name: "Australian Dollar", usdRate: 1.52, formatLocale: "en-AU" },
  NZD: { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", usdRate: 1.64, formatLocale: "en-NZ" },
  INR: { code: "INR", symbol: "₹", name: "Indian Rupee", usdRate: 83.5, formatLocale: "en-IN" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen", usdRate: 151, formatLocale: "ja-JP" },
  KRW: { code: "KRW", symbol: "₩", name: "South Korean Won", usdRate: 1340, formatLocale: "ko-KR" },
  CNY: { code: "CNY", symbol: "¥", name: "Chinese Yuan", usdRate: 7.25, formatLocale: "zh-CN" },
  SGD: { code: "SGD", symbol: "S$", name: "Singapore Dollar", usdRate: 1.34, formatLocale: "en-SG" },
  AED: { code: "AED", symbol: "AED", name: "UAE Dirham", usdRate: 3.67, formatLocale: "ar-AE" },
  SAR: { code: "SAR", symbol: "SAR", name: "Saudi Riyal", usdRate: 3.75, formatLocale: "ar-SA" },
  ILS: { code: "ILS", symbol: "₪", name: "Israeli Shekel", usdRate: 3.7, formatLocale: "he-IL" },
  BRL: { code: "BRL", symbol: "R$", name: "Brazilian Real", usdRate: 5.0, formatLocale: "pt-BR" },
  MXN: { code: "MXN", symbol: "MX$", name: "Mexican Peso", usdRate: 17.0, formatLocale: "es-MX" },
  CHF: { code: "CHF", symbol: "CHF", name: "Swiss Franc", usdRate: 0.88, formatLocale: "de-CH" },
  SEK: { code: "SEK", symbol: "kr", name: "Swedish Krona", usdRate: 10.6, formatLocale: "sv-SE" },
  NOK: { code: "NOK", symbol: "kr", name: "Norwegian Krone", usdRate: 10.8, formatLocale: "nb-NO" },
  DKK: { code: "DKK", symbol: "kr", name: "Danish Krone", usdRate: 6.9, formatLocale: "da-DK" },
  PLN: { code: "PLN", symbol: "zł", name: "Polish Złoty", usdRate: 4.0, formatLocale: "pl-PL" },
};

export const defaultCurrency: Currency = "USD";

/** ISO 3166-1 alpha-2 country → preferred currency. */
export const countryToCurrency: Record<string, Currency> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  ES: "EUR",
  IT: "EUR",
  PT: "EUR",
  GR: "EUR",
  FI: "EUR",
  LU: "EUR",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  AU: "AUD",
  NZ: "NZD",
  IN: "INR",
  JP: "JPY",
  KR: "KRW",
  CN: "CNY",
  HK: "USD",
  SG: "SGD",
  AE: "AED",
  SA: "SAR",
  IL: "ILS",
  BR: "BRL",
  MX: "MXN",
};

export function isCurrency(value: string): value is Currency {
  return value in currencies;
}

/** Convert an amount from USD to the target currency. */
export function convertFromUSD(amountUsd: number, target: Currency): number {
  return amountUsd * currencies[target].usdRate;
}

/** Format an amount already in the target currency using Intl. */
export function formatMoney(amount: number, currency: Currency): string {
  const info = currencies[currency];
  try {
    return new Intl.NumberFormat(info.formatLocale, {
      style: "currency",
      currency: info.code,
      maximumFractionDigits: info.code === "JPY" || info.code === "KRW" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${info.symbol}${amount.toFixed(2)}`;
  }
}

/** Convert USD → currency and format in one step. */
export function formatFromUSD(amountUsd: number, currency: Currency): string {
  return formatMoney(convertFromUSD(amountUsd, currency), currency);
}
