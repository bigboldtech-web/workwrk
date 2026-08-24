import { describe, expect, it } from "vitest";

import {
  CELL_STYLE_KEY,
  ROW_HEIGHT_KEY,
  isReservedKey,
  readCellStyle,
  styleToCss,
  withCellStyle,
  type CellStyle,
} from "./sheet-cell-style";

describe("isReservedKey", () => {
  it("recognises exactly the $fmt and $rh keys", () => {
    expect(CELL_STYLE_KEY).toBe("$fmt");
    expect(ROW_HEIGHT_KEY).toBe("$rh");
    expect(isReservedKey("$fmt")).toBe(true);
    expect(isReservedKey("$rh")).toBe(true);
    expect(isReservedKey("fmt")).toBe(false);
    expect(isReservedKey("rh")).toBe(false);
    expect(isReservedKey("$")).toBe(false);
    expect(isReservedKey("$rhx")).toBe(false);
    expect(isReservedKey("clx1abc")).toBe(false);
    expect(isReservedKey("")).toBe(false);
  });
});

describe("$rh is not a style map", () => {
  it("readCellStyle never reads it as a column, even when it holds junk", () => {
    // A stored $rh is a plain number; asking for "column $rh" must be
    // undefined regardless of what the key holds.
    expect(readCellStyle({ [ROW_HEIGHT_KEY]: 64 }, ROW_HEIGHT_KEY)).toBeUndefined();
    expect(readCellStyle({ [CELL_STYLE_KEY]: { [ROW_HEIGHT_KEY]: { b: true } } }, ROW_HEIGHT_KEY)).toBeUndefined();
  });

  it("withCellStyle refuses to style it and leaves the stored height alone", () => {
    const values = { a: "x", [ROW_HEIGHT_KEY]: 64 };
    const out = withCellStyle(values, ROW_HEIGHT_KEY, { b: true });
    expect(out).toEqual(values);   // no $fmt entry appeared
    expect(out).not.toBe(values);  // still copy-on-write
    // Styling a REAL column doesn't disturb the sibling height key.
    const out2 = withCellStyle(values, "a", { b: true });
    expect(out2[ROW_HEIGHT_KEY]).toBe(64);
  });
});

describe("readCellStyle", () => {
  it("returns undefined for missing values / missing map / missing column", () => {
    expect(readCellStyle(undefined, "a")).toBeUndefined();
    expect(readCellStyle({}, "a")).toBeUndefined();
    expect(readCellStyle({ a: 1 }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { b: { b: true } } }, "a")).toBeUndefined();
  });

  it("reads a stored style", () => {
    const values = { a: "x", $fmt: { a: { b: true, c: "#f00", a: "r" } } };
    expect(readCellStyle(values, "a")).toEqual({ b: true, c: "#f00", a: "r" });
  });

  it("never treats the reserved key itself as a column", () => {
    expect(readCellStyle({ $fmt: { $fmt: { b: true } } }, "$fmt")).toBeUndefined();
  });

  it("tolerates garbage $fmt: string / null / array / number", () => {
    expect(readCellStyle({ $fmt: "x" }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: null }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: [{ a: { b: true } }] }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: 7 }, "a")).toBeUndefined();
  });

  it("tolerates garbage entries and drops malformed flags", () => {
    expect(readCellStyle({ $fmt: { a: "bold" } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: null } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: [] } }, "a")).toBeUndefined();
    // b:false is not a flag; a:"middle" is not an alignment; c:"" is not a colour.
    expect(readCellStyle({ $fmt: { a: { b: false, a: "middle", c: "", i: true } } }, "a")).toEqual({ i: true });
    // An entry whose every flag is malformed reads as unstyled.
    expect(readCellStyle({ $fmt: { a: { b: 1, u: "yes" } } }, "a")).toBeUndefined();
  });
});

