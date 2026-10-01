import { describe, expect, it } from "vitest";
import { ACCENT_CHOICE_OFFERED, ACCENT_KEYS, OFFERED_ACCENTS, effectiveAccent, normalizeAccent } from "./accents";

describe("one blue", () => {
  it("offers only the brand blue, so every Accent row hides itself", () => {
    expect(OFFERED_ACCENTS).toEqual(["workwrk"]);
    expect(ACCENT_CHOICE_OFFERED).toBe(false);
  });
  it("paints the brand blue for any stored accent, keeping the stored value readable", () => {
    expect(normalizeAccent("mint")).toBe("mint");
    expect(effectiveAccent("mint")).toBe("workwrk");
    expect(effectiveAccent("pink")).toBe("workwrk");
    expect(effectiveAccent(undefined)).toBe("workwrk");
  });
  it("has no pink or purple family in the vocabulary", () => {
    for (const k of ["pink", "purple", "violet", "indigo", "grape"]) expect(ACCENT_KEYS as readonly string[]).not.toContain(k);
  });
});
