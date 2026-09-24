import { describe, expect, it } from "vitest";
import { BAR_DEFAULT, FILL_SWATCHES, FIND_CURRENT_BG, FIND_MATCH_BG, RULE_COLORS, SCALE_DEFAULT, TEXT_SWATCHES } from "./sheet-palette";

// These values are written into stored rows and columns. A CSS variable here
// would persist a theme-dependent colour into data the public embed and every
// other client read, so the invariant is: literal colours only.
const HEX6 = /^#[0-9A-Fa-f]{6}$/;

describe("sheet palettes are data colours, never tokens", () => {
  it("every swatch, rule, scale and bar colour is a six-digit hex literal", () => {
    const all = [
      ...TEXT_SWATCHES.map((s) => s.hex),
      ...FILL_SWATCHES.map((s) => s.hex),
      ...RULE_COLORS,
      SCALE_DEFAULT.min, SCALE_DEFAULT.mid, SCALE_DEFAULT.max,
      BAR_DEFAULT,
      FIND_CURRENT_BG,
    ];
    for (const c of all) expect(c).toMatch(HEX6);
    expect(FIND_MATCH_BG).not.toContain("var(");
  });

  it("toolbar swatches are upper case, because the checked state compares stored.toUpperCase() to them", () => {
    for (const s of [...TEXT_SWATCHES, ...FILL_SWATCHES]) expect(s.hex).toBe(s.hex.toUpperCase());
  });

  it("swatch names are unique within each palette, so the menu never shows two rows with one label", () => {
    for (const list of [TEXT_SWATCHES, FILL_SWATCHES]) {
      expect(new Set(list.map((s) => s.name)).size).toBe(list.length);
    }
  });
});
