import { describe, expect, it } from "vitest";

import {
  formatCellValue,
  isNegativeStyled,
  matchRule,
  lerpHex,
  numericRange,
  colorScaleColor,
  dataBarBackground,
  iconSetIcon,
  type ColumnFormat,
  type ConditionalRule,
} from "./sheet-format";

/* ── Legacy parity: NO format configured ─────────────────────────
 * These pin the pre-Phase-4 renderer output exactly, so shipping this
 * module changes nothing until a user configures a format. */

describe("formatCellValue, no format (legacy parity)", () => {
  it("currency matches the old `$${v}` renderer", () => {
    expect(formatCellValue(12, "currency")).toBe("$12");
    expect(formatCellValue(1234.5, "currency")).toBe("$1234.5");
    expect(formatCellValue(-5, "currency")).toBe("$-5");
  });

  it("percent matches the old `${v}%` renderer (stored 12 means 12%)", () => {
    expect(formatCellValue(12, "percent")).toBe("12%");
    expect(formatCellValue(0.5, "percent")).toBe("0.5%");
  });

  it("number is String(v)", () => {
    expect(formatCellValue(1234567.891, "number")).toBe("1234567.891");
  });

  it("rating renders stars, clamped 0..5, blank for 0/non-number", () => {
    expect(formatCellValue(3, "rating")).toBe("★★★");
    expect(formatCellValue(0, "rating")).toBe("");
    expect(formatCellValue(999, "rating")).toBe("★★★★★");
    expect(formatCellValue(-2, "rating")).toBe("");
    expect(formatCellValue("junk", "rating")).toBe("");
  });

  it("null/undefined/empty render empty", () => {
    expect(formatCellValue(null, "number")).toBe("");
    expect(formatCellValue(undefined, "currency")).toBe("");
    expect(formatCellValue("", "percent")).toBe("");
  });

  it("strings and engine errors pass through untouched", () => {
    expect(formatCellValue("hello", "short_text")).toBe("hello");
    expect(formatCellValue("#DIV/0!", "formula")).toBe("#DIV/0!");
    expect(formatCellValue("12", "short_text", { decimals: 2 })).toBe("12");
  });

  it("NaN/Infinity are not prettified by Intl", () => {
    expect(formatCellValue(NaN, "number", { decimals: 2 })).toBe("NaN");
    expect(formatCellValue(Infinity, "number", { thousands: true })).toBe("Infinity");
  });

  it("an empty format object stays on the legacy path", () => {
    expect(formatCellValue(1234.5, "currency", {})).toBe("$1234.5");
    expect(formatCellValue(12, "percent", {})).toBe("12%");
  });

  it("a dateFormat-only format object leaves numbers on the legacy path", () => {
    expect(formatCellValue(1234.5, "currency", { dateFormat: "dmy" })).toBe("$1234.5");
  });
});

/* ── Numeric formatting: decimals, thousands, styles ─────────────── */

describe("formatCellValue, numeric options", () => {
  it("decimals 0 rounds to integers", () => {
    expect(formatCellValue(1234.5, "number", { decimals: 0 })).toBe("1235");
    expect(formatCellValue(1234.4, "number", { decimals: 0 })).toBe("1234");
  });

  it("decimals 10 pads to ten places", () => {
    expect(formatCellValue(1.5, "number", { decimals: 10 })).toBe("1.5000000000");
  });

  it("out-of-range decimals are clamped, never thrown on", () => {
    expect(formatCellValue(1.5, "number", { decimals: 99 })).toBe("1.5000000000");
    expect(formatCellValue(1.567, "number", { decimals: -3 })).toBe("2");
  });

  it("decimals unset shows the stored value faithfully (no forced rounding to 3)", () => {
    expect(formatCellValue(1.23456, "number", { thousands: false })).toBe("1.23456");
  });

  it("thousands on/off", () => {
    expect(formatCellValue(1234567.5, "number", { thousands: true })).toBe("1,234,567.5");
    expect(formatCellValue(1234567.5, "number", { thousands: false })).toBe("1234567.5");
    // grouping is opt-in: setting an unrelated key must not turn it on
    expect(formatCellValue(1234567.5, "number", { decimals: 1 })).toBe("1234567.5");
  });

  it("currency style uses the ISO code via Intl", () => {
    expect(formatCellValue(1234.5, "currency", { decimals: 2, thousands: true })).toBe("$1,234.50");
    expect(formatCellValue(1234.5, "currency", { decimals: 2, thousands: true, currency: "EUR" })).toBe("€1,234.50");
    expect(formatCellValue(1234.5, "currency", { decimals: 2, thousands: true, currency: "eur" })).toBe("€1,234.50");
  });

  it("an invalid currency code falls back to USD instead of throwing", () => {
    expect(formatCellValue(5, "currency", { decimals: 0, currency: "NOPE!" })).toBe("$5");
    expect(formatCellValue(5, "currency", { decimals: 0, currency: "" })).toBe("$5");
  });

  it("percent style appends % without multiplying (stored 12 renders 12%)", () => {
    expect(formatCellValue(12, "percent", { decimals: 1 })).toBe("12.0%");
    expect(formatCellValue(1234.5, "percent", { decimals: 2, thousands: true })).toBe("1,234.50%");
  });

  it("style overrides the column type", () => {
    expect(formatCellValue(12, "number", { style: "percent", decimals: 0 })).toBe("12%");
    expect(formatCellValue(12, "number", { style: "currency", decimals: 2 })).toBe("$12.00");
    expect(formatCellValue(12, "currency", { style: "number", decimals: 2 })).toBe("12.00");
  });

  it("setting only decimals on a currency column keeps the currency shape", () => {
    expect(formatCellValue(12, "currency", { decimals: 2 })).toBe("$12.00");
  });
});

