import { describe, expect, it } from "vitest";

import { selectionStats } from "./sheet-stats";

/* ── numerics ────────────────────────────────────────────────────
 * What counts as a number is the strict trim-parse the number-column
 * display renderer uses (Number(String(v).trim()) + isFinite); the sort
 * comparator's parseFloat agrees on every fully-numeric string. See the
 * header comment in sheet-stats.ts for the "12abc" divergence. */

describe("selectionStats numerics", () => {
  it("sums integers, floats and negatives", () => {
    expect(selectionStats([1, 2.5, -4])).toEqual({
      sum: -0.5, avg: -0.5 / 3, min: -4, max: 2.5, numeric: 3, nonEmpty: 3,
    });
  });

  it("parses numeric strings the way the strict trim-parse does", () => {
    // " 42 " trims, "1e3" is scientific notation, "-2.5" is signed —
    // all fully numeric, so both parsers in page.tsx agree on them.
    const s = selectionStats([" 42 ", "1e3", "-2.5"]);
    expect(s).toEqual({ sum: 1039.5, avg: 346.5, min: -2.5, max: 1000, numeric: 3, nonEmpty: 3 });
  });

  it("mixes typeof-number and numeric strings", () => {
    expect(selectionStats([10, "5"])).toEqual({ sum: 15, avg: 7.5, min: 5, max: 10, numeric: 2, nonEmpty: 2 });
  });

  it("zero is a value, not an empty cell", () => {
    // 0 == null is false and 0 === "" is false — a zero must count both
    // non-empty and numeric, or a [0, 0] selection would show nothing.
    expect(selectionStats([0, 0])).toEqual({ sum: 0, avg: 0, min: 0, max: 0, numeric: 2, nonEmpty: 2 });
  });

  it("min/max track sign correctly on all-negative input", () => {
    expect(selectionStats([-3, -1, -2])).toMatchObject({ min: -3, max: -1, sum: -6 });
  });

  it("returns raw float sums — rounding is the caller's job", () => {
    const s = selectionStats([0.1, 0.2]);
    expect(s?.sum).toBe(0.1 + 0.2); // 0.30000000000000004, not 0.3
    expect(s?.avg).toBe((0.1 + 0.2) / 2);
  });
});

/* ── exclusions from numerics (still non-empty) ─────────────────── */

describe("selectionStats exclusions", () => {
  it("formula error codes count non-empty but never numeric", () => {
    // Engine errors surface as code strings; a "#DIV/0!" summed as
    // anything would be a lie.
    expect(selectionStats(["#DIV/0!", "#REF!", 5, 7])).toEqual({
      sum: 12, avg: 6, min: 5, max: 7, numeric: 2, nonEmpty: 4,
    });
  });

  it("booleans are content, not numbers (checkbox columns)", () => {
    expect(selectionStats([true, false, 3, 4])).toEqual({
      sum: 7, avg: 3.5, min: 3, max: 4, numeric: 2, nonEmpty: 4,
    });
  });

  it("objects and arrays are content, not numbers (multi_select etc.)", () => {
    expect(selectionStats([["a", "b"], {}, 1, 2])).toEqual({
      sum: 3, avg: 1.5, min: 1, max: 2, numeric: 2, nonEmpty: 4,
    });
  });

  it("strict parse: partially-numeric strings are text", () => {
    // parseFloat would read "12abc" as 12; the strict trim-parse the
    // stats use (deliberately — see sheet-stats.ts) does not.
    expect(selectionStats(["12abc", 1, 2])).toEqual({
      sum: 3, avg: 1.5, min: 1, max: 2, numeric: 2, nonEmpty: 3,
    });
  });

  it("NaN and Infinity are typeof number but never numeric", () => {
    // One NaN in a Sum poisons every stat; Infinity is no more honest.
    expect(selectionStats([NaN, Infinity, -Infinity, 1, 2])).toEqual({
      sum: 3, avg: 1.5, min: 1, max: 2, numeric: 2, nonEmpty: 5,
    });
  });

  it("whitespace-only strings are non-empty but parse to nothing", () => {
    // Number("  ") is 0 — the guard keeps a stray space-cell from
    // dragging Avg toward zero.
    expect(selectionStats(["   ", 4, 6])).toEqual({
      sum: 10, avg: 5, min: 4, max: 6, numeric: 2, nonEmpty: 3,
    });
  });
});

/* ── empty cells + the < 2 non-empty gate ───────────────────────── */

describe("selectionStats emptiness gate", () => {
  it("null / undefined / empty string are empty cells", () => {
    expect(selectionStats([null, undefined, "", 5, 7])).toEqual({
      sum: 12, avg: 6, min: 5, max: 7, numeric: 2, nonEmpty: 2,
    });
  });

  it("returns null for an empty selection", () => {
    expect(selectionStats([])).toBeNull();
  });

  it("returns null for a single value — Sheets shows nothing for one cell", () => {
    expect(selectionStats([42])).toBeNull();
    expect(selectionStats(["text"])).toBeNull();
  });

  it("returns null when only one cell is non-empty, however big the range", () => {
    expect(selectionStats([5, null, "", undefined])).toBeNull();
  });

  it("returns null for an all-empty range", () => {
    expect(selectionStats([null, "", undefined, null])).toBeNull();
  });
});

/* ── the caller's Count-only decision needs honest counts ───────── */

describe("selectionStats count-only shapes", () => {
  it("one numeric among texts returns the object — caller shows Count only", () => {
    // numeric=1, nonEmpty=3: the stats themselves stay honest (the one
    // number IS the sum/min/max); the caller reads numeric < 2 and
    // renders just "Count: 3".
    expect(selectionStats([5, "a", "b"])).toEqual({
      sum: 5, avg: 5, min: 5, max: 5, numeric: 1, nonEmpty: 3,
    });
  });

  it("zero numerics returns inert zero placeholders, never NaN/Infinity", () => {
    // Without the numeric===0 branch, min would be Infinity and avg NaN —
    // one missed caller-side gate away from the screen.
    expect(selectionStats(["a", "b", true])).toEqual({
      sum: 0, avg: 0, min: 0, max: 0, numeric: 0, nonEmpty: 3,
    });
  });
});
