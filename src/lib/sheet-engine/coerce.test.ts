import { describe, expect, it } from "vitest";

import {
  MS_PER_DAY,
  SERIAL_EPOCH_MS,
  argBoolean,
  argInteger,
  argNumber,
  argText,
  argCells,
  classifyValue,
  collectNumbers,
  columnRange,
  compareValues,
  divide,
  finiteOrError,
  firstArgError,
  firstError,
  firstScalarError,
  isBlank,
  isRangeValue,
  numberToText,
  parseDateText,
  parseNumberText,
  partsFromSerial,
  rangeCells,
  rangeHeight,
  rangeValue,
  rangeWidth,
  roundHalfAwayFromZero,
  rowRange,
  serialFromLocalDate,
  serialFromParts,
  serialFromUtcDate,
  toBoolean,
  toNumber,
  toRange,
  toScalar,
  toText,
  valuesEqual,
  wholeDays,
} from "./coerce";
import { cellError } from "./types";

const DIV0 = cellError("#DIV/0!");
const VALUE = cellError("#VALUE!");
const NUM = cellError("#NUM!");
const NA = cellError("#N/A");
const REF = cellError("#REF!");

describe("ranges", () => {
  it("pads ragged rows with blanks and leaves rectangles alone", () => {
    const ragged = rangeValue([[1, 2], [3]]);
    expect(ragged.rows).toEqual([
      [1, 2],
      [3, null],
    ]);

    const rows = [
      [1, 2],
      [3, 4],
    ];
    expect(rangeValue(rows).rows).toBe(rows);
  });

  it("builds vectors in both directions", () => {
    expect(columnRange([1, 2]).rows).toEqual([[1], [2]]);
    expect(rowRange([1, 2]).rows).toEqual([[1, 2]]);
    expect(rangeHeight(columnRange([1, 2]))).toBe(2);
    expect(rangeWidth(columnRange([1, 2]))).toBe(1);
    expect(rangeHeight(rowRange([1, 2]))).toBe(1);
    expect(rangeWidth(rowRange([1, 2]))).toBe(2);
  });

  it("reports zero dimensions for an empty range", () => {
    const empty = rangeValue([]);
    expect(rangeHeight(empty)).toBe(0);
    expect(rangeWidth(empty)).toBe(0);
    expect(rangeCells(empty)).toEqual([]);
    expect(rowRange([]).rows).toEqual([]);
  });

  it("flattens row-major", () => {
    expect(
      rangeCells(
        rangeValue([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("recognises a range without mistaking a value for one", () => {
    expect(isRangeValue(columnRange([1]))).toBe(true);
    expect(isRangeValue({ kind: "range" })).toBe(false);
    expect(isRangeValue(VALUE)).toBe(false);
    expect(isRangeValue(null)).toBe(false);
    expect(isRangeValue("range")).toBe(false);
  });

  it("wraps and unwraps scalars", () => {
    expect(toRange(5).rows).toEqual([[5]]);
    expect(argCells(5)).toEqual([5]);
    expect(argCells(columnRange([1, 2]))).toEqual([1, 2]);
    expect(toScalar(columnRange([7]))).toBe(7);
    expect(toScalar(7)).toBe(7);
  });

  it("refuses to guess which cell of a multi-cell range was meant", () => {
    expect(toScalar(columnRange([1, 2]))).toBe(VALUE);
    expect(toScalar(rangeValue([]))).toBe(VALUE);
  });
});

describe("blanks", () => {
  it("counts only an absent value as blank", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(false);
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
  });
});

describe("error scanning", () => {
  it("returns the first error in argument order", () => {
    expect(firstError([1, NA, "x", DIV0])).toBe(NA);
    expect(firstError([1, "x"])).toBeNull();
  });

  it("descends into ranges, first cell wins", () => {
    expect(firstArgError([1, columnRange([null, REF, DIV0])])).toBe(REF);
    expect(firstArgError([DIV0, columnRange([REF])])).toBe(DIV0);
    expect(firstArgError([1, columnRange([2, 3])])).toBeNull();
  });

  it("can ignore what is inside a range", () => {
    expect(firstScalarError([columnRange([REF]), 1])).toBeNull();
    expect(firstScalarError([columnRange([REF]), DIV0])).toBe(DIV0);
  });
});

describe("parseNumberText", () => {
  it("reads the numeric shapes a spreadsheet accepts", () => {
    expect(parseNumberText("42")).toBe(42);
    expect(parseNumberText("  42\t")).toBe(42);
    expect(parseNumberText("+1.5")).toBe(1.5);
    expect(parseNumberText("-1.5")).toBe(-1.5);
    expect(parseNumberText(".5")).toBe(0.5);
    expect(parseNumberText("2.")).toBe(2);
    expect(parseNumberText("1e3")).toBe(1000);
    expect(parseNumberText("1E-3")).toBe(0.001);
  });

  it("reads a trailing percent as a hundredth", () => {
    expect(parseNumberText("50%")).toBe(0.5);
    expect(parseNumberText("-25%")).toBe(-0.25);
    expect(parseNumberText("%")).toBeNull();
  });

  it("rejects text that only looks numeric", () => {
    expect(parseNumberText("")).toBeNull();
    expect(parseNumberText("   ")).toBeNull();
    expect(parseNumberText("abc")).toBeNull();
    expect(parseNumberText("12abc")).toBeNull();
    expect(parseNumberText("-")).toBeNull();
    expect(parseNumberText("Infinity")).toBeNull();
    expect(parseNumberText("0x10")).toBeNull();
    // Locale-dependent grouping is never guessed at.
    expect(parseNumberText("1,000")).toBeNull();
    // Overflow is not a number a cell can hold.
    expect(parseNumberText("1e999")).toBeNull();
  });

  it("reads ISO dates as serials", () => {
    expect(parseNumberText("2026-08-22")).toBe(46256);
    expect(parseNumberText("2026-08-22T12:00:00Z")).toBe(46256.5);
  });

  it("can be told to leave date text alone", () => {
    expect(parseNumberText("2026-08-22", { allowDates: false })).toBeNull();
    expect(parseNumberText("42", { allowDates: false })).toBe(42);
  });
});

describe("toNumber", () => {
  it("applies the strict scalar rules", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(true)).toBe(1);
    expect(toNumber(false)).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("3")).toBe(3);
    expect(toNumber(" 3.5 ")).toBe(3.5);
  });

  it("is #VALUE! for text that is not a number, empty text included", () => {
    expect(toNumber("abc")).toBe(VALUE);
    expect(toNumber("")).toBe(VALUE);
  });

  it("passes an error through unchanged", () => {
    expect(toNumber(REF)).toBe(REF);
  });

  it("refuses a non-finite number", () => {
    expect(toNumber(Number.POSITIVE_INFINITY)).toBe(NUM);
    expect(toNumber(Number.NaN)).toBe(NUM);
  });
});

describe("collectNumbers", () => {
  it("skips non-numbers inside a range but coerces scalars strictly", () => {
    expect(collectNumbers([columnRange([1, "2", null, true, ""]), 3, "4"])).toEqual([
      1, 3, 4,
    ]);
    expect(collectNumbers([1, "abc"])).toBe(VALUE);
  });

  it("blank scalars are 0 while blank cells are nothing at all", () => {
    expect(collectNumbers([null])).toEqual([0]);
    expect(collectNumbers([columnRange([null, null])])).toEqual([]);
  });

  it("poison anywhere in a range stops the aggregate", () => {
    expect(collectNumbers([columnRange([1, DIV0, 2])])).toBe(DIV0);
    expect(collectNumbers([NA, columnRange([DIV0])])).toBe(NA);
  });
});

describe("toText", () => {
  it("renders each type the way a cell shows it", () => {
    expect(toText(null)).toBe("");
    expect(toText("x")).toBe("x");
    expect(toText(true)).toBe("TRUE");
    expect(toText(false)).toBe("FALSE");
    expect(toText(1.5)).toBe("1.5");
    expect(toText(REF)).toBe(REF);
  });

  it("prints exponents and negative zero like a spreadsheet", () => {
    expect(numberToText(1e21)).toBe("1E+21");
    expect(numberToText(-0)).toBe("0");
    expect(numberToText(0)).toBe("0");
  });
});

describe("toBoolean", () => {
  it("treats zero and blank as false", () => {
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(-1)).toBe(true);
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean(true)).toBe(true);
  });

  it("converts only the words TRUE and FALSE", () => {
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean(" FALSE ")).toBe(false);
    expect(toBoolean("1")).toBe(VALUE);
    expect(toBoolean("")).toBe(VALUE);
    expect(toBoolean("yes")).toBe(VALUE);
  });

  it("passes an error through", () => {
    expect(toBoolean(NA)).toBe(NA);
  });
});

