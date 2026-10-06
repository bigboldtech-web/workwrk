import { describe, expect, it } from "vitest";
import { clampText } from "./clamp";

const wellFormed = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("clampText", () => {
  it("keeps text within the limit as it is", () => {
    expect(clampText("Call Acme", 20)).toBe("Call Acme");
    expect(clampText("", 5)).toBe("");
  });

  it("never ends on half an emoji", () => {
    // 2,999 letters and then an emoji: a plain slice at 3,000 keeps half of it.
    const text = `${"a".repeat(2999)}🎉 done`;
    expect(wellFormed(text.slice(0, 3000))).toBe(false);
    const cut = clampText(text, 3000);
    expect(cut).toBe("a".repeat(2999));
    expect(wellFormed(cut)).toBe(true);
    // The JSON a JSON column receives has no lone surrogate escape.
    expect(JSON.stringify({ text: cut })).not.toMatch(/\\ud8/i);
  });

  it("keeps a whole emoji that fits", () => {
    expect(clampText("ab🎉cd", 4)).toBe("ab🎉");
  });
});