/* ── Every style x negative combination ──────────────────────────── */

describe("formatCellValue, negative styling matrix", () => {
  const n = -1234.5;
  const base: ColumnFormat = { decimals: 2, thousands: true };

  const cases: Array<[ColumnFormat["style"], ColumnFormat["negative"], string]> = [
    ["number", undefined, "-1,234.50"],
    ["number", "minus", "-1,234.50"],
    ["number", "parens", "(1,234.50)"],
    ["number", "red", "-1,234.50"],
    ["number", "parens-red", "(1,234.50)"],
    ["currency", undefined, "-$1,234.50"],
    ["currency", "minus", "-$1,234.50"],
    ["currency", "parens", "($1,234.50)"],
    ["currency", "red", "-$1,234.50"],
    ["currency", "parens-red", "($1,234.50)"],
    ["percent", undefined, "-1,234.50%"],
    ["percent", "minus", "-1,234.50%"],
    ["percent", "parens", "(1,234.50%)"],
    ["percent", "red", "-1,234.50%"],
    ["percent", "parens-red", "(1,234.50%)"],
  ];

  for (const [style, negative, expected] of cases) {
    it(`${style} x ${negative ?? "unset"} renders ${expected}`, () => {
      expect(formatCellValue(n, "number", { ...base, style, negative })).toBe(expected);
    });
  }

  it("positive values are untouched by every negative mode", () => {
    for (const negative of ["minus", "parens", "red", "parens-red"] as const) {
      expect(formatCellValue(1234.5, "number", { ...base, negative })).toBe("1,234.50");
    }
  });
});

describe("isNegativeStyled", () => {
  it("true only for red modes on negative numbers", () => {
    expect(isNegativeStyled(-5, { negative: "red" })).toBe(true);
    expect(isNegativeStyled(-5, { negative: "parens-red" })).toBe(true);
    expect(isNegativeStyled(-5, { negative: "parens" })).toBe(false);
    expect(isNegativeStyled(-5, { negative: "minus" })).toBe(false);
    expect(isNegativeStyled(-5, {})).toBe(false);
    expect(isNegativeStyled(-5, undefined)).toBe(false);
  });

  it("false for non-negative or non-numeric raws", () => {
    expect(isNegativeStyled(5, { negative: "red" })).toBe(false);
    expect(isNegativeStyled(0, { negative: "red" })).toBe(false);
    expect(isNegativeStyled("-5", { negative: "red" })).toBe(false);
    expect(isNegativeStyled(null, { negative: "red" })).toBe(false);
    expect(isNegativeStyled(NaN, { negative: "red" })).toBe(false);
  });
});

/* ── Date formats ─────────────────────────────────────────────────── */