describe("readCellStyle: number format (nf / dp)", () => {
  it("reads a stored nf and dp", () => {
    expect(readCellStyle({ $fmt: { a: { nf: "currency", dp: 2 } } }, "a")).toEqual({ nf: "currency", dp: 2 });
    expect(readCellStyle({ $fmt: { a: { nf: "percent", dp: 0 } } }, "a")).toEqual({ nf: "percent", dp: 0 });
    expect(readCellStyle({ $fmt: { a: { nf: "number" } } }, "a")).toEqual({ nf: "number" });
  });

  it("drops an unknown nf", () => {
    expect(readCellStyle({ $fmt: { a: { nf: "bogus", dp: 2 } } }, "a")).toEqual({ dp: 2 });
    expect(readCellStyle({ $fmt: { a: { nf: "CURRENCY" } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { nf: "" } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { nf: 1 } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { nf: null } } }, "a")).toBeUndefined();
    // "date" / "checkbox" are column-level choices, never a cell nf.
    expect(readCellStyle({ $fmt: { a: { nf: "date" } } }, "a")).toBeUndefined();
  });

  it("rejects a non-number dp, floors a fraction, clamps to 0..10", () => {
    expect(readCellStyle({ $fmt: { a: { dp: "2" } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { dp: null } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { dp: true } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { dp: NaN } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { dp: Infinity } } }, "a")).toBeUndefined();
    expect(readCellStyle({ $fmt: { a: { dp: 2.7 } } }, "a")).toEqual({ dp: 2 });
    expect(readCellStyle({ $fmt: { a: { dp: -1 } } }, "a")).toEqual({ dp: 0 });
    expect(readCellStyle({ $fmt: { a: { dp: 99 } } }, "a")).toEqual({ dp: 10 });
    expect(readCellStyle({ $fmt: { a: { dp: 10 } } }, "a")).toEqual({ dp: 10 });
    expect(readCellStyle({ $fmt: { a: { dp: 0 } } }, "a")).toEqual({ dp: 0 });
  });

  it("keeps nf/dp alongside the text flags", () => {
    expect(readCellStyle({ $fmt: { a: { b: true, nf: "percent", dp: 1, a: "r" } } }, "a")).toEqual({
      b: true,
      a: "r",
      nf: "percent",
      dp: 1,
    });
  });
});

