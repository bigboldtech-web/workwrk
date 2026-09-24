import { describe, expect, it } from "vitest";
import { blankTail, isBlankValues, reservedKeysOf } from "./sheet-blank-tail";

describe("isBlankValues", () => {
  it("treats null, empty text, empty lists and layout keys as blank", () => {
    expect(isBlankValues({})).toBe(true);
    expect(isBlankValues({ a: null, b: "", c: [], d: {}, $fmt: { a: { b: true } }, $rh: 40 })).toBe(true);
    expect(isBlankValues(null)).toBe(true);
  });
  it("treats any value, a zero, false or a formula as data", () => {
    expect(isBlankValues({ a: 0 })).toBe(false);
    expect(isBlankValues({ a: false })).toBe(false);
    expect(isBlankValues({ a: { "=": "1+1" } })).toBe(false);
  });
});

describe("blankTail", () => {
  it("is every row of a fresh table", () => {
    const rows = [{ values: {} }, { values: {} }];
    expect(blankTail(rows)).toHaveLength(2);
  });
  it("starts after the last row holding data, not the first blank", () => {
    const rows = [{ id: 1, values: { a: "x" } }, { id: 2, values: {} }, { id: 3, values: { a: "y" } }, { id: 4, values: {} }, { id: 5, values: { $rh: 50 } }];
    expect(blankTail(rows).map((r) => r.id)).toEqual([4, 5]);
  });
  it("is empty when the last row holds data", () => {
    expect(blankTail([{ values: {} }, { values: { a: 1 } }])).toEqual([]);
  });
  it("keeps a reused row's layout keys", () => {
    expect(reservedKeysOf({ $fmt: { a: 1 }, a: "" })).toEqual({ $fmt: { a: 1 } });
  });
});
