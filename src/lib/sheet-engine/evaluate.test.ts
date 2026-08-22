import { describe, expect, it } from "vitest";

import {
  BASIC_COERCIONS,
  argumentContext,
  createGridSheet,
  evaluate,
  evaluateFormula,
  isRangeValue,
  walkRefs,
  type FunctionArg,
  type FunctionEntry,
  type FunctionImpl,
  type RangeValue,
  type RefContext,
  type SheetAccess,
} from "./evaluate";
import { parseFormula } from "./parser";
import { cellError, type CellValue } from "./types";

// A1 B1 C1 header row is data too: the sheet model has no header row, headers
// are column metadata.
const GRID: CellValue[][] = [
  [1, 2, "x"],
  [10, 20, "y"],
  [100, 200, null],
];

const HEADERS = ["Qty", "Price", "Note"];

function sheet(grid: CellValue[][] = GRID): SheetAccess {
  return createGridSheet(grid, HEADERS);
}

function registry(entries: Record<string, FunctionEntry | FunctionImpl>) {
  return new Map(Object.entries(entries));
}

// Contextual typing does not reach into an object literal sitting in a union
// position, so entries are tagged on the way in.
function entry(spec: FunctionEntry): FunctionEntry {
  return spec;
}

function run(
  source: string,
  options: {
    grid?: CellValue[][];
    origin?: { row: number; col: number } | null;
    functions?: Map<string, FunctionEntry | FunctionImpl>;
    sheet?: SheetAccess;
  } = {},
): CellValue {
  return evaluateFormula(source, {
    sheet: options.sheet ?? sheet(options.grid),
    origin: "origin" in options ? options.origin : { row: 0, col: 3 },
    functions: options.functions,
  });
}

function err(code: Parameters<typeof cellError>[0]) {
  return cellError(code);
}

describe("literals and operators", () => {
  it("evaluates arithmetic with the parser's precedence", () => {
    expect(run("1+2*3")).toBe(7);
    expect(run("(1+2)*3")).toBe(9);
    expect(run("2^3^2")).toBe(512);
    expect(run("-2^2")).toBe(-4);
    expect(run("10%")).toBeCloseTo(0.1);
    expect(run("50%*2")).toBe(1);
  });

  it("accepts a leading = the way a user types it", () => {
    expect(run("=1+1")).toBe(2);
  });

  it("concatenates with & and coerces both sides to text", () => {
    expect(run('"a"&1')).toBe("a1");
    expect(run("TRUE&\"!\"")).toBe("TRUE!");
  });

  it("compares without crossing types", () => {
    expect(run("1=1")).toBe(true);
    expect(run('1="1"')).toBe(false);
    expect(run("2<\"apple\"")).toBe(true);
    expect(run("1<>2")).toBe(true);
    expect(run("2>=2")).toBe(true);
  });

  it("returns #DIV/0! rather than Infinity", () => {
    expect(run("1/0")).toEqual(err("#DIV/0!"));
    expect(run("0^-1")).toEqual(err("#DIV/0!"));
  });

  it("returns #NUM! for a result that leaves the reals or overflows", () => {
    expect(run("(-8)^0.5")).toEqual(err("#NUM!"));
    expect(run("1e308*10")).toEqual(err("#NUM!"));
  });

  it("returns #VALUE! when text cannot be a number", () => {
    expect(run('"abc"+1')).toEqual(err("#VALUE!"));
    expect(run('"12"+1')).toBe(13);
  });

  it("propagates a literal error through every operator", () => {
    expect(run("#N/A+1")).toEqual(err("#N/A"));
    expect(run("1+#N/A")).toEqual(err("#N/A"));
    expect(run('#N/A&"x"')).toEqual(err("#N/A"));
    expect(run("-#N/A")).toEqual(err("#N/A"));
    expect(run("#N/A%")).toEqual(err("#N/A"));
    expect(run("#N/A=1")).toEqual(err("#N/A"));
  });

  it("keeps the left error when both sides are poisoned", () => {
    expect(run("#N/A+#REF!")).toEqual(err("#N/A"));
  });
});

