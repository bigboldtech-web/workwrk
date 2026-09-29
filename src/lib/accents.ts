// The accent keys the Customize panel offers and the API accepts. One list,
// so the picker, the schema and os.css can never disagree. "workwrk" is the
// brand blue and carries no CSS override; every other key rebinds the brand
// aliases in os.css. No purple family: the brand palette (YBRG) rules purple
// out, and the design system deleted those swatches by name.

export const ACCENT_KEYS = ["workwrk", "black", "blue", "pink", "orange", "teal", "bronze", "mint"] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];

export const ACCENT_LABELS: Record<AccentKey, string> = {
  workwrk: "WorkwrK blue",
  black: "Black",
  blue: "Blue",
  pink: "Pink",
  orange: "Orange",
  teal: "Teal",
  bronze: "Bronze",
  mint: "Mint",
};

export function isAccentKey(v: unknown): v is AccentKey {
  return typeof v === "string" && (ACCENT_KEYS as readonly string[]).includes(v);
}

/**
 * The read-time normaliser (settings spec section 3, `accents`): any stored
 * accent, org or personal, resolves to a key the product still draws, and
 * anything else (a retired purple hue, a typo, a non-string) resolves to the
 * brand blue. Readers call this rather than trusting the column, so a value
 * written before a swatch was retired can never paint an undefined theme.
 */
export function normalizeAccent(v: unknown): AccentKey {
  return isAccentKey(v) ? v : "workwrk";
}