describe("argument helpers", () => {
  it("unwrap a single-cell range before coercing", () => {
    expect(argNumber(columnRange(["3"]))).toBe(3);
    expect(argText(columnRange([true]))).toBe("TRUE");
    expect(argBoolean(columnRange([1]))).toBe(true);
    expect(argInteger(columnRange([2.9]))).toBe(2);
  });

  it("truncate toward zero rather than rounding", () => {
    expect(argInteger(2.9)).toBe(2);
    expect(argInteger(-2.9)).toBe(-2);
  });

  it("carry the failure out of a multi-cell range", () => {
    expect(argNumber(columnRange([1, 2]))).toBe(VALUE);
  });
});

describe("arithmetic guards", () => {
  it("never divides by zero silently", () => {
    expect(divide(6, 3)).toBe(2);
    expect(divide(1, 0)).toBe(DIV0);
    expect(divide(0, 0)).toBe(DIV0);
  });

  it("turns a non-finite result into #NUM!", () => {
    expect(finiteOrError(1)).toBe(1);
    expect(finiteOrError(Number.NaN)).toBe(NUM);
    expect(finiteOrError(Number.POSITIVE_INFINITY)).toBe(NUM);
  });
});

describe("roundHalfAwayFromZero", () => {
  it("rounds halves away from zero, unlike Math.round", () => {
    expect(roundHalfAwayFromZero(2.5, 0)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5, 0)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-3.5, 0)).toBe(-4);
  });

  it("corrects binary representation error before the halfway test", () => {
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68);
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
    expect(roundHalfAwayFromZero(0.1 + 0.2, 2)).toBe(0.3);
  });

  it("handles negative places and extremes", () => {
    expect(roundHalfAwayFromZero(1234, -2)).toBe(1200);
    expect(roundHalfAwayFromZero(1250, -2)).toBe(1300);
    expect(roundHalfAwayFromZero(1.23456, 200)).toBe(1.23456);
    expect(roundHalfAwayFromZero(1.23456, -400)).toBe(0);
    expect(Number.isNaN(roundHalfAwayFromZero(Number.NaN, 0))).toBe(true);
  });

  it("never produces negative zero", () => {
    expect(Object.is(roundHalfAwayFromZero(-0.4, 0), 0)).toBe(true);
  });
});

