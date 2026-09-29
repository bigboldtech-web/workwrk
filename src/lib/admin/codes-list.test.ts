import { describe, expect, it } from "vitest";
import {
  activeCodeFilterCount,
  codeFilterWhere,
  codeGives,
  codeViewWhere,
  codesQuery,
  parseCodeListParams,
  parseImport,
  TIER_PRESETS,
} from "./codes-list";

const sp = (s: string) => new URLSearchParams(s);

describe("parseCodeListParams", () => {
  it("reads the view, and the old `filter` name for it", () => {
    expect(parseCodeListParams(sp("view=redeemed")).view).toBe("redeemed");
    expect(parseCodeListParams(sp("filter=refunded")).view).toBe("refunded");
    expect(parseCodeListParams(sp("view=nope")).view).toBe("all");
  });
  it("counts Code as a filter, so ?code= from a company page shows on the chip", () => {
    const p = parseCodeListParams(sp("code=AS-12&tier=2,9&plan=SCALE&redeemed_by=cmabc12345"));
    expect(p.tiers).toEqual([2]);
    expect(activeCodeFilterCount(p)).toBe(4);
    expect(codesQuery(p)).toBe("?code=AS-12&tier=2&plan=SCALE&redeemed_by=cmabc12345");
  });
  it("refuses a company id that is not an id", () => {
    expect(parseCodeListParams(sp("redeemed_by=%25%25")).redeemedBy).toBeNull();
  });
});

describe("codeViewWhere", () => {
  it("gives every code exactly one status, a refund winning", () => {
    expect(codeViewWhere("unused")).toEqual({ redeemedAt: null, refundedAt: null });
    expect(codeViewWhere("redeemed")).toEqual({ redeemedAt: { not: null }, refundedAt: null });
    expect(codeViewWhere("refunded")).toEqual({ refundedAt: { not: null } });
  });
  it("an empty filter set is no clause", () => {
    expect(codeFilterWhere(parseCodeListParams(sp("")))).toEqual({});
  });
});

describe("codeGives", () => {
  it("writes Unlimited, never the infinity glyph", () => {
    expect(codeGives({ tier: 3, plan: "ENTERPRISE", seats: 999_999 })).toBe("Tier 3 · Enterprise · Unlimited");
    expect(codeGives({ tier: 2, plan: "SCALE", seats: 25 })).toBe("Tier 2 · Scale · 25 seats");
    expect(codeGives({ tier: 1, plan: "GROWTH", seats: 1 })).toBe("Tier 1 · Growth · 1 seat");
  });
  it("keeps the three decided presets", () => {
    expect(TIER_PRESETS.map((p) => [p.tier, p.plan, p.seats])).toEqual([[1, "GROWTH", 5], [2, "SCALE", 25], [3, "ENTERPRISE", 999_999]]);
  });
});

describe("parseImport", () => {
  it("ignores parts after the fourth, as the old importer did", () => {
    const r = parseImport("AAA, 2, GROWTH, 10, extra, more\n", { tier: 1, plan: "STARTER", seats: 1 });
    expect(r).toMatchObject({ ok: true, rows: [{ code: "AAA", tier: 2, plan: "GROWTH", seats: 10 }] });
  });
  const preset = TIER_PRESETS[0];
  it("uses the preset, skips blank and # lines, and sends a repeated code once", () => {
    const r = parseImport("# header\nAAA\n\nBBB\nAAA\n", preset);
    expect(r).toEqual({
      ok: true,
      rows: [
        { code: "AAA", tier: 1, plan: "GROWTH", seats: 5 },
        { code: "BBB", tier: 1, plan: "GROWTH", seats: 5 },
      ],
      duplicatesInPaste: 1,
    });
  });
  it("applies a full or partial per-line override", () => {
    const r = parseImport("CCC, 2, scale, 30\nDDD,3", preset);
    expect(r.ok && r.rows).toEqual([
      { code: "CCC", tier: 2, plan: "SCALE", seats: 30 },
      { code: "DDD", tier: 3, plan: "GROWTH", seats: 5 },
    ]);
  });
  it("names the first bad line by number", () => {
    expect(parseImport("AAA\nBBB,2,PRO,5", preset)).toEqual({ ok: false, error: "Line 2: plan PRO is not a plan." });
    expect(parseImport("AAA,9", preset)).toEqual({ ok: false, error: "Line 1: tier 9 is not a tier from 1 to 5." });
    expect(parseImport("AAA,1,GROWTH,0", preset)).toEqual({ ok: false, error: "Line 1: seats 0 is not a whole number of 1 or more." });
    expect(parseImport("A A", preset)).toEqual({ ok: false, error: "Line 1: a code has no spaces in it." });
  });
  it("treats codes as case-sensitive and keeps a # inside a code", () => {
    const r = parseImport("abc\nABC\nAB#C", preset);
    expect(r.ok && r.rows.map((x) => x.code)).toEqual(["abc", "ABC", "AB#C"]);
  });
  it("refuses an empty paste", () => {
    expect(parseImport("\n# only a comment\n", preset)).toEqual({ ok: false, error: "Paste at least one code." });
  });
});