describe("withCellStyle", () => {
  it("round-trips a style through read", () => {
    const values = { a: "x", b: 2 };
    const next = withCellStyle(values, "a", { b: true, bg: "#ffe" });
    expect(readCellStyle(next, "a")).toEqual({ b: true, bg: "#ffe" });
    expect(next).toEqual({ a: "x", b: 2, $fmt: { a: { b: true, bg: "#ffe" } } });
  });

  it("merges into an existing entry without touching siblings", () => {
    const values = { $fmt: { a: { b: true }, b: { i: true } } };
    const next = withCellStyle(values, "a", { u: true });
    expect(readCellStyle(next, "a")).toEqual({ b: true, u: true });
    expect(readCellStyle(next, "b")).toEqual({ i: true });
  });

  it("replaces a scalar flag value (alignment / colour)", () => {
    const values = withCellStyle({}, "a", { a: "l", c: "#111" });
    const next = withCellStyle(values, "a", { a: "r", c: "#222" });
    expect(readCellStyle(next, "a")).toEqual({ a: "r", c: "#222" });
  });

  it("removes a flag on undefined / null / false / empty string", () => {
    const base = withCellStyle({}, "a", { b: true, i: true, c: "#f00", bg: "#0f0" });
    expect(readCellStyle(withCellStyle(base, "a", { b: undefined }), "a")).toEqual({ i: true, c: "#f00", bg: "#0f0" });
    expect(readCellStyle(withCellStyle(base, "a", { i: null }), "a")).toEqual({ b: true, c: "#f00", bg: "#0f0" });
    expect(readCellStyle(withCellStyle(base, "a", { c: false }), "a")).toEqual({ b: true, i: true, bg: "#0f0" });
    expect(readCellStyle(withCellStyle(base, "a", { bg: "" }), "a")).toEqual({ b: true, i: true, c: "#f00" });
  });

  it("removes the column entry when the merge result is empty", () => {
    const values = { $fmt: { a: { b: true }, b: { i: true } } };
    const next = withCellStyle(values, "a", { b: undefined });
    expect(next).toEqual({ $fmt: { b: { i: true } } });
    expect(readCellStyle(next, "a")).toBeUndefined();
  });

  it("removes the column entry on a null patch", () => {
    const values = { x: 1, $fmt: { a: { b: true, c: "#f00" }, b: { i: true } } };
    expect(withCellStyle(values, "a", null)).toEqual({ x: 1, $fmt: { b: { i: true } } });
  });

  it("removes the $fmt key entirely when the map empties", () => {
    const values = { x: 1, $fmt: { a: { b: true } } };
    expect(withCellStyle(values, "a", null)).toEqual({ x: 1 });
    expect(withCellStyle(values, "a", { b: undefined })).toEqual({ x: 1 });
    expect(CELL_STYLE_KEY in withCellStyle(values, "a", null)).toBe(false);
  });

  it("is a no-op that still returns a copy when clearing an unstyled cell", () => {
    const values = { x: 1 };
    const next = withCellStyle(values, "a", null);
    expect(next).toEqual({ x: 1 });
    expect(next).not.toBe(values);
  });

  it("never mutates the input values or its nested map", () => {
    const inner = { a: { b: true as const } };
    const values = { x: 1, $fmt: inner };
    const snapshot = JSON.stringify(values);
    const next = withCellStyle(values, "a", { i: true });
    withCellStyle(values, "a", null);
    withCellStyle(values, "b", { u: true });
    expect(JSON.stringify(values)).toBe(snapshot);
    expect(values.$fmt).toBe(inner);
    expect(inner.a).toEqual({ b: true });
    expect(next.$fmt).not.toBe(inner);
  });

  it("treats a garbage $fmt as empty and overwrites it", () => {
    expect(withCellStyle({ $fmt: "x" }, "a", { b: true })).toEqual({ $fmt: { a: { b: true } } });
    expect(withCellStyle({ $fmt: null }, "a", { b: true })).toEqual({ $fmt: { a: { b: true } } });
    expect(withCellStyle({ $fmt: [1, 2] }, "a", { b: true })).toEqual({ $fmt: { a: { b: true } } });
    // Clearing on garbage drops the garbage key too.
    expect(withCellStyle({ y: 2, $fmt: "x" }, "a", null)).toEqual({ y: 2 });
  });

  it("drops a garbage existing entry when merging into it", () => {
    const next = withCellStyle({ $fmt: { a: "bold" } }, "a", { i: true });
    expect(next).toEqual({ $fmt: { a: { i: true } } });
  });

  it("sanitises garbage in the patch itself", () => {
    const next = withCellStyle({}, "a", { b: 1, a: "middle", c: 42, i: true });
    expect(next).toEqual({ $fmt: { a: { i: true } } });
    // A patch that is entirely garbage leaves the row unstyled.
    expect(withCellStyle({ x: 1 }, "a", { b: "yes" })).toEqual({ x: 1 });
  });

  it("sets nf + dp on a cell and leaves the rest of the row alone", () => {
    const values = { a: 5, b: "x" };
    const next = withCellStyle(values, "a", { nf: "currency", dp: 2 });
    expect(next).toEqual({ a: 5, b: "x", $fmt: { a: { nf: "currency", dp: 2 } } });
    expect(next.a).toBe(5); // the stored number is untouched: the engine still sees 5
  });

  it("merges nf/dp into an existing text style", () => {
    const base = withCellStyle({}, "a", { b: true, c: "#f00" });
    expect(readCellStyle(withCellStyle(base, "a", { nf: "percent", dp: 0 }), "a")).toEqual({
      b: true,
      c: "#f00",
      nf: "percent",
      dp: 0,
    });
  });

  it("dp: 0 is a value, not a removal", () => {
    const base = withCellStyle({}, "a", { nf: "currency", dp: 2 });
    expect(readCellStyle(withCellStyle(base, "a", { dp: 0 }), "a")).toEqual({ nf: "currency", dp: 0 });
  });

  it("adjusts dp on its own (the .0 / .00 buttons) without touching nf", () => {
    const base = withCellStyle({}, "a", { nf: "number", dp: 2 });
    expect(readCellStyle(withCellStyle(base, "a", { dp: 3 }), "a")).toEqual({ nf: "number", dp: 3 });
    expect(readCellStyle(withCellStyle(base, "a", { dp: 1 }), "a")).toEqual({ nf: "number", dp: 1 });
  });

  it("switches nf in place ($ then %)", () => {
    const base = withCellStyle({}, "a", { nf: "currency", dp: 2 });
    expect(readCellStyle(withCellStyle(base, "a", { nf: "percent", dp: 0 }), "a")).toEqual({ nf: "percent", dp: 0 });
  });

  it("clears nf and dp (Plain text) with the usual removal values", () => {
    const base = withCellStyle({}, "a", { b: true, nf: "currency", dp: 2 });
    expect(readCellStyle(withCellStyle(base, "a", { nf: undefined, dp: undefined }), "a")).toEqual({ b: true });
    expect(readCellStyle(withCellStyle(base, "a", { nf: null, dp: null }), "a")).toEqual({ b: true });
    expect(readCellStyle(withCellStyle(base, "a", { nf: "", dp: false }), "a")).toEqual({ b: true });
  });

  it("drops the entry and the $fmt key when Plain text clears the only formatting", () => {
    const base = withCellStyle({ x: 1 }, "a", { nf: "percent", dp: 0 });
    expect(withCellStyle(base, "a", { nf: undefined, dp: undefined })).toEqual({ x: 1 });
  });

  it("sanitises nf/dp in the patch: bogus nf dropped, dp clamped / floored / rejected", () => {
    expect(withCellStyle({}, "a", { nf: "bogus", dp: 2 })).toEqual({ $fmt: { a: { dp: 2 } } });
    expect(withCellStyle({}, "a", { nf: "currency", dp: "2" })).toEqual({ $fmt: { a: { nf: "currency" } } });
    expect(withCellStyle({}, "a", { nf: "currency", dp: 2.7 })).toEqual({ $fmt: { a: { nf: "currency", dp: 2 } } });
    expect(withCellStyle({}, "a", { nf: "currency", dp: -1 })).toEqual({ $fmt: { a: { nf: "currency", dp: 0 } } });
    expect(withCellStyle({}, "a", { nf: "currency", dp: 99 })).toEqual({ $fmt: { a: { nf: "currency", dp: 10 } } });
    // A patch that is entirely garbage leaves the row unstyled.
    expect(withCellStyle({ x: 1 }, "a", { nf: "money", dp: "many" })).toEqual({ x: 1 });
  });

  it("re-sanitises a persisted out-of-range dp when another key is patched", () => {
    const next = withCellStyle({ $fmt: { a: { nf: "number", dp: 42 } } }, "a", { b: true });
    expect(next).toEqual({ $fmt: { a: { b: true, nf: "number", dp: 10 } } });
  });

  it("refuses to style the reserved key as a column", () => {
    const values = { x: 1 };
    expect(withCellStyle(values, "$fmt", { b: true })).toEqual({ x: 1 });
  });

  it("keeps sibling cell values untouched by reference", () => {
    const nested = { deep: true };
    const values = { a: nested };
    const next = withCellStyle(values, "a", { b: true });
    expect(next.a).toBe(nested);
  });
});