describe("references", () => {
  it("reads a cell", () => {
    expect(run("A1")).toBe(1);
    expect(run("B2")).toBe(20);
    expect(run("$C$1")).toBe("x");
  });

  it("reads an empty cell as blank, which is 0 in arithmetic", () => {
    expect(run("C3")).toBe(null);
    expect(run("C3+1")).toBe(1);
  });

  it("returns #REF! past the edge of the sheet", () => {
    expect(run("A9")).toEqual(err("#REF!"));
    expect(run("Z1")).toEqual(err("#REF!"));
  });

  it("narrows a whole-column ref to the origin row", () => {
    expect(run("A", { origin: { row: 1, col: 3 } })).toBe(10);
    expect(run("A:A", { origin: { row: 2, col: 3 } })).toBe(100);
    expect(run("[Price]", { origin: { row: 1, col: 3 } })).toBe(20);
  });

  it("is #VALUE! for a whole-column ref with no row to narrow to", () => {
    expect(run("A", { origin: null })).toEqual(err("#VALUE!"));
  });

  it("is #VALUE! for a multi-cell range in a scalar position", () => {
    expect(run("A1:A3")).toEqual(err("#VALUE!"));
    expect(run("A:B", { origin: { row: 0, col: 3 } })).toEqual(err("#VALUE!"));
  });

  it("collapses a 1x1 range to its value", () => {
    expect(run("A1:A1")).toBe(1);
  });

  it("is #NAME? for a header no column answers to", () => {
    expect(run("[Nope]")).toEqual(err("#NAME?"));
  });

  it("matches headers case-insensitively", () => {
    expect(run("[price]", { origin: { row: 0, col: 3 } })).toBe(2);
  });

  it("is #NAME? for a bare name with no resolver", () => {
    expect(run("Revenue")).toEqual(err("#NAME?"));
  });

  it("uses resolveName when the host supplies one", () => {
    const custom: SheetAccess = {
      ...createGridSheet(GRID, HEADERS),
      resolveName: (name) => (name === "Revenue" ? 42 : undefined),
    };
    expect(run("Revenue*2", { sheet: custom })).toBe(84);
    expect(run("Missing", { sheet: custom })).toEqual(err("#NAME?"));
  });
});

