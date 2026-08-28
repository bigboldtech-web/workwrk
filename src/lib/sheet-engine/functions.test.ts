import { describe, expect, it } from "vitest";

import {
  columnRange,
  rangeValue,
  rowRange,
  serialFromParts,
  type FunctionArg,
} from "./coerce";
import {
  FUNCTIONS,
  MAX_TEXT_LENGTH,
  RANGE_ARGUMENTS,
  callFunction,
  callFunctionWith,
  functionNames,
  getFunction,
  isFunctionName,
  type ArgThunk,
  type FunctionContext,
} from "./functions";
import { CELL_ERRORS, cellError, type CellValue } from "./types";

const DIV0 = cellError("#DIV/0!");
const VALUE = cellError("#VALUE!");
const NUM = cellError("#NUM!");
const NA = cellError("#N/A");
const REF = cellError("#REF!");
const NAME = cellError("#NAME?");
const ERROR = cellError("#ERROR!");

/** 2026-08-22 13:30, frozen: nothing in the engine reads the wall clock. */
const NOW_SERIAL = serialFromParts(2026, 8, 22, 13, 30, 0);
const ctx: FunctionContext = { now: NOW_SERIAL };

function call(name: string, ...args: FunctionArg[]): CellValue {
  return callFunctionWith(name, args, ctx);
}