describe("styleToCss", () => {
  it("returns an empty object for undefined / empty", () => {
    expect(styleToCss(undefined)).toEqual({});
    expect(styleToCss({})).toEqual({});
  });

  it("maps each flag", () => {
    expect(styleToCss({ b: true })).toEqual({ fontWeight: 600 });
    expect(styleToCss({ i: true })).toEqual({ fontStyle: "italic" });
    expect(styleToCss({ u: true })).toEqual({ textDecoration: "underline" });
    expect(styleToCss({ s: true })).toEqual({ textDecoration: "line-through" });
    expect(styleToCss({ c: "#f00" })).toEqual({ color: "#f00" });
    expect(styleToCss({ bg: "#0f0" })).toEqual({ backgroundColor: "#0f0" });
    expect(styleToCss({ a: "l" })).toEqual({ textAlign: "left" });
    expect(styleToCss({ a: "c" })).toEqual({ textAlign: "center" });
    expect(styleToCss({ a: "r" })).toEqual({ textAlign: "right" });
  });

  it("ignores nf / dp: number format is text, not CSS", () => {
    expect(styleToCss({ nf: "currency", dp: 2 })).toEqual({});
    expect(styleToCss({ b: true, nf: "percent", dp: 0 })).toEqual({ fontWeight: 600 });
  });

  it("combines underline + strikethrough into one declaration", () => {
    expect(styleToCss({ u: true, s: true })).toEqual({ textDecoration: "underline line-through" });
  });

  it("combines everything", () => {
    const style: CellStyle = { b: true, i: true, u: true, s: true, c: "#123", bg: "#abc", a: "c" };
    expect(styleToCss(style)).toEqual({
      fontWeight: 600,
      fontStyle: "italic",
      textDecoration: "underline line-through",
      color: "#123",
      backgroundColor: "#abc",
      textAlign: "center",
    });
  });

  it("is stable through a read round-trip", () => {
    const values = withCellStyle({}, "a", { b: true, u: true, a: "r" });
    expect(styleToCss(readCellStyle(values, "a"))).toEqual({
      fontWeight: 600,
      textDecoration: "underline",
      textAlign: "right",
    });
  });
});
