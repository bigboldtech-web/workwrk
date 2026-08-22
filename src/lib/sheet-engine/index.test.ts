// End-to-end proof that the four layers plus the injected library agree. The
// per-module suites cover behaviour; this one exists to catch a wiring drift
// between `evaluate`, `coerce` and `functions`.
import { describe, expect, it } from "vitest";

import {
  cellError,
  computeFormula,
  createGridSheet,
  createSheetEngine,
  formulaCell,
  isFormulaCell,
  partsFromSerial,
  rewriteFormula,
  type CellValue,
} from "./index";

const GRID: CellValue[][] = [
  [1, 10, null],
  [2, 20, null],
  [3, 30, null],
];

const HEADERS = ["Qty", "Price", "Total"];

function sheet(grid: CellValue[][] = GRID) {
  return createGridSheet(grid, HEADERS);
}

function compute(source: string, row = 0): CellValue {
  return computeFormula(source, { sheet: sheet(), origin: { row, col: 2 } });
}

describe("the real function library through the facade", () => {
  it("aggregates a whole column", () => {
    expect(compute("SUM(A)")).toBe(6);
    expect(compute("SUM(A1:A2)")).toBe(3);
    expect(compute("AVERAGE(B)")).toBe(20);
    expect(compute("COUNT(A)")).toBe(3);
    expect(compute("MAX(B)")).toBe(30);
  });

  it("narrows a column ref to the row for a scalar parameter", () => {
    expect(compute("ROUND(A*1.5,0)", 1)).toBe(3);
    expect(compute("LEN(CONCAT([Qty],[Price]))", 2)).toBe(3);
  });

  it("skips blanks in a range but counts a literal", () => {
    expect(compute("COUNT(C)")).toBe(0);
    expect(compute("AVERAGE(C1,4)")).toBe(4);
  });

  it("keeps IFERROR able to see the error", () => {
    expect(compute('IFERROR(1/0,"safe")')).toBe("safe");
    expect(compute("IFERROR(A1,0)")).toBe(1);
  });

  it("branches with IF and comparison", () => {
    expect(compute('IF(A>2,"big","small")', 2)).toBe("big");
    expect(compute('IF(A>2,"big","small")', 0)).toBe("small");
  });

  it("propagates an error out of an argument", () => {
    expect(compute("ROUND(1/0,0)")).toEqual(cellError("#DIV/0!"));
  });

  it("is #NAME? for a function nobody wrote", () => {
    expect(compute("XLOOKUP(1,A,B)")).toEqual(cellError("#NAME?"));
  });

  it("reads the injected clock", () => {
    const when = new Date(2026, 7, 22, 12, 0, 0);
    const value = computeFormula("TODAY()", { sheet: sheet(), now: () => when });
    expect(typeof value).toBe("number");
    expect(partsFromSerial(value as number)).toMatchObject({
      year: 2026,
      month: 8,
      day: 22,
    });
  });

  it("looks a value up across columns", () => {
    expect(compute("VLOOKUP(2,A1:B3,2)")).toBe(20);
  });
});

describe("engine recalculation", () => {
  it("recomputes only what an edit reaches, with real functions", () => {
    const grid: CellValue[][] = [
      [1, null, null],
      [2, null, null],
      [3, null, null],
    ];
    const engine = createSheetEngine({ sheet: createGridSheet(grid, HEADERS) });
    engine.setFormula(0, 1, "A*2"); // row-local
    engine.setFormula(1, 1, "A*2");
    engine.setFormula(0, 2, "SUM(B1:B2)"); // depends on both
    engine.recalculateAll();
    expect(engine.getValue(0, 2)).toBe(6);

    grid[1][0] = 10;
    const result = engine.recalculate([{ row: 1, col: 0 }]);
    // Dependency order, not address order: B2 feeds C1.
    expect(result.computed).toEqual([
      { row: 1, col: 1 },
      { row: 0, col: 2 },
    ]);
    expect(engine.getValue(0, 2)).toBe(22);
  });

  it("reports a cycle instead of hanging", () => {
    const engine = createSheetEngine({ sheet: sheet() });
    engine.setFormula(0, 2, "SUM(C1:C2)");
    const result = engine.recalculateAll();
    expect(result.cycles).toEqual([[{ row: 0, col: 2 }]]);
    expect(engine.getValue(0, 2)).toEqual(cellError("#CYCLE!"));
  });
});

describe("storage shape", () => {
  it("round-trips a formula cell", () => {
    const cell = formulaCell("A1+B1");
    expect(isFormulaCell(cell)).toBe(true);
    expect(isFormulaCell({ value: 1 })).toBe(false);
    expect(
      computeFormula(cell["="], { sheet: sheet(), origin: { row: 0, col: 2 } }),
    ).toBe(11);
  });

  it("survives a structure change and still computes", () => {
    const rewritten = rewriteFormula("SUM(A1:A3)", {
      type: "delete-rows",
      at: 1,
      count: 1,
    });
    expect(rewritten).toEqual({ ok: true, source: "SUM(A1:A2)", changed: true });
    const grid: CellValue[][] = [[1], [3]];
    expect(
      computeFormula("SUM(A1:A2)", { sheet: createGridSheet(grid) }),
    ).toBe(4);
  });
});
