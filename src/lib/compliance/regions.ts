/**
 * Maps a visitor's country (ISO 3166-1 alpha-2) to a regulatory regime.
 * The regime decides which consent UX to show:
 *  - OPT_IN_STRICT: EU/EEA, UK, Switzerland, Brazil, India (DPDPA), China (PIPL),
 *    Thailand, South Korea. No non-essential cookies until explicit consent.
 *  - OPT_OUT: California (CCPA/CPRA), Colorado, Virginia, Connecticut, Utah, etc.
 *    Can set cookies, but must surface "Do Not Sell or Share" and honor opt-out.
 *  - NOTICE_ONLY: US (non-covered states), most of the world. Banner required
 *    for transparency but no prior consent mandate.
 */

export type ConsentRegime = "OPT_IN_STRICT" | "OPT_OUT" | "NOTICE_ONLY";

const EU_EEA_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // EEA non-EU
  "IS", "LI", "NO",
]);

const OPT_IN_COUNTRIES = new Set([
  ...EU_EEA_COUNTRIES,
  "GB", // UK-GDPR + PECR
  "CH", // revFADP
  "BR", // LGPD
  "IN", // DPDPA 2023
  "CN", // PIPL (also requires cross-border transfer consent)
  "KR", // PIPA
  "TH", // PDPA
  "JP", // APPI (notice-based but opt-in recommended for marketing)
  "CA", // PIPEDA — opt-in for sensitive, implied OK for non-sensitive, we default to strict
  "AU", // Privacy Act / APP
  "SG", // PDPA
  "NZ", // Privacy Act 2020
  "TR", // KVKK
  "ZA", // POPIA
  "AE", // UAE Personal Data Protection Law
  "SA", // PDPL
  "IL", // Protection of Privacy Law
  "MX", // LFPDPPP
  "AR", // PDPA
  "CO", // Colombia data law
  "RU", // Personal Data Law
]);

/** US states with comprehensive consumer privacy laws (opt-out regimes). */
const US_OPT_OUT_STATES = new Set([
  "CA", "CO", "CT", "UT", "VA", "TX", "OR", "MT", "IA", "DE", "NH", "NJ", "IN", "TN", "MN",
]);

export function resolveRegime(country?: string | null, region?: string | null): ConsentRegime {
  const c = country?.toUpperCase() ?? "";
  if (!c) return "OPT_IN_STRICT"; // safest default when we don't know

  if (OPT_IN_COUNTRIES.has(c)) return "OPT_IN_STRICT";

  if (c === "US") {
    const r = region?.toUpperCase() ?? "";
    if (US_OPT_OUT_STATES.has(r)) return "OPT_OUT";
    return "NOTICE_ONLY";
  }

  return "NOTICE_ONLY";
}

/** Short string summarizing the region for logging/analytics. */
export function regimeLabel(
  country?: string | null,
  region?: string | null,
): string {
  const c = country?.toUpperCase() ?? "";
  if (EU_EEA_COUNTRIES.has(c)) return "EU-EEA";
  if (c === "GB") return "UK";
  if (c === "CH") return "CH";
  if (c === "BR") return "BR";
  if (c === "IN") return "IN";
  if (c === "US") {
    const r = region?.toUpperCase() ?? "";
    return r ? `US-${r}` : "US";
  }
  return c || "ROW";
}