describe("formatCellValue, date column", () => {
  const f = (df: ColumnFormat["dateFormat"]) => formatCellValue("2026-01-31", "date", { dateFormat: df });

  it("iso passes through", () => {
    expect(f("iso")).toBe("2026-01-31");
    expect(formatCellValue("2026-01-31", "date")).toBe("2026-01-31"); // no format at all
  });

  it("dmy", () => {
    expect(f("dmy")).toBe("31/01/2026");
  });

  it("mdy", () => {
    expect(f("mdy")).toBe("01/31/2026");
  });

  it("long", () => {
    expect(f("long")).toBe("Jan 31, 2026");
    expect(formatCellValue("2026-12-01", "date", { dateFormat: "long" })).toBe("Dec 1, 2026");
  });

  it("invalid stored dates pass through raw", () => {
    expect(formatCellValue("not-a-date", "date", { dateFormat: "dmy" })).toBe("not-a-date");
    expect(formatCellValue("2026-1-31", "date", { dateFormat: "dmy" })).toBe("2026-1-31"); // not zero-padded
    expect(formatCellValue("2026-02-30", "date", { dateFormat: "long" })).toBe("2026-02-30"); // calendar-invalid
    expect(formatCellValue("2026-13-01", "date", { dateFormat: "mdy" })).toBe("2026-13-01");
    expect(formatCellValue(20260131, "date", { dateFormat: "dmy" })).toBe("20260131"); // non-string raw
    expect(formatCellValue(null, "date", { dateFormat: "long" })).toBe("");
  });
});

/* ── Conditional rules ────────────────────────────────────────────── */

describe("matchRule", () => {
  const bg = "#fee2e2";

  it("gt/lt/gte/lte compare numerically when both sides are numeric", () => {
    expect(matchRule(10, [{ when: "gt", value: 5, bg }])).toBe(bg);
    expect(matchRule(3, [{ when: "gt", value: 5, bg }])).toBeNull();
    expect(matchRule(3, [{ when: "lt", value: 5, bg }])).toBe(bg);
    expect(matchRule(5, [{ when: "gte", value: 5, bg }])).toBe(bg);
    expect(matchRule(5, [{ when: "lte", value: 5, bg }])).toBe(bg);
    expect(matchRule(6, [{ when: "lte", value: 5, bg }])).toBeNull();
  });

  it("numeric compare applies when either side is a numeric STRING", () => {
    // string-vs-number: "9" < 10 numerically, but "9" > "10" as strings
    expect(matchRule("9", [{ when: "lt", value: 10, bg }])).toBe(bg);
    expect(matchRule(9, [{ when: "lt", value: "10", bg }])).toBe(bg);
    expect(matchRule("9", [{ when: "lt", value: "10", bg }])).toBe(bg);
  });

  it("falls back to string comparison when a side is not numeric", () => {
    expect(matchRule("abc", [{ when: "gt", value: 5, bg }])).toBe(bg); // "abc" > "5"
    expect(matchRule("banana", [{ when: "gt", value: "apple", bg }])).toBe(bg);
    expect(matchRule("apple", [{ when: "lt", value: "banana", bg }])).toBe(bg);
  });

  it("eq/neq: numeric when both numeric, exact string otherwise", () => {
    expect(matchRule(12, [{ when: "eq", value: "12", bg }])).toBe(bg);
    expect(matchRule("12.0", [{ when: "eq", value: 12, bg }])).toBe(bg);
    expect(matchRule("Done", [{ when: "eq", value: "Done", bg }])).toBe(bg);
    expect(matchRule("done", [{ when: "eq", value: "Done", bg }])).toBeNull(); // eq is case-sensitive
    expect(matchRule("Done", [{ when: "neq", value: "Done", bg }])).toBeNull();
    expect(matchRule("Open", [{ when: "neq", value: "Done", bg }])).toBe(bg);
    expect(matchRule(true, [{ when: "eq", value: "true", bg }])).toBe(bg); // booleans compare as strings
  });

  it("contains is case-insensitive", () => {
    expect(matchRule("Hello World", [{ when: "contains", value: "WORLD", bg }])).toBe(bg);
    expect(matchRule("Hello", [{ when: "contains", value: "xyz", bg }])).toBeNull();
    expect(matchRule(12345, [{ when: "contains", value: "234", bg }])).toBe(bg); // numbers stringify
  });

  it("empty matches null/undefined/'' only; 0 and false are values", () => {
    expect(matchRule(null, [{ when: "empty", bg }])).toBe(bg);
    expect(matchRule(undefined, [{ when: "empty", bg }])).toBe(bg);
    expect(matchRule("", [{ when: "empty", bg }])).toBe(bg);
    expect(matchRule(0, [{ when: "empty", bg }])).toBeNull();
    expect(matchRule(false, [{ when: "empty", bg }])).toBeNull();
    expect(matchRule("x", [{ when: "empty", bg }])).toBeNull();
  });

  it("nonempty is the inverse", () => {
    expect(matchRule(0, [{ when: "nonempty", bg }])).toBe(bg);
    expect(matchRule(false, [{ when: "nonempty", bg }])).toBe(bg);
    expect(matchRule("x", [{ when: "nonempty", bg }])).toBe(bg);
    expect(matchRule(null, [{ when: "nonempty", bg }])).toBeNull();
    expect(matchRule("", [{ when: "nonempty", bg }])).toBeNull();
  });

  it("an empty cell never matches a comparison operator", () => {
    expect(matchRule(null, [{ when: "eq", value: "null", bg }])).toBeNull();
    expect(matchRule(null, [{ when: "lt", value: 5, bg }])).toBeNull();
    expect(matchRule("", [{ when: "contains", value: "", bg }])).toBeNull();
  });

  it("first match wins", () => {
    const rules: ConditionalRule[] = [
      { when: "gt", value: 100, bg: "#111" },
      { when: "gt", value: 10, bg: "#222" },
      { when: "gt", value: 1, bg: "#333" },
    ];
    expect(matchRule(50, rules)).toBe("#222");
    expect(matchRule(500, rules)).toBe("#111");
    expect(matchRule(5, rules)).toBe("#333");
    expect(matchRule(0, rules)).toBeNull();
  });

  it("malformed rules are skipped, never thrown on", () => {
    const rules = [
      null,
      42,
      { when: "sparkles", value: 1, bg: "#111" }, // unknown operator
      { when: "gt", value: 1 }, // missing bg
      { when: "gt", value: 1, bg: "" }, // empty bg
      { when: "gt", bg: "#222" }, // comparison with no value
      { when: "eq", value: null, bg: "#333" }, // null value counts as missing
      { when: "gt", value: 1, bg: "#good" }, // the one valid rule
    ] as unknown as ConditionalRule[];
    expect(matchRule(5, rules)).toBe("#good");
  });

  it("no rules or a non-array is null", () => {
    expect(matchRule(5, undefined)).toBeNull();
    expect(matchRule(5, [])).toBeNull();
    expect(matchRule(5, "nope" as unknown as ConditionalRule[])).toBeNull();
  });
});