describe("comparison", () => {
  it("classifies every kind of value", () => {
    expect(classifyValue(1)).toBe("number");
    expect(classifyValue("a")).toBe("text");
    expect(classifyValue(true)).toBe("boolean");
    expect(classifyValue(null)).toBe("blank");
    expect(classifyValue(DIV0)).toBe("error");
  });

  it("orders like values", () => {
    expect(compareValues(1, 2)).toBe(-1);
    expect(compareValues(2, 2)).toBe(0);
    expect(compareValues(3, 2)).toBe(1);
    expect(compareValues("a", "B")).toBe(-1);
    expect(compareValues("A", "a")).toBe(0);
    expect(compareValues(false, true)).toBe(-1);
  });

  it("lets a blank stand in for the zero of the other side", () => {
    expect(valuesEqual(null, 0)).toBe(true);
    expect(valuesEqual(null, "")).toBe(true);
    expect(valuesEqual(null, false)).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);
    expect(compareValues(null, 5)).toBe(-1);
  });

  it("orders numbers before text before booleans", () => {
    expect(compareValues(2, "apple")).toBe(-1);
    expect(compareValues("apple", true)).toBe(-1);
    expect(compareValues(true, 2)).toBe(1);
  });

  it("never equates across types", () => {
    expect(valuesEqual(1, "1")).toBe(false);
    expect(valuesEqual(1, true)).toBe(false);
  });

  it("refuses to order an error, even against itself", () => {
    expect(compareValues(DIV0, 1)).toBeNull();
    expect(compareValues(DIV0, DIV0)).toBeNull();
    expect(valuesEqual(DIV0, DIV0)).toBe(false);
  });
});