describe("function calls", () => {
  it("is #NAME? for an unknown function", () => {
    expect(run("NOPE(1)")).toEqual(err("#NAME?"));
  });

  it("accepts a bare function as well as an entry", () => {
    const functions = registry({
      DOUBLE: (args) => (args[0] as number) * 2,
      TRIPLE: entry({ call: (args) => (args[0] as number) * 3 }),
    });
    expect(run("DOUBLE(4)", { functions })).toBe(8);
    expect(run("TRIPLE(4)", { functions })).toBe(12);
  });

  it("hands a single-cell ref over as a 1x1 range, not a scalar", () => {
    let seen: FunctionArg | undefined;
    const functions = registry({
      PEEK: (args) => {
        seen = args[0];
        return 0;
      },
    });
    run("PEEK(A1)", { functions });
    expect(isRangeValue(seen as FunctionArg)).toBe(true);
    expect((seen as RangeValue).rows).toEqual([[1]]);
  });

  it("hands a literal over as a scalar", () => {
    let seen: FunctionArg | undefined;
    const functions = registry({
      PEEK: (args) => {
        seen = args[0];
        return 0;
      },
    });
    run("PEEK(7)", { functions });
    expect(seen).toBe(7);
  });

  it("keeps a whole column whole in an aggregate argument", () => {
    let seen: RangeValue | undefined;
    const functions = registry({
      SUM: (args) => {
        seen = args[0] as RangeValue;
        return 0;
      },
    });
    run("SUM(A)", { functions, origin: { row: 1, col: 3 } });
    expect(seen?.rows).toEqual([[1], [10], [100]]);
  });

  it("narrows a whole column in a scalar parameter", () => {
    let seen: RangeValue | undefined;
    const functions = registry({
      LEFT: (args) => {
        seen = args[0] as RangeValue;
        return 0;
      },
    });
    run("LEFT(A,2)", { functions, origin: { row: 1, col: 3 } });
    expect(seen?.rows).toEqual([[10]]);
  });

  it("lets the registry override the default range parameters", () => {
    let seen: RangeValue | undefined;
    const functions = registry({
      SUM: entry({
        call: (args) => ((seen = args[0] as RangeValue), 0),
        rangeArgs: false,
      }),
    });
    run("SUM(A)", { functions, origin: { row: 2, col: 3 } });
    expect(seen?.rows).toEqual([[100]]);
  });

  it("clamps a range to the sheet instead of inventing rows", () => {
    let seen: RangeValue | undefined;
    const functions = registry({
      SUM: (args) => ((seen = args[0] as RangeValue), 0),
    });
    run("SUM(A1:A100)", { functions });
    expect(seen?.rows).toEqual([[1], [10], [100]]);
  });

  it("gives an empty range for a box entirely off the sheet", () => {
    let seen: RangeValue | undefined;
    const functions = registry({
      SUM: (args) => ((seen = args[0] as RangeValue), 0),
    });
    run("SUM(Z1:Z9)", { functions });
    expect(seen?.rows).toEqual([]);
  });

  it("refuses a range larger than the cap", () => {
    const wide = Array.from({ length: 4 }, () => [1, 2, 3]);
    const functions = registry({ SUM: () => 0 });
    const value = evaluateFormula("SUM(A1:C4)", {
      sheet: createGridSheet(wide),
      functions,
      maxRangeCells: 11,
    });
    expect(value).toEqual(err("#NUM!"));
  });

  it("short-circuits a scalar error argument before calling", () => {
    let called = false;
    const functions = registry({
      DOUBLE: () => {
        called = true;
        return 1;
      },
    });
    expect(run("DOUBLE(1/0)", { functions })).toEqual(err("#DIV/0!"));
    expect(called).toBe(false);
  });

  it("passes errors through when the entry accepts them", () => {
    const functions = registry({
      IFERROR: entry({
        call: (args) => (isRangeValue(args[0]) ? 0 : "caught"),
        acceptsErrors: true,
      }),
    });
    expect(run("IFERROR(1/0)", { functions })).toBe("caught");
  });

  it("does not scan inside a range for errors", () => {
    const grid: CellValue[][] = [[1], [cellError("#N/A")]];
    let seen: RangeValue | undefined;
    const functions = registry({
      SUM: (args) => ((seen = args[0] as RangeValue), 99),
    });
    const value = evaluateFormula("SUM(A1:A2)", {
      sheet: createGridSheet(grid),
      functions,
    });
    expect(value).toBe(99);
    expect(seen?.rows).toEqual([[1], [err("#N/A")]]);
  });

  it("enforces declared arity", () => {
    const functions = registry({
      ROUND: entry({ call: () => 1, minArgs: 1, maxArgs: 2 }),
    });
    // #N/A is what Sheets reports for a wrong argument count, and what the
    // function library returns when it checks arity itself.
    expect(run("ROUND()", { functions })).toEqual(err("#N/A"));
    expect(run("ROUND(1,2,3)", { functions })).toEqual(err("#N/A"));
    expect(run("ROUND(1)", { functions })).toBe(1);
  });

  it("turns a throwing function into #ERROR! rather than a crash", () => {
    const functions = registry({
      BOOM: () => {
        throw new Error("boom");
      },
    });
    expect(run("BOOM(1)", { functions })).toEqual(err("#ERROR!"));
  });

  it("gives the function the injected clock and origin", () => {
    const when = new Date("2026-08-22T10:00:00Z");
    let stamp: number | null = null;
    let row: number | null = null;
    const functions = registry({
      NOW: entry({
        call: (_args, ctx) => {
          stamp = ctx.now().getTime();
          row = ctx.origin?.row ?? -1;
          return 0;
        },
      }),
    });
    evaluateFormula("NOW()", {
      sheet: sheet(),
      functions,
      origin: { row: 2, col: 0 },
      now: () => when,
    });
    expect(stamp).toBe(when.getTime());
    expect(row).toBe(2);
  });
});

describe("failure modes", () => {
  it("returns #ERROR! for a formula that does not parse", () => {
    expect(run("1+")).toEqual(err("#ERROR!"));
    expect(run("")).toEqual(err("#ERROR!"));
  });

  it("survives a hostile sheet that throws on read", () => {
    const hostile: SheetAccess = {
      getCell: () => {
        throw new Error("no");
      },
      rowCount: () => 5,
      columnCount: () => 5,
      resolveHeader: () => null,
    };
    expect(evaluateFormula("A1", { sheet: hostile })).toEqual(err("#ERROR!"));
  });

  it("stops at the evaluation depth cap instead of overflowing", () => {
    let source = "1";
    for (let i = 0; i < 400; i++) source = `(${source}+1)`;
    // The parser rejects this depth first; either way the caller gets a value.
    const value = run(source);
    expect(value).toEqual(err("#ERROR!"));
  });
});

