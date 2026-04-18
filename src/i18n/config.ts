export const locales = [
  "en",
  "es",
  "fr",
  "de",
  "nl",
  "it",
  "pt",
  "ja",
  "ko",
  "zh",
  "ar",
  "he",
  "hi",
  "sv",
  "no",
  "da",
  "fi",
  "pl",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
  it: "Italiano",
  pt: "Português",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  ar: "العربية",
  he: "עברית",
  hi: "हिन्दी",
  sv: "Svenska",
  no: "Norsk",
  da: "Dansk",
  fi: "Suomi",
  pl: "Polski",
};

export const rtlLocales: Locale[] = ["ar", "he"];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
