// The four dots, on their own (design-system section 7, the brand quarantine).
//
// This module exists for one reason, and it is a bundle boundary rather
// than a design one: `DOT_HEX` used to live in data/tuesday.ts, which
// imports the 850 line Tuesday fixture at module scope. Any CLIENT
// component that wanted the dot colours, the receipt in the calculator
// island being the first, pulled the whole storyboard into the browser with
// four hex values.
//
// So the colours live here, imported from src/components/brand, which is
// still the only place the four hexes are written down. tuesday.ts
// re-exports these, so every existing import keeps working and there is
// exactly one definition.

import { BRAND_BLUE, BRAND_GREEN, BRAND_RED, BRAND_YELLOW } from "@/components/brand/logo";

export type DotColor = "yellow" | "blue" | "red" | "green";

/** The four brand hexes, in the loader's order. IMPORTED, never retyped. */
export const DOT_HEX: Record<DotColor, string> = {
  yellow: BRAND_YELLOW,
  blue: BRAND_BLUE,
  red: BRAND_RED,
  green: BRAND_GREEN,
};

/** The dots-loader rhythm: the timing signature of every pulse on the site. */
export const DOT_ORDER: DotColor[] = ["yellow", "blue", "red", "green"];
