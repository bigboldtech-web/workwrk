import { describe, expect, it } from "vitest";

import {
  CELL_STYLE_KEY,
  isReservedKey,
  readCellStyle,
  styleToCss,
  withCellStyle,
  type CellStyle,
} from "./sheet-cell-style";

describe("isReservedKey", () => {
  it("recognises only the $fmt key", () => {
    expect(CELL_STYLE_KEY).toBe("$fmt");
    expect(isReservedKey("$fmt")).toBe(true);
    expect(isReservedKey("fmt")).toBe(false);
    expect(isReservedKey("$")).toBe(false);
    expect(isReservedKey("clx1abc")).toBe(false);
    expect(isReservedKey("")).toBe(false);
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