describe("conditional formatting v2 helpers", () => {
  it("lerpHex blends and clamps", () => {
    expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(lerpHex("#000000", "#ffffff", 2)).toBe("#ffffff"); // clamped
    expect(lerpHex("bad", "#ffffff", 0.5)).toBe("bad"); // unparseable → a
  });

  it("numericRange skips non-numbers, counts numeric text", () => {
    expect(numericRange([1, 2, 3])).toEqual({ lo: 1, hi: 3 });
    expect(numericRange([5, "10", null, "x", "", 2])).toEqual({ lo: 2, hi: 10 });
    expect(numericRange(["a", null, ""])).toBeNull();
    expect(numericRange([])).toBeNull();
  });

  it("colorScaleColor maps a value across 2 and 3 stops", () => {
    const two = { type: "color_scale" as const, min: "#000000", max: "#ffffff" };
    expect(colorScaleColor(0, 0, 10, two)).toBe("#000000");
    expect(colorScaleColor(10, 0, 10, two)).toBe("#ffffff");
    expect(colorScaleColor(5, 0, 10, two)).toBe("#808080");
    const three = { type: "color_scale" as const, min: "#000000", mid: "#ff0000", max: "#ffffff" };
    expect(colorScaleColor(5, 0, 10, three)).toBe("#ff0000"); // exact midpoint
    expect(colorScaleColor(2.5, 0, 10, three)).toBe("#800000"); // between min and mid
    expect(colorScaleColor(NaN, 0, 10, two)).toBeNull();
  });

  it("dataBarBackground sizes the bar to the value", () => {
    const cfg = { type: "data_bar" as const, color: "#5B9BD5" };
    expect(dataBarBackground(0, 0, 10, cfg)).toContain(" 0%");
    expect(dataBarBackground(10, 0, 10, cfg)).toContain(" 100%");
    expect(dataBarBackground(5, 0, 10, cfg)).toContain("5B9BD555 50%");
    expect(dataBarBackground(NaN, 0, 10, cfg)).toBeNull();
  });
});

describe("iconSetIcon", () => {
  it("maps a value's tertile to a coloured glyph", () => {
    // range 0..9: lo third [0,3), mid [3,6), hi [6,9]
    expect(iconSetIcon(8, 0, 9, "arrows")).toEqual({ char: "▲", color: "#22c55e" });
    expect(iconSetIcon(4, 0, 9, "arrows")).toEqual({ char: "▬", color: "#f59e0b" });
    expect(iconSetIcon(1, 0, 9, "arrows")).toEqual({ char: "▼", color: "#ef4444" });
    expect(iconSetIcon(8, 0, 9, "traffic")).toEqual({ char: "●", color: "#22c55e" });
    expect(iconSetIcon(NaN, 0, 9, "arrows")).toBeNull();
  });
});
