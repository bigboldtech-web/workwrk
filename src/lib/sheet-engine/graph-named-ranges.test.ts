// Named ranges — a bare name (Revenue) standing for a cell/range/column ref.
// A named range reads exactly like typing the ref: whole-range in a function
// argument, narrowed-to-a-cell in an operand. And a formula that uses a named
// range depends on the cells the name covers, so an edit inside the range
// recomputes it.

import { describe, expect, it } from "vitest";

import {
  createGridSheet,
  isRangeValue,
  type FunctionArg,
  type FunctionEntry,
  type FunctionImpl,
} from "./evaluate";
import { SheetGraph } from "./graph";
import { parseFormula } from "./parser";
import { cellError, type CellValue, type Ref } from "./types";

function flatten(args: readonly FunctionArg[]): CellValue[] {
  const out: CellValue[] = [];
  for (const arg of args) {
    if (isRangeValue(arg)) for (const row of arg.rows) out.push(...row);
    else out.push(arg);
  }
  return out;
}

const FUNCTIONS = new Map<string, FunctionEntry | FunctionImpl>([
  [
    "SUM",
    (args) =>
      flatten(args).reduce<number>(
        (total, value) => (typeof value === "number" ? total + value : total),
        0,
      ),
  ],
  ["COUNT", (args) => flatten(args).filter((v) => typeof v === "number").length],
]);

const VALUE = cellError("#VALUE!");
const NAME = cellError("#NAME?");

/** Parse an A1 reference string into a Ref (what a named range stores). */
function refOf(a1: string): Ref {
  const parsed = parseFormula("=" + a1);
  if (!parsed.ok || parsed.ast.type !== "ref") throw new Error(`not a ref: ${a1}`);
  return parsed.ast.ref;
}

function fixture(named: Record<string, string>, rows = 8, cols = 8) {
  const grid: CellValue[][] = Array.from({ length: rows }, () =>
    new Array<CellValue>(cols).fill(null),
  );
  const nameMap = new Map<string, Ref>(
    Object.entries(named).map(([name, a1]) => [name.toUpperCase(), refOf(a1)]),
  );
  const sheet = createGridSheet(grid, undefined, {
    resolveNameRef: (n) => nameMap.get(n.toUpperCase()) ?? null,
  });
  const graph = new SheetGraph({ sheet, functions: FUNCTIONS });
  return {
    grid,
    graph,
    set(row: number, col: number, value: CellValue) {
      grid[row][col] = value;
    },
  };
}

describe("named ranges", () => {
  it("reads the whole range as a function argument", () => {
    const f = fixture({ Revenue: "A1:A3" });
    f.set(0, 0, 1);
    f.set(1, 0, 2);
    f.set(2, 0, 3);
    f.graph.setFormula(0, 2, "SUM(Revenue)"); // C1
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(6);
  });

  it("recomputes when a cell inside the named range changes", () => {
    const f = fixture({ Revenue: "A1:A3" });
    f.set(0, 0, 1);
    f.set(1, 0, 2);
    f.set(2, 0, 3);
    f.graph.setFormula(0, 2, "SUM(Revenue)");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(6);

    f.set(1, 0, 20);
    const result = f.graph.recalculate([{ row: 1, col: 0 }]);
    expect(f.graph.getValue(0, 2)).toBe(24);
    expect(result.changed.some((p) => p.row === 0 && p.col === 2)).toBe(true);
  });

  it("is case-insensitive on the name", () => {
    const f = fixture({ Revenue: "A1:A2" });
    f.set(0, 0, 10);
    f.set(1, 0, 5);
    f.graph.setFormula(0, 2, "SUM(REVENUE)");
    f.graph.setFormula(1, 2, "SUM(revenue)");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(15);
    expect(f.graph.getValue(1, 2)).toBe(15);
  });

  it("narrows a single-cell named range in an operand", () => {
    // Names must NOT be ref-shaped: a <=3-letter word like "Tax" parses as
    // column TAX. "Rate" (4 letters) is a genuine name.
    const f = fixture({ Rate: "A1" });
    f.set(0, 0, 4);
    f.graph.setFormula(0, 2, "Rate*10");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(40);
  });

  it("is #VALUE! when a multi-cell named range is used as a scalar", () => {
    const f = fixture({ Revenue: "A1:A3" });
    f.set(0, 0, 1);
    f.graph.setFormula(0, 2, "Revenue"); // C1 = the whole range in a scalar slot
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toEqual(VALUE);
  });

  it("is #NAME? for an undefined name", () => {
    const f = fixture({ Revenue: "A1:A3" });
    f.graph.setFormula(0, 2, "SUM(Mystery)");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toEqual(NAME);
  });

  it("tracks a whole-column named range as new rows are filled", () => {
    const f = fixture({ Prices: "A:A" });
    f.set(0, 0, 1);
    f.set(1, 0, 2);
    f.graph.setFormula(0, 2, "SUM(Prices)");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(3);

    f.set(5, 0, 100);
    f.graph.recalculate([{ row: 5, col: 0 }]);
    expect(f.graph.getValue(0, 2)).toBe(103);
  });
});