describe("BASIC_COERCIONS", () => {
  it("treats blank as zero, empty text as not a number", () => {
    expect(BASIC_COERCIONS.toNumber(null)).toBe(0);
    expect(BASIC_COERCIONS.toNumber("")).toEqual(err("#VALUE!"));
    expect(BASIC_COERCIONS.toNumber("  12  ")).toBe(12);
    expect(BASIC_COERCIONS.toNumber("0x10")).toEqual(err("#VALUE!"));
    expect(BASIC_COERCIONS.toNumber(true)).toBe(1);
  });

  it("renders booleans in upper case", () => {
    expect(BASIC_COERCIONS.toText(false)).toBe("FALSE");
    expect(BASIC_COERCIONS.toText(null)).toBe("");
    expect(BASIC_COERCIONS.toText(12)).toBe("12");
  });

  it("reads TRUE/FALSE text as booleans and rejects other words", () => {
    expect(BASIC_COERCIONS.toBoolean("true")).toBe(true);
    expect(BASIC_COERCIONS.toBoolean("no")).toEqual(err("#VALUE!"));
    expect(BASIC_COERCIONS.toBoolean(0)).toBe(false);
  });

  it("orders numbers before text before booleans", () => {
    expect(BASIC_COERCIONS.compare(1, "1")).toBe(-1);
    expect(BASIC_COERCIONS.compare("z", true)).toBe(-1);
    expect(BASIC_COERCIONS.compare("ABC", "abc")).toBe(0);
    expect(BASIC_COERCIONS.compare(null, 0)).toBe(0);
    expect(BASIC_COERCIONS.compare(null, "")).toBe(0);
    expect(BASIC_COERCIONS.compare(err("#N/A"), 1)).toEqual(err("#N/A"));
  });
});

describe("walkRefs", () => {
  function contexts(source: string): Array<[string, RefContext]> {
    const parsed = parseFormula(source);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const out: Array<[string, RefContext]> = [];
    walkRefs(parsed.ast, ({ node, context }) => {
      out.push([source.slice(node.start, node.end), context]);
    });
    return out;
  }

  it("reports operands as scalar context", () => {
    expect(contexts("A1+B2*2")).toEqual([
      ["A1", "scalar"],
      ["B2", "scalar"],
    ]);
  });

  it("reports aggregate arguments as array context", () => {
    expect(contexts("SUM(A)+B1")).toEqual([
      ["A", "array"],
      ["B1", "scalar"],
    ]);
  });

  it("splits mixed parameters by position", () => {
    expect(contexts("VLOOKUP(A,B:C,2)")).toEqual([
      ["A", "scalar"],
      ["B:C", "array"],
    ]);
  });

  it("treats an unknown function's arguments as scalar", () => {
    expect(contexts("MYSTERY(A)")).toEqual([["A", "scalar"]]);
  });

  it("descends into nested calls", () => {
    expect(contexts("IF(A1>0,SUM(B),C1)")).toEqual([
      ["A1", "scalar"],
      ["B", "array"],
      ["C1", "scalar"],
    ]);
  });

  it("agrees with the registry the evaluator consults", () => {
    const functions = registry({ SUM: { call: () => 0, rangeArgs: false } });
    const parsed = parseFormula("SUM(A)");
    if (!parsed.ok) throw new Error("unparsable");
    const seen: RefContext[] = [];
    walkRefs(parsed.ast, ({ context }) => seen.push(context), { functions });
    expect(seen).toEqual(["scalar"]);
  });
});

describe("argumentContext", () => {
  it("falls back to the built-in table", () => {
    expect(argumentContext("SUM", null, 0)).toBe("array");
    expect(argumentContext("SUMIF", null, 1)).toBe("scalar");
    expect(argumentContext("SUMIF", null, 2)).toBe("array");
    expect(argumentContext("LEFT", null, 0)).toBe("scalar");
  });

  it("lets an entry override the table", () => {
    expect(argumentContext("LEFT", { call: () => 0, rangeArgs: true }, 0)).toBe("array");
    expect(argumentContext("SUM", { call: () => 0, rangeArgs: [1] }, 0)).toBe("scalar");
  });
});

describe("createGridSheet", () => {
  it("reads ragged rows as blank and reports the widest row", () => {
    const s = createGridSheet([[1], [1, 2, 3]]);
    expect(s.columnCount()).toBe(3);
    expect(s.rowCount()).toBe(2);
    expect(s.getCell(0, 2)).toBe(null);
    expect(s.getCell(5, 0)).toBe(null);
  });

  it("counts header-only columns", () => {
    const s = createGridSheet([[1]], ["A", "B", "C"]);
    expect(s.columnCount()).toBe(3);
    expect(s.resolveHeader("c")).toBe(2);
    expect(s.resolveHeader("nope")).toBe(null);
  });
});

describe("evaluate", () => {
  it("takes a pre-parsed tree", () => {
    const parsed = parseFormula("A1+B1");
    if (!parsed.ok) throw new Error("unparsable");
    expect(evaluate(parsed.ast, { sheet: sheet() })).toBe(3);
  });
});
