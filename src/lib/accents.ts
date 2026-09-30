// The accent keys the Customize panel offers and the API accepts. One list,
// so the picker, the schema and os.css can never disagree. "workwrk" is the
// brand blue and carries no CSS override; every other key rebinds the brand
// aliases in os.css. No purple family: the brand palette (YBRG) rules purple
// out, and the design system deleted those swatches by name (pink too,
// settings-architecture 4.2: it normalises to workwrk on read).

export const ACCENT_KEYS = ["workwrk", "black", "blue", "orange", "teal", "bronze", "mint"] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];

export const ACCENT_LABELS: Record<AccentKey, string> = {
  workwrk: "WorkwrK blue",
  black: "Black",
  blue: "Blue",
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

/**
 * The accents the product OFFERS today. The founder took "one blue"
 * (settings-architecture 12, decision 5; Phase 2 Q4): the list has one entry,
 * so every Accent row hides itself (Customize, Workspace settings > Identity >
 * Appearance) and every stored accent paints the brand blue. The vocabulary
 * above, the schema and the os.css blocks stay, so reversing the decision is
 * this one constant and nobody's stored choice is lost.
 */
export const OFFERED_ACCENTS: readonly AccentKey[] = ["workwrk"];

/** True while there is a choice to offer (more than the brand blue). */
export const ACCENT_CHOICE_OFFERED = OFFERED_ACCENTS.length > 1;

/** The accent to paint: a stored key the product still offers, else the brand blue. */
export function effectiveAccent(v: unknown): AccentKey {
  const key = normalizeAccent(v);
  return OFFERED_ACCENTS.includes(key) ? key : "workwrk";
}