describe("registry", () => {
  it("holds every function the Phase 3 plan lists", () => {
    const expected = [
      "SUM",
      "AVERAGE",
      "AVG",
      "MIN",
      "MAX",
      "COUNT",
      "COUNTA",
      "IF",
      "AND",
      "OR",
      "NOT",
      "IFERROR",
      "CONCAT",
      "LEFT",
      "RIGHT",
      "MID",
      "LEN",
      "TRIM",
      "UPPER",
      "LOWER",
      "SUBSTITUTE",
      "ROUND",
      "ABS",
      "POW",
      "SQRT",
      "MOD",
      "TODAY",
      "NOW",
      "DATE",
      "DATEDIF",
      "COUNTIF",
      "SUMIF",
      "AVERAGEIF",
      "VLOOKUP",
      "INDEX",
      "MATCH",
      "ROUNDUP",
      "ROUNDDOWN",
      "TRUNC",
      "INT",
      "CEILING",
      "FLOOR",
      "SIGN",
      "PRODUCT",
      "MEDIAN",
      "POWER",
      "XOR",
      "IFS",
      "SWITCH",
      "IFNA",
      "CONCATENATE",
      "PROPER",
      "REPT",
      "EXACT",
      "FIND",
      "SEARCH",
      "VALUE",
      "TEXTJOIN",
      "YEAR",
      "MONTH",
      "DAY",
      "HOUR",
      "MINUTE",
      "WEEKDAY",
      "DAYS",
      "EDATE",
      "EOMONTH",
      "COUNTIFS",
      "SUMIFS",
      "AVERAGEIFS",
      "ISNUMBER",
      "ISTEXT",
      "ISLOGICAL",
      "ISBLANK",
      "ISERROR",
      "ISNA",
      "ISEVEN",
      "ISODD",
    ];
    expect(functionNames()).toEqual([...expected].sort());
    for (const name of expected) expect(isFunctionName(name)).toBe(true);
  });

  it("looks up case-insensitively and keys on the upper-case name", () => {
    expect(getFunction("sum")).toBe(FUNCTIONS.get("SUM"));
    expect(getFunction("Vlookup")?.name).toBe("VLOOKUP");
    expect(getFunction("nope")).toBeUndefined();
    expect(isFunctionName("nope")).toBe(false);
  });

  it("keeps every entry self-consistent", () => {
    for (const entry of FUNCTIONS.values()) {
      expect(entry.name).toBe(entry.name.toUpperCase());
      expect(entry.minArgs).toBeLessThanOrEqual(entry.maxArgs);
      expect(entry.signature.startsWith(`${entry.name}(`)).toBe(true);
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });

  it("defers arguments only where the semantics need it", () => {
    const lazy = [...FUNCTIONS.values()].filter((entry) => entry.lazy);
    expect(lazy.map((entry) => entry.name).sort()).toEqual([
      "IF",
      "IFERROR",
      "IFNA",
      "IFS",
      "SWITCH",
    ]);
  });

  it("answers an unknown name with #NAME?, not an exception", () => {
    expect(call("NOPE", 1)).toBe(NAME);
    expect(callFunction("NOPE", [], ctx)).toBe(NAME);
  });

  it("degrades a thrown argument to #ERROR! instead of unwinding", () => {
    const boom: ArgThunk = () => {
      throw new Error("evaluator bug");
    };
    expect(callFunction("SUM", [boom], ctx)).toBe(ERROR);
    expect(callFunction("IF", [boom, () => 1], ctx)).toBe(ERROR);
  });
});

describe("SUM", () => {
  it("adds numbers and skips what a range cannot contribute", () => {
    expect(call("SUM", 1, 2, 3)).toBe(6);
    expect(call("SUM", columnRange([1, "2", null, true, "", 3]))).toBe(4);
    expect(call("SUM", columnRange([1, 2]), 3)).toBe(6);
  });

  it("is strict about a scalar but lenient about a cell", () => {
    expect(call("SUM", "3")).toBe(3);
    expect(call("SUM", "abc")).toBe(VALUE);
    expect(call("SUM", columnRange(["abc"]))).toBe(0);
  });

  it("propagates the first error and checks arity", () => {
    expect(call("SUM", columnRange([1, DIV0]), NA)).toBe(DIV0);
    expect(call("SUM", NA, columnRange([DIV0]))).toBe(NA);
    expect(call("SUM")).toBe(NA);
  });
});

describe("AVERAGE and AVG", () => {
  it("divides by the numbers it actually found", () => {
    expect(call("AVERAGE", 1, 2, 3)).toBe(2);
    expect(call("AVERAGE", columnRange([1, 2, 3, "x", null]))).toBe(2);
  });

  it("does not let a blank CELL join the population, while a blank scalar does", () => {
    expect(call("AVERAGE", columnRange([null]), 2)).toBe(2);
    expect(call("AVERAGE", null, 2)).toBe(1);
  });

  it("is #DIV/0! with nothing to average", () => {
    expect(call("AVERAGE", columnRange([null, "x"]))).toBe(DIV0);
  });

  it("answers to the old AVG spelling", () => {
    expect(call("AVG", 1, 2, 3)).toBe(2);
    expect(call("AVG", columnRange([]))).toBe(DIV0);
    expect(getFunction("AVG")?.name).toBe("AVG");
  });
});

describe("MIN and MAX", () => {
  it("ignore non-numbers and fall back to 0", () => {
    expect(call("MIN", columnRange([3, 1, 2]))).toBe(1);
    expect(call("MAX", columnRange([3, 1, 2]))).toBe(3);
    expect(call("MIN", -5, 2)).toBe(-5);
    expect(call("MIN", columnRange(["x", null]))).toBe(0);
    expect(call("MAX", columnRange(["x", null]))).toBe(0);
  });

  it("propagate an error out of a range", () => {
    expect(call("MAX", columnRange([1, REF]))).toBe(REF);
  });
});

describe("COUNT versus COUNTA", () => {
  const mixed = columnRange([1, null, "", "x", true, DIV0, 2.5]);

  it("counts numbers only, blanks and text excluded", () => {
    expect(call("COUNT", mixed)).toBe(2);
    expect(call("COUNT", columnRange([null, null]))).toBe(0);
    expect(call("COUNT", columnRange([0]))).toBe(1);
  });

  it("counts every cell that is not blank, errors included", () => {
    expect(call("COUNTA", mixed)).toBe(6);
    expect(call("COUNTA", columnRange([null, null]))).toBe(0);
    expect(call("COUNTA", columnRange([""]))).toBe(1);
  });

  it("separates a zero from an empty cell", () => {
    const zeros = columnRange([0, null, 0]);
    expect(call("COUNT", zeros)).toBe(2);
    expect(call("COUNTA", zeros)).toBe(2);
  });

  it("treats direct arguments the way Excel does", () => {
    expect(call("COUNT", 1, "2", true, "abc", null)).toBe(3);
    expect(call("COUNTA", 1, "abc", null, "")).toBe(3);
  });

  it("propagates a scalar error only for COUNT", () => {
    expect(call("COUNT", DIV0)).toBe(DIV0);
    expect(call("COUNTA", DIV0)).toBe(1);
  });
});

describe("IF", () => {
  it("returns the chosen branch", () => {
    expect(call("IF", true, "yes", "no")).toBe("yes");
    expect(call("IF", false, "yes", "no")).toBe("no");
    expect(call("IF", 0, "yes", "no")).toBe("no");
  });

  it("is FALSE when the else branch is omitted", () => {
    expect(call("IF", false, "yes")).toBe(false);
  });

  it("never evaluates the branch it does not take", () => {
    let taken = 0;
    const counted: ArgThunk = () => {
      taken++;
      return 1 / 0;
    };
    expect(callFunction("IF", [() => true, () => "yes", counted], ctx)).toBe("yes");
    expect(taken).toBe(0);
  });

  it("reports a condition it cannot read", () => {
    expect(call("IF", "abc", 1, 2)).toBe(VALUE);
    expect(call("IF", DIV0, 1, 2)).toBe(DIV0);
    expect(call("IF", columnRange([1, 2]), 1, 2)).toBe(VALUE);
  });

  it("checks arity", () => {
    expect(call("IF", true)).toBe(NA);
    expect(call("IF", true, 1, 2, 3)).toBe(NA);
  });

  it("has no array result to return", () => {
    expect(call("IF", true, columnRange([1, 2]), 0)).toBe(VALUE);
    expect(call("IF", true, columnRange([9]), 0)).toBe(9);
  });
});

describe("IFERROR", () => {
  it("catches every error value the engine can raise", () => {
    for (const code of CELL_ERRORS) {
      expect(call("IFERROR", cellError(code), "caught")).toBe("caught");
    }
  });

  it("passes a healthy value through, blanks included", () => {
    expect(call("IFERROR", 5, "caught")).toBe(5);
    expect(call("IFERROR", null, "caught")).toBeNull();
    expect(call("IFERROR", false, "caught")).toBe(false);
  });

  it("falls back to empty text when no fallback is given", () => {
    expect(call("IFERROR", DIV0)).toBe("");
  });

  it("treats a multi-cell range as the failure it is", () => {
    expect(call("IFERROR", columnRange([1, 2]), "caught")).toBe("caught");
    expect(call("IFERROR", columnRange([1]), "caught")).toBe(1);
  });

  it("does not evaluate the fallback unless it is needed", () => {
    let taken = 0;
    const counted: ArgThunk = () => {
      taken++;
      return "fallback";
    };
    expect(callFunction("IFERROR", [() => 1, counted], ctx)).toBe(1);
    expect(taken).toBe(0);
    expect(callFunction("IFERROR", [() => REF, counted], ctx)).toBe("fallback");
    expect(taken).toBe(1);
  });
});

describe("AND, OR, NOT", () => {
  it("combine logical values", () => {
    expect(call("AND", true, true)).toBe(true);
    expect(call("AND", true, false)).toBe(false);
    expect(call("OR", false, true)).toBe(true);
    expect(call("OR", false, false)).toBe(false);
    expect(call("AND", 1, 2)).toBe(true);
    expect(call("OR", 0, 0)).toBe(false);
    expect(call("NOT", false)).toBe(true);
    expect(call("NOT", 1)).toBe(false);
  });

  it("ignore text inside a range but reject a text scalar", () => {
    expect(call("AND", columnRange([true, "skip", null, 1]))).toBe(true);
    expect(call("OR", columnRange([false, "skip"]))).toBe(false);
    expect(call("AND", "yes")).toBe(VALUE);
  });

  it("are #VALUE! when nothing logical was supplied", () => {
    expect(call("AND", columnRange(["a", null]))).toBe(VALUE);
    expect(call("OR", columnRange([]))).toBe(VALUE);
  });

  it("do not short-circuit past an error", () => {
    expect(call("AND", false, DIV0)).toBe(DIV0);
    expect(call("OR", true, DIV0)).toBe(DIV0);
  });

  it("check arity", () => {
    expect(call("NOT")).toBe(NA);
    expect(call("NOT", true, true)).toBe(NA);
    expect(call("AND")).toBe(NA);
  });
});

describe("text functions", () => {
  it("CONCAT joins values and the cells of a range", () => {
    expect(call("CONCAT", "a", 1, true, null)).toBe("a1TRUE");
    expect(call("CONCAT", columnRange(["a", null, "b"]))).toBe("ab");
    expect(call("CONCAT", "a", DIV0)).toBe(DIV0);
    expect(call("CONCAT")).toBe(NA);
  });

  it("CONCAT refuses to build a runaway string", () => {
    const chunk = "x".repeat(MAX_TEXT_LENGTH - 1);
    expect(call("CONCAT", chunk, "y")).toBe(chunk + "y");
    expect(call("CONCAT", chunk, "yy")).toBe(VALUE);
  });

  it("LEFT and RIGHT default to one character and clamp at the ends", () => {
    expect(call("LEFT", "hello")).toBe("h");
    expect(call("LEFT", "hello", 3)).toBe("hel");
    expect(call("LEFT", "hello", 99)).toBe("hello");
    expect(call("LEFT", "hello", 0)).toBe("");
    expect(call("RIGHT", "hello")).toBe("o");
    expect(call("RIGHT", "hello", 2)).toBe("lo");
    expect(call("RIGHT", "hello", 99)).toBe("hello");
    expect(call("RIGHT", "hello", 0)).toBe("");
    expect(call("LEFT", 123.5, 2)).toBe("12");
    expect(call("LEFT", "hello", -1)).toBe(VALUE);
    expect(call("RIGHT", "hello", -1)).toBe(VALUE);
  });

  it("MID is 1-based and forgiving past the end", () => {
    expect(call("MID", "hello", 2, 3)).toBe("ell");
    expect(call("MID", "hello", 9, 2)).toBe("");
    expect(call("MID", "hello", 2, 0)).toBe("");
    expect(call("MID", "hello", 0, 2)).toBe(VALUE);
    expect(call("MID", "hello", 2, -1)).toBe(VALUE);
    expect(call("MID", "hello", 2)).toBe(NA);
  });

  it("LEN measures the text form of any value", () => {
    expect(call("LEN", "abc")).toBe(3);
    expect(call("LEN", 123)).toBe(3);
    expect(call("LEN", null)).toBe(0);
    expect(call("LEN", true)).toBe(4);
    expect(call("LEN", DIV0)).toBe(DIV0);
  });

  it("TRIM collapses inner runs as well as the ends", () => {
    expect(call("TRIM", "  a   b  ")).toBe("a b");
    expect(call("TRIM", "a\t\tb")).toBe("a b");
    expect(call("TRIM", "   ")).toBe("");
  });

  it("UPPER and LOWER", () => {
    expect(call("UPPER", "aBc")).toBe("ABC");
    expect(call("LOWER", "aBc")).toBe("abc");
  });

  it("SUBSTITUTE replaces all occurrences or exactly one", () => {
    expect(call("SUBSTITUTE", "a-b-c", "-", "+")).toBe("a+b+c");
    expect(call("SUBSTITUTE", "a-b-c", "-", "+", 2)).toBe("a-b+c");
    expect(call("SUBSTITUTE", "a-b-c", "-", "+", 9)).toBe("a-b-c");
    expect(call("SUBSTITUTE", "a-b-c", "x", "+")).toBe("a-b-c");
    expect(call("SUBSTITUTE", "aA", "a", "x")).toBe("xA");
    expect(call("SUBSTITUTE", "abc", "", "x")).toBe("abc");
    expect(call("SUBSTITUTE", "a-b", "-", "+", 0)).toBe(VALUE);
  });
});

describe("math functions", () => {
  it("ROUND goes half away from zero", () => {
    expect(call("ROUND", -2.5)).toBe(-3);
    expect(call("ROUND", 2.5)).toBe(3);
    expect(call("ROUND", 2.4)).toBe(2);
    expect(call("ROUND", -2.4)).toBe(-2);
    expect(call("ROUND", 2.675, 2)).toBe(2.68);
    expect(call("ROUND", 1234, -2)).toBe(1200);
    expect(call("ROUND", "abc")).toBe(VALUE);
    expect(call("ROUND", 1, 2, 3)).toBe(NA);
  });

  it("ABS", () => {
    expect(call("ABS", -3)).toBe(3);
    expect(call("ABS", 3)).toBe(3);
    expect(call("ABS", "-3")).toBe(3);
    expect(call("ABS", DIV0)).toBe(DIV0);
  });

  it("POW, including the two ways it can fail", () => {
    expect(call("POW", 2, 10)).toBe(1024);
    expect(call("POW", 0, 0)).toBe(1);
    expect(call("POW", 0, -1)).toBe(DIV0);
    expect(call("POW", -8, 1 / 3)).toBe(NUM);
    expect(call("POW", 10, 1000)).toBe(NUM);
    expect(call("POW", 2)).toBe(NA);
  });

  it("SQRT of a negative is an error, never NaN", () => {
    expect(call("SQRT", 9)).toBe(3);
    expect(call("SQRT", 0)).toBe(0);
    expect(call("SQRT", -1)).toBe(VALUE);
    expect(call("SQRT", "abc")).toBe(VALUE);
  });

  it("MOD takes the sign of the divisor and refuses zero", () => {
    expect(call("MOD", 7, 3)).toBe(1);
    expect(call("MOD", -3, 2)).toBe(1);
    expect(call("MOD", 3, -2)).toBe(-1);
    expect(call("MOD", -3, -2)).toBe(-1);
    expect(call("MOD", 5, 0)).toBe(DIV0);
    expect(call("MOD", 0, 0)).toBe(DIV0);
    expect(call("MOD", 5.5, 2)).toBeCloseTo(1.5, 10);
  });
});

describe("date functions", () => {
  it("TODAY and NOW read the injected clock, not the wall clock", () => {
    expect(call("NOW")).toBe(NOW_SERIAL);
    expect(call("TODAY")).toBe(46256);
    expect(call("TODAY")).toBe(Math.floor(NOW_SERIAL));
    expect(callFunctionWith("NOW", [], { now: 1 })).toBe(1);
  });

  it("TODAY and NOW take no arguments", () => {
    expect(call("TODAY", 1)).toBe(NA);
    expect(call("NOW", 1)).toBe(NA);
  });

  it("DATE builds a serial and rolls over out-of-range parts", () => {
    expect(call("DATE", 2026, 8, 22)).toBe(46256);
    expect(call("DATE", 2026, 13, 1)).toBe(serialFromParts(2027, 1, 1));
    expect(call("DATE", 2026, 1, 32)).toBe(serialFromParts(2026, 2, 1));
    expect(call("DATE", 2026, 8, 22.9)).toBe(46256);
  });

  it("DATE reads a two-digit year as 19xx, as Sheets does", () => {
    expect(call("DATE", 26, 1, 1)).toBe(serialFromParts(1926, 1, 1));
    expect(call("DATE", 0, 1, 1)).toBe(serialFromParts(1900, 1, 1));
    expect(call("DATE", -1, 1, 1)).toBe(NUM);
    expect(call("DATE", "abc", 1, 1)).toBe(VALUE);
    expect(call("DATE", 2026, 1)).toBe(NA);
  });

  it("DATEDIF counts whole units", () => {
    const start = serialFromParts(2020, 1, 15);
    const end = serialFromParts(2026, 8, 22);
    expect(call("DATEDIF", start, end, "Y")).toBe(6);
    expect(call("DATEDIF", start, end, "M")).toBe(79);
    expect(call("DATEDIF", start, end, "D")).toBe(end - start);
    expect(call("DATEDIF", start, end, "YM")).toBe(7);
    expect(call("DATEDIF", start, end, "MD")).toBe(7);
    expect(call("DATEDIF", start, end, "YD")).toBe(219);
    expect(call("DATEDIF", start, end, "d")).toBe(end - start);
  });

  it("DATEDIF does not credit an incomplete unit", () => {
    const start = serialFromParts(2024, 1, 31);
    expect(call("DATEDIF", start, serialFromParts(2024, 3, 1), "M")).toBe(1);
    expect(call("DATEDIF", start, serialFromParts(2024, 2, 29), "M")).toBe(0);
    expect(call("DATEDIF", start, serialFromParts(2024, 3, 1), "D")).toBe(30);
    // The 31st has no anchor in February; Excel would go negative, we clamp.
    expect(call("DATEDIF", start, serialFromParts(2024, 3, 1), "MD")).toBe(0);
  });

  it("DATEDIF rejects a backwards span and an unknown unit", () => {
    const start = serialFromParts(2026, 1, 1);
    const end = serialFromParts(2025, 1, 1);
    expect(call("DATEDIF", start, end, "D")).toBe(NUM);
    expect(call("DATEDIF", end, start, "W")).toBe(NUM);
    expect(call("DATEDIF", end, start, "")).toBe(NUM);
    expect(call("DATEDIF", "abc", start, "D")).toBe(VALUE);
  });

  it("DATEDIF ignores the time of day", () => {
    const start = serialFromParts(2026, 1, 1, 23, 0, 0);
    const end = serialFromParts(2026, 1, 2, 1, 0, 0);
    expect(call("DATEDIF", start, end, "D")).toBe(1);
  });
});

describe("conditional aggregates", () => {
  const data = columnRange([1, 5, 10, "apple", "Apricot", null, "", true]);

  it("COUNTIF matches values, comparisons and wildcards", () => {
    expect(call("COUNTIF", data, ">4")).toBe(2);
    expect(call("COUNTIF", data, ">=5")).toBe(2);
    expect(call("COUNTIF", data, "<5")).toBe(1);
    expect(call("COUNTIF", data, 5)).toBe(1);
    expect(call("COUNTIF", data, "5")).toBe(1);
    expect(call("COUNTIF", data, "=5")).toBe(1);
    expect(call("COUNTIF", data, "apple")).toBe(1);
    expect(call("COUNTIF", data, "APPLE")).toBe(1);
    expect(call("COUNTIF", data, "ap*")).toBe(2);
    expect(call("COUNTIF", data, "a??le")).toBe(1);
    expect(call("COUNTIF", data, "TRUE")).toBe(1);
  });

  it("COUNTIF separates blank from zero", () => {
    expect(call("COUNTIF", data, "")).toBe(2);
    expect(call("COUNTIF", data, "<>")).toBe(6);
    expect(call("COUNTIF", columnRange([0, null]), 0)).toBe(1);
    expect(call("COUNTIF", columnRange([0, null]), "")).toBe(1);
    expect(call("COUNTIF", columnRange([null, 7]), ">0")).toBe(1);
  });

  it("COUNTIF keeps an ISO date criterion as text, so a date column matches", () => {
    const dates = columnRange(["2026-08-21", "2026-08-22", "2026-09-01"]);
    expect(call("COUNTIF", dates, "2026-08-22")).toBe(1);
    // ISO-8601 sorts chronologically as text, so a range criterion still works.
    expect(call("COUNTIF", dates, ">2026-08-21")).toBe(2);
  });

  it("COUNTIF can look for a literal asterisk", () => {
    expect(call("COUNTIF", columnRange(["a*b", "axb"]), "a~*b")).toBe(1);
    expect(call("COUNTIF", columnRange(["a*b", "axb"]), "a*b")).toBe(2);
  });

  it("COUNTIF ignores errors in the range but reports a bad criterion", () => {
    expect(call("COUNTIF", columnRange([1, DIV0, 5]), ">0")).toBe(2);
    expect(call("COUNTIF", data, DIV0)).toBe(DIV0);
    expect(call("COUNTIF", data)).toBe(NA);
  });

  it("SUMIF adds the companion cells", () => {
    const keys = columnRange(["a", "b", "a"]);
    const values = columnRange([1, 2, 3]);
    expect(call("SUMIF", keys, "a", values)).toBe(4);
    expect(call("SUMIF", keys, "z", values)).toBe(0);
    expect(call("SUMIF", columnRange([1, 5, 10]), ">4")).toBe(15);
  });

  it("SUMIF refuses a mismatched sum range", () => {
    expect(call("SUMIF", columnRange(["a", "b"]), "a", columnRange([1]))).toBe(VALUE);
    expect(
      call("SUMIF", columnRange(["a"]), "a", rangeValue([[1, 2]])),
    ).toBe(VALUE);
  });

  it("SUMIF works over a block and over a lone cell", () => {
    const keys = rangeValue([
      ["a", "b"],
      ["a", "c"],
    ]);
    const values = rangeValue([
      [1, 2],
      [3, 4],
    ]);
    expect(call("SUMIF", keys, "a", values)).toBe(4);
    expect(call("SUMIF", "a", "a", 7)).toBe(7);
  });

  it("SUMIF only propagates poison it was asked to add", () => {
    const keys = columnRange(["a", "b"]);
    expect(call("SUMIF", keys, "a", columnRange([DIV0, 2]))).toBe(DIV0);
    expect(call("SUMIF", keys, "b", columnRange([DIV0, 2]))).toBe(2);
  });

  it("AVERAGEIF is #DIV/0! when nothing matched", () => {
    const keys = columnRange(["a", "b", "a"]);
    const values = columnRange([1, 2, 3]);
    expect(call("AVERAGEIF", keys, "a", values)).toBe(2);
    expect(call("AVERAGEIF", keys, "z", values)).toBe(DIV0);
    expect(call("AVERAGEIF", keys, "b", columnRange(["x", "y", "z"]))).toBe(DIV0);
  });
});

describe("VLOOKUP", () => {
  const table = rangeValue([
    [10, "ten"],
    [20, "twenty"],
    [30, null],
  ]);

  it("finds an exact match when told the range is unsorted", () => {
    expect(call("VLOOKUP", 20, table, 2, false)).toBe("twenty");
    expect(call("VLOOKUP", 10, table, 1, false)).toBe(10);
  });

  it("misses cleanly", () => {
    expect(call("VLOOKUP", 25, table, 2, false)).toBe(NA);
    expect(call("VLOOKUP", "nope", table, 2, false)).toBe(NA);
    expect(call("VLOOKUP", 5, table, 2)).toBe(NA);
  });

  it("defaults to the approximate, sorted-range mode", () => {
    expect(call("VLOOKUP", 25, table, 2)).toBe("twenty");
    expect(call("VLOOKUP", 30, table, 1)).toBe(30);
    expect(call("VLOOKUP", 999, table, 1)).toBe(30);
  });

  it("reads a found-but-empty cell as 0", () => {
    expect(call("VLOOKUP", 30, table, 2, false)).toBe(0);
  });

  it("validates the column index", () => {
    expect(call("VLOOKUP", 10, table, 0, false)).toBe(VALUE);
    expect(call("VLOOKUP", 10, table, -1, false)).toBe(VALUE);
    expect(call("VLOOKUP", 10, table, 3, false)).toBe(REF);
    expect(call("VLOOKUP", 10, table, "abc", false)).toBe(VALUE);
    expect(call("VLOOKUP", 10, table)).toBe(NA);
  });

  it("matches text case-insensitively and supports wildcards", () => {
    const names = rangeValue([
      ["Apple", 1],
      ["Banana", 2],
    ]);
    expect(call("VLOOKUP", "apple", names, 2, false)).toBe(1);
    expect(call("VLOOKUP", "ban*", names, 2, false)).toBe(2);
  });

  it("does not accept a blank row as the zero it was asked for", () => {
    const sparse = rangeValue([
      [null, "empty"],
      [0, "zero"],
    ]);
    expect(call("VLOOKUP", 0, sparse, 2, false)).toBe("zero");
  });

  it("does not order text against a numeric key", () => {
    const mixed = rangeValue([
      ["zebra", 1],
      [5, 2],
    ]);
    expect(call("VLOOKUP", 10, mixed, 2)).toBe(2);
  });
});

describe("INDEX", () => {
  const grid = rangeValue([
    [1, 2],
    [3, 4],
  ]);

  it("picks by row and column, 1-based", () => {
    expect(call("INDEX", grid, 2, 1)).toBe(3);
    expect(call("INDEX", grid, 1, 2)).toBe(2);
  });

  it("takes a single index along a vector", () => {
    expect(call("INDEX", columnRange([1, 2, 3]), 2)).toBe(2);
    expect(call("INDEX", rowRange([1, 2, 3]), 3)).toBe(3);
  });

  it("will not guess for a block, and has no array form", () => {
    expect(call("INDEX", grid, 1)).toBe(VALUE);
    expect(call("INDEX", grid, 0, 1)).toBe(VALUE);
    expect(call("INDEX", grid, 1, 0)).toBe(VALUE);
  });

  it("is #REF! past the edge", () => {
    expect(call("INDEX", grid, 3, 1)).toBe(REF);
    expect(call("INDEX", grid, 1, 3)).toBe(REF);
    expect(call("INDEX", rangeValue([]), 1, 1)).toBe(REF);
  });

  it("reads an empty cell as 0 and truncates a fractional index", () => {
    expect(call("INDEX", columnRange([null]), 1)).toBe(0);
    expect(call("INDEX", columnRange([1, 2, 3]), 2.9)).toBe(2);
  });
});

describe("MATCH", () => {
  const ascending = columnRange([10, 20, 30]);

  it("finds an exact position with type 0", () => {
    expect(call("MATCH", 20, ascending, 0)).toBe(2);
    expect(call("MATCH", 25, ascending, 0)).toBe(NA);
    expect(call("MATCH", "ap*", columnRange(["banana", "apple"]), 0)).toBe(2);
  });

  it("defaults to type 1, the largest value not above the key", () => {
    expect(call("MATCH", 25, ascending)).toBe(2);
    expect(call("MATCH", 30, ascending)).toBe(3);
    expect(call("MATCH", 5, ascending)).toBe(NA);
  });

  it("walks a descending vector with type -1", () => {
    const descending = columnRange([30, 20, 10]);
    expect(call("MATCH", 25, descending, -1)).toBe(1);
    expect(call("MATCH", 10, descending, -1)).toBe(3);
    expect(call("MATCH", 99, descending, -1)).toBe(NA);
  });

  it("needs a vector, not a block", () => {
    expect(
      call(
        "MATCH",
        1,
        rangeValue([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toBe(NA);
  });

  it("works along a row and validates its arity", () => {
    expect(call("MATCH", 20, rowRange([10, 20, 30]), 0)).toBe(2);
    expect(call("MATCH", 20)).toBe(NA);
    expect(call("MATCH", 20, ascending, 0, 1)).toBe(NA);
  });
});

describe("rounding and integers", () => {
  it("ROUNDUP goes away from zero, ROUNDDOWN and TRUNC toward it", () => {
    expect(call("ROUNDUP", 3.14159, 2)).toBe(3.15);
    expect(call("ROUNDUP", -3.14159, 2)).toBe(-3.15);
    expect(call("ROUNDUP", 3.001)).toBe(4);
    expect(call("ROUNDDOWN", 3.999, 2)).toBe(3.99);
    expect(call("ROUNDDOWN", -3.999, 0)).toBe(-3);
    expect(call("TRUNC", 8.9)).toBe(8);
    expect(call("TRUNC", -8.9)).toBe(-8);
    expect(call("TRUNC", 3.14159, 2)).toBe(3.14);
  });

  it("INT floors toward minus infinity, unlike TRUNC", () => {
    expect(call("INT", 2.9)).toBe(2);
    expect(call("INT", -2.1)).toBe(-3);
    expect(call("TRUNC", -2.1)).toBe(-2);
  });

  it("CEILING and FLOOR snap to a multiple", () => {
    expect(call("CEILING", 7)).toBe(7);
    expect(call("CEILING", 6.1, 5)).toBe(10);
    expect(call("FLOOR", 6.9, 5)).toBe(5);
    expect(call("CEILING", 5, 0)).toBe(0);
    expect(call("FLOOR", 5, 0)).toBe(0);
  });

  it("corrects float representation so common money inputs stay exact", () => {
    // Without the toPrecision snap these each drop or add a whole unit,
    // because e.g. 0.29 * 100 is 28.999999999999996 in IEEE-754.
    expect(call("ROUNDDOWN", 0.29, 2)).toBe(0.29);
    expect(call("ROUNDDOWN", 2.01, 2)).toBe(2.01);
    expect(call("TRUNC", 0.58, 2)).toBe(0.58);
    expect(call("ROUNDUP", 1.1, 2)).toBe(1.1);
    expect(call("ROUNDUP", 1.1, 1)).toBe(1.1);
    expect(call("FLOOR", 0.3, 0.1)).toBe(0.3);
    expect(call("FLOOR", 0.29, 0.01)).toBe(0.29);
    expect(call("CEILING", 0.07, 0.01)).toBe(0.07);
    expect(call("CEILING", 1.1, 0.1)).toBe(1.1);
  });

  it("SIGN, PRODUCT, MEDIAN and POWER", () => {
    expect(call("SIGN", -8)).toBe(-1);
    expect(call("SIGN", 0)).toBe(0);
    expect(call("PRODUCT", 2, 3, 4)).toBe(24);
    expect(call("PRODUCT", columnRange([2, "x", 5, null]))).toBe(10);
    expect(call("MEDIAN", 3, 1, 2)).toBe(2);
    expect(call("MEDIAN", 1, 2, 3, 4)).toBe(2.5);
    expect(call("MEDIAN", columnRange(["x", "y"]))).toBe(NUM);
    expect(call("POWER", 2, 10)).toBe(1024);
  });
});

describe("logical (extended)", () => {
  it("XOR is true on an odd number of trues", () => {
    expect(call("XOR", true, false)).toBe(true);
    expect(call("XOR", true, true)).toBe(false);
    expect(call("XOR", columnRange([true, true, true]))).toBe(true);
    expect(call("XOR", columnRange([]))).toBe(VALUE);
  });

  it("IFS returns the first true branch, else #N/A", () => {
    expect(call("IFS", false, "a", true, "b")).toBe("b");
    expect(call("IFS", true, "a", true, "b")).toBe("a");
    expect(call("IFS", false, "a", false, "b")).toBe(NA);
  });

  it("SWITCH matches a case or falls back to a default", () => {
    expect(call("SWITCH", 2, 1, "one", 2, "two")).toBe("two");
    expect(call("SWITCH", 9, 1, "one", 2, "two", "other")).toBe("other");
    expect(call("SWITCH", 9, 1, "one")).toBe(NA);
  });

  it("IFNA replaces only #N/A", () => {
    expect(call("IFNA", NA, "fallback")).toBe("fallback");
    expect(call("IFNA", 5, "fallback")).toBe(5);
    expect(call("IFNA", DIV0, "fallback")).toBe(DIV0);
  });
});

describe("text (extended)", () => {
  it("PROPER title-cases words", () => {
    expect(call("PROPER", "hELLO woRLD")).toBe("Hello World");
    expect(call("PROPER", "o'neil-smith")).toBe("O'Neil-Smith");
  });

  it("REPT repeats and caps runaway output", () => {
    expect(call("REPT", "ab", 3)).toBe("ababab");
    expect(call("REPT", "x", 0)).toBe("");
    expect(call("REPT", "x", -1)).toBe(VALUE);
    expect(call("REPT", "xy", MAX_TEXT_LENGTH)).toBe(VALUE);
  });

  it("EXACT, FIND and SEARCH", () => {
    expect(call("EXACT", "Abc", "Abc")).toBe(true);
    expect(call("EXACT", "Abc", "abc")).toBe(false);
    expect(call("FIND", "b", "abcabc")).toBe(2);
    expect(call("FIND", "b", "abcabc", 3)).toBe(5);
    expect(call("FIND", "B", "abc")).toBe(VALUE);
    expect(call("SEARCH", "B", "aBc")).toBe(2);
    expect(call("SEARCH", "z", "abc")).toBe(VALUE);
  });

  it("VALUE parses text and TEXTJOIN joins", () => {
    expect(call("VALUE", "42")).toBe(42);
    expect(call("VALUE", " 3.5 ")).toBe(3.5);
    expect(call("VALUE", "")).toBe(0);
    expect(call("VALUE", "abc")).toBe(VALUE);
    expect(call("TEXTJOIN", "-", true, "a", "", "b")).toBe("a-b");
    expect(call("TEXTJOIN", "-", false, "a", "", "b")).toBe("a--b");
    expect(call("TEXTJOIN", ", ", true, columnRange(["x", null, "y"]))).toBe("x, y");
  });
});

describe("date parts", () => {
  const stamp = serialFromParts(2026, 8, 19, 13, 30, 0);

  it("YEAR / MONTH / DAY / HOUR / MINUTE read the serial", () => {
    expect(call("YEAR", stamp)).toBe(2026);
    expect(call("MONTH", stamp)).toBe(8);
    expect(call("DAY", stamp)).toBe(19);
    expect(call("HOUR", stamp)).toBe(13);
    expect(call("MINUTE", stamp)).toBe(30);
  });

  it("WEEKDAY answers each numbering type", () => {
    // 2026-08-19 is a Wednesday.
    expect(call("WEEKDAY", stamp)).toBe(4); // type 1: Sun=1
    expect(call("WEEKDAY", stamp, 2)).toBe(3); // type 2: Mon=1
    expect(call("WEEKDAY", stamp, 3)).toBe(2); // type 3: Mon=0
    expect(call("WEEKDAY", stamp, 9)).toBe(NUM);
    // A serial past the representable range errors like the other date parts.
    expect(call("WEEKDAY", 200000000)).toBe(NUM);
    expect(call("YEAR", 200000000)).toBe(NUM);
  });

  it("DAYS counts whole days between serials", () => {
    expect(call("DAYS", serialFromParts(2026, 8, 19), serialFromParts(2026, 8, 9))).toBe(10);
  });

  it("EDATE shifts months and clamps to the last day", () => {
    expect(call("EDATE", serialFromParts(2026, 1, 31), 1)).toBe(serialFromParts(2026, 2, 28));
    expect(call("EDATE", serialFromParts(2026, 3, 15), -1)).toBe(serialFromParts(2026, 2, 15));
    expect(call("EDATE", serialFromParts(2026, 12, 10), 1)).toBe(serialFromParts(2027, 1, 10));
  });

  it("EOMONTH lands on the month end", () => {
    expect(call("EOMONTH", serialFromParts(2026, 1, 15), 0)).toBe(serialFromParts(2026, 1, 31));
    expect(call("EOMONTH", serialFromParts(2026, 1, 31), 1)).toBe(serialFromParts(2026, 2, 28));
    expect(call("EOMONTH", serialFromParts(2026, 2, 15), -1)).toBe(serialFromParts(2026, 1, 31));
  });
});

describe("multi-criteria conditionals", () => {
  const region = columnRange(["N", "S", "N", "S", "N"]);
  const amount = columnRange([10, 20, 30, 40, 50]);

  it("COUNTIFS counts rows meeting every criterion", () => {
    expect(call("COUNTIFS", region, "N")).toBe(3);
    expect(call("COUNTIFS", region, "N", amount, ">20")).toBe(2);
    expect(call("COUNTIFS", region, "Z")).toBe(0);
  });

  it("SUMIFS and AVERAGEIFS aggregate the matched rows", () => {
    expect(call("SUMIFS", amount, region, "N")).toBe(90);
    expect(call("SUMIFS", amount, region, "N", amount, ">20")).toBe(80);
    expect(call("AVERAGEIFS", amount, region, "N")).toBe(30);
    expect(call("AVERAGEIFS", amount, region, "Z")).toBe(DIV0);
  });

  it("refuses a criteria range of a different shape", () => {
    expect(call("SUMIFS", amount, columnRange(["N", "S"]), "N")).toBe(VALUE);
    expect(call("COUNTIFS", region, "N", columnRange([1, 2]), ">0")).toBe(VALUE);
  });

  it("declares range slots for far more than a handful of criteria pairs", () => {
    // So a bare [Header] ref in a late criteria slot still widens to its
    // column instead of narrowing to the current row. COUNTIFS ranges are
    // even slots; SUMIFS/AVERAGEIFS reserve slot 0 and use the odd slots.
    const count = RANGE_ARGUMENTS.get("COUNTIFS") as readonly number[];
    const sumifs = RANGE_ARGUMENTS.get("SUMIFS") as readonly number[];
    expect(count).toContain(20); // 10th criteria range
    expect(count).not.toContain(21); // its criterion stays scalar
    expect(sumifs).toContain(0); // the sum range
    expect(sumifs).toContain(21); // 11th criteria range
    expect(sumifs).not.toContain(20); // that criterion stays scalar
    expect(RANGE_ARGUMENTS.get("AVERAGEIFS")).toBe(sumifs);
  });
});

describe("type tests", () => {
  it("classify a value without being poisoned by an error", () => {
    expect(call("ISNUMBER", 5)).toBe(true);
    expect(call("ISNUMBER", "5")).toBe(false);
    expect(call("ISTEXT", "x")).toBe(true);
    expect(call("ISTEXT", 5)).toBe(false);
    expect(call("ISLOGICAL", true)).toBe(true);
    expect(call("ISLOGICAL", 1)).toBe(false);
    expect(call("ISBLANK", null)).toBe(true);
    expect(call("ISBLANK", "")).toBe(false);
    expect(call("ISERROR", DIV0)).toBe(true);
    expect(call("ISERROR", 5)).toBe(false);
    expect(call("ISNA", NA)).toBe(true);
    expect(call("ISNA", DIV0)).toBe(false);
  });

  it("ISEVEN and ISODD use the integer part", () => {
    expect(call("ISEVEN", 4)).toBe(true);
    expect(call("ISEVEN", 3.9)).toBe(false);
    expect(call("ISODD", 3)).toBe(true);
    expect(call("ISODD", -3)).toBe(true);
    expect(call("ISEVEN", "x")).toBe(VALUE);
  });
});
