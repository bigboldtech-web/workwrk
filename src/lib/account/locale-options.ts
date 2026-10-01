// The Language & region choices (spec-account-auth `/account/preferences`
// tab 2). Pure; tested. Every option names a real reader:
//   language    src/i18n/request.ts (through the NEXT_LOCALE cookie that
//               ThemeApplier writes) and src/lib/format/date.ts
//   timezone    src/lib/format/date.ts, the work buckets, the timesheet punch
//   weekStart   the planner calendar grid and My work
//   dateFormat  src/lib/format/date.ts resolveDateOrder (DMY, MDY, YMD)
//   timeFormat  src/lib/format/date.ts

import { locales, localeNames, type Locale } from "@/i18n/config";

export const LANGUAGE_OPTIONS: readonly { value: Locale; label: string }[] = locales.map((l) => ({ value: l, label: localeNames[l] }));

/** The cookie value for a stored language, or null when it is not a wired catalog. */
export function localeCookieFor(language: string | null | undefined): Locale | null {
  if (!language) return null;
  const base = language.toLowerCase().split(/[-_]/)[0];
  return (locales as readonly string[]).includes(base) ? (base as Locale) : null;
}

export const DATE_FORMAT_OPTIONS: readonly { value: "DMY" | "MDY" | "YMD"; label: string }[] = [
  { value: "DMY", label: "31/12/2026" },
  { value: "MDY", label: "12/31/2026" },
  { value: "YMD", label: "2026-12-31" },
];

/** weekStart is stored as a day number (0 = Sunday, 1 = Monday). */
export const WEEK_START_OPTIONS: readonly { value: "1" | "0"; label: string }[] = [
  { value: "1", label: "Monday" },
  { value: "0", label: "Sunday" },
];

export const TIME_FORMAT_OPTIONS: readonly { value: "24h" | "12h"; label: string }[] = [
  { value: "24h", label: "24 hour" },
  { value: "12h", label: "12 hour" },
];

/** The browser's IANA zone, or null. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Every IANA zone the runtime knows, with the stored one kept even when unknown (never silently replaced). */
export function timeZoneOptions(stored?: string | null): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    zones = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = ["UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"];
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  if (stored && !zones.includes(stored)) zones = [stored, ...zones];
  return zones;
}