describe("date serials", () => {
  it("anchors serial 0 at 1899-12-30", () => {
    expect(SERIAL_EPOCH_MS).toBe(Date.UTC(1899, 11, 30));
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(serialFromParts(1899, 12, 30)).toBe(0);
    expect(serialFromParts(1900, 1, 1)).toBe(2);
    expect(serialFromParts(2000, 1, 1)).toBe(36526);
    expect(serialFromParts(2026, 8, 22)).toBe(46256);
  });

  it("counts real days, so 1900 is not a leap year here", () => {
    expect(serialFromParts(1900, 3, 1) - serialFromParts(1900, 2, 28)).toBe(1);
    expect(serialFromParts(2024, 3, 1) - serialFromParts(2024, 2, 28)).toBe(2);
  });

  it("carries the time of day in the fraction", () => {
    expect(serialFromParts(2026, 8, 22, 12)).toBe(46256.5);
    expect(serialFromParts(2026, 8, 22, 6)).toBe(46256.25);
  });

  it("rolls over out-of-range parts", () => {
    expect(serialFromParts(2026, 13, 1)).toBe(serialFromParts(2027, 1, 1));
    expect(serialFromParts(2026, 1, 32)).toBe(serialFromParts(2026, 2, 1));
    expect(serialFromParts(2026, 0, 1)).toBe(serialFromParts(2025, 12, 1));
  });

  it("round-trips through parts", () => {
    const serial = serialFromParts(2026, 8, 22, 13, 30, 15);
    expect(partsFromSerial(serial)).toEqual({
      year: 2026,
      month: 8,
      day: 22,
      hours: 13,
      minutes: 30,
      seconds: 15,
    });
    expect(partsFromSerial(0)?.year).toBe(1899);
    expect(partsFromSerial(-1)?.day).toBe(29);
  });

  it("returns null instead of an invalid date", () => {
    expect(partsFromSerial(Number.NaN)).toBeNull();
    expect(partsFromSerial(1e12)).toBeNull();
  });

  it("floors to the day, negative serials included", () => {
    expect(wholeDays(46256.75)).toBe(46256);
    expect(wholeDays(-0.25)).toBe(-1);
  });

  it("converts a Date in either frame", () => {
    expect(serialFromUtcDate(new Date(Date.UTC(2026, 7, 22)))).toBe(46256);
    // Built from local components, so this holds in any timezone.
    expect(serialFromLocalDate(new Date(2026, 7, 22, 12, 0, 0))).toBe(46256.5);
    expect(Number.isNaN(serialFromLocalDate(new Date(Number.NaN)))).toBe(true);
  });
});

describe("parseDateText", () => {
  it("accepts the unambiguous ISO shapes", () => {
    expect(parseDateText("2026-08-22")).toBe(46256);
    expect(parseDateText("2026/08/22")).toBe(46256);
    expect(parseDateText("2026-8-22")).toBe(46256);
    expect(parseDateText("2026-08-22T12:00")).toBe(46256.5);
    expect(parseDateText("2026-08-22 12:00:00")).toBe(46256.5);
    expect(parseDateText("2026-08-22T12:00:00Z")).toBe(46256.5);
  });

  it("rejects a date that does not exist", () => {
    expect(parseDateText("2026-02-30")).toBeNull();
    expect(parseDateText("2026-13-01")).toBeNull();
    expect(parseDateText("2026-00-10")).toBeNull();
    expect(parseDateText("2026-08-22T25:00")).toBeNull();
  });

  it("rejects month-first text rather than guessing the order", () => {
    expect(parseDateText("08/22/2026")).toBeNull();
    expect(parseDateText("22-08-2026")).toBeNull();
    expect(parseDateText("Aug 22, 2026")).toBeNull();
  });
});
