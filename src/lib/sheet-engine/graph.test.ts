import { describe, expect, it } from "vitest";

import {
  createGridSheet,
  isRangeValue,
  type FunctionArg,
  type FunctionEntry,
  type FunctionImpl,
} from "./evaluate";
import { SheetGraph, cellKey, keyPoint, stronglyConnected } from "./graph";
import { cellError, type CellValue } from "./types";

function flatten(args: readonly FunctionArg[]): CellValue[] {
  const out: CellValue[] = [];
  for (const arg of args) {
    if (isRangeValue(arg)) for (const row of arg.rows) out.push(...row);
    else out.push(arg);
  }
  return out;
}

// A stand-in for the real library: enough to exercise range arguments.
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

interface Fixture {
  grid: CellValue[][];
  graph: SheetGraph;
  set(row: number, col: number, value: CellValue): void;
}

function fixture(rows = 8, cols = 8, headers?: string[]): Fixture {
  const grid: CellValue[][] = Array.from({ length: rows }, () =>
    new Array<CellValue>(cols).fill(null),
  );
  const sheet = createGridSheet(grid, headers);
  const graph = new SheetGraph({ sheet, functions: FUNCTIONS });
  return {
    grid,
    graph,
    set(row, col, value) {
      grid[row][col] = value;
    },
  };
}

function points(list: Array<{ row: number; col: number }>): string[] {
  return list.map((p) => `${p.row},${p.col}`);
}

describe("full recalculation", () => {
  it("computes in dependency order regardless of insertion order", () => {
    const f = fixture();
    f.set(0, 0, 2);
    // Deliberately out of order: D before B and C.
    f.graph.setFormula(0, 3, "B1+C1");
    f.graph.setFormula(0, 1, "A1*2");
    f.graph.setFormula(0, 2, "A1+1");

    const result = f.graph.recalculateAll();
    expect(points(result.computed)).toEqual(["0,1", "0,2", "0,3"]);
    expect(f.graph.getValue(0, 3)).toBe(7);
  });

  it("recomputes the join of a diamond exactly once", () => {
    const f = fixture();
    f.set(0, 0, 3);
    f.graph.setFormula(0, 1, "A1*2");
    f.graph.setFormula(0, 2, "A1+1");
    f.graph.setFormula(0, 3, "B1+C1");
    f.graph.recalculateAll();

    f.set(0, 0, 10);
    const result = f.graph.recalculate([{ row: 0, col: 0 }]);
    expect(points(result.computed)).toEqual(["0,1", "0,2", "0,3"]);
    expect(points(result.computed).filter((p) => p === "0,3")).toHaveLength(1);
    expect(f.graph.getValue(0, 3)).toBe(31);
  });

  it("is reproducible: two identical graphs compute in the same order", () => {
    const build = () => {
      const f = fixture();
      f.set(0, 0, 1);
      f.graph.setFormula(3, 3, "A1+1");
      f.graph.setFormula(1, 5, "A1+2");
      f.graph.setFormula(2, 0, "A1+3");
      return f.graph.recalculateAll();
    };
    expect(points(build().computed)).toEqual(points(build().computed));
    expect(points(build().computed)).toEqual(["1,5", "2,0", "3,3"]);
  });

  it("reports only the cells whose value actually moved", () => {
    const f = fixture();
    f.set(0, 0, 5);
    f.graph.setFormula(0, 1, "A1*2");
    const first = f.graph.recalculateAll();
    expect(points(first.changed)).toEqual(["0,1"]);

    const second = f.graph.recalculateAll();
    expect(points(second.computed)).toEqual(["0,1"]);
    expect(second.changed).toEqual([]);
  });

  it("gives a formula that does not parse #ERROR! and no dependencies", () => {
    const f = fixture();
    f.graph.setFormula(0, 0, "1+");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 0)).toEqual(cellError("#ERROR!"));
    expect(f.graph.parseErrorAt(0, 0)?.code).toBe("unexpected-end");
    expect(f.graph.precedentsOf(0, 0)).toEqual({ cells: [], rects: [] });
  });
});

describe("incremental recalculation", () => {
  it("touches dependents and nothing else", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.set(0, 4, 100);
    f.graph.setFormula(0, 1, "A1+1"); // depends on the edit
    f.graph.setFormula(0, 2, "B1+1"); // transitively depends
    f.graph.setFormula(0, 5, "E1+1"); // unrelated
    f.graph.recalculateAll();

    f.set(0, 0, 2);
    const result = f.graph.recalculate([{ row: 0, col: 0 }]);
    expect(points(result.computed)).toEqual(["0,1", "0,2"]);
    expect(f.graph.getValue(0, 5)).toBe(101);
  });

  it("recomputes nothing when the edit feeds nothing", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.graph.setFormula(0, 1, "A1+1");
    f.graph.recalculateAll();

    const result = f.graph.recalculate([{ row: 7, col: 7 }]);
    expect(result.computed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("includes a formula added since the last pass, even with no edits", () => {
    const f = fixture();
    f.set(0, 0, 4);
    f.graph.setFormula(0, 1, "A1+1");
    f.graph.recalculateAll();

    f.graph.setFormula(0, 2, "B1*10");
    expect(f.graph.pendingCount).toBe(1);
    const result = f.graph.recalculate();
    expect(points(result.computed)).toEqual(["0,2"]);
    expect(f.graph.getValue(0, 2)).toBe(50);
    expect(f.graph.pendingCount).toBe(0);
  });

  it("recomputes a formula cell named as the edit itself", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.graph.setFormula(0, 1, "A1+1");
    f.graph.recalculateAll();
    f.set(0, 0, 9);
    const result = f.graph.recalculate([{ row: 0, col: 1 }]);
    expect(points(result.computed)).toEqual(["0,1"]);
    expect(f.graph.getValue(0, 1)).toBe(10);
  });

  it("drops dependencies when a formula is replaced", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.set(0, 4, 50);
    f.graph.setFormula(0, 1, "A1+1");
    f.graph.recalculateAll();

    f.graph.setFormula(0, 1, "E1+1");
    f.graph.recalculate();
    expect(f.graph.dependentsOf(0, 0)).toEqual([]);

    f.set(0, 0, 99);
    expect(f.graph.recalculate([{ row: 0, col: 0 }]).computed).toEqual([]);
  });

  it("recomputes the dependents of a formula that was removed", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.graph.setFormula(0, 1, "A1+1");
    f.graph.setFormula(0, 2, "B1*10");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(20);

    // B1 goes back to being the literal that was under it.
    f.set(0, 1, 7);
    f.graph.removeFormula(0, 1);
    const result = f.graph.recalculate();
    expect(points(result.computed)).toEqual(["0,2"]);
    expect(f.graph.getValue(0, 2)).toBe(70);
  });

  it("forgets a removed formula entirely", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.graph.setFormula(0, 1, "A1+1");
    f.graph.recalculateAll();

    expect(f.graph.removeFormula(0, 1)).toBe(true);
    expect(f.graph.removeFormula(0, 1)).toBe(false);
    expect(f.graph.dependentsOf(0, 0)).toEqual([]);
    expect(f.graph.indexSize()).toEqual({ cells: 0, blocks: 0, scans: 0 });
    // The cell reads through to the literal underneath again.
    f.set(0, 1, "plain");
    expect(f.graph.getValue(0, 1)).toBe("plain");
  });
});

describe("range dependencies", () => {
  it("notices a change anywhere inside the range", () => {
    const f = fixture();
    f.set(0, 0, 1);
    f.set(1, 0, 2);
    f.set(2, 0, 3);
    f.graph.setFormula(0, 3, "SUM(A1:A3)");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 3)).toBe(6);

    f.set(1, 0, 20);
    const result = f.graph.recalculate([{ row: 1, col: 0 }]);
    expect(points(result.computed)).toEqual(["0,3"]);
    expect(f.graph.getValue(0, 3)).toBe(24);
  });

  it("ignores a change just outside the range", () => {
    const f = fixture();
    f.graph.setFormula(0, 3, "SUM(A1:A3)");
    f.graph.recalculateAll();
    expect(f.graph.recalculate([{ row: 3, col: 0 }]).computed).toEqual([]);
    expect(f.graph.recalculate([{ row: 0, col: 1 }]).computed).toEqual([]);
  });

  it("follows a whole-column ref into rows that did not exist yet", () => {
    const f = fixture(3);
    f.set(0, 0, 1);
    f.graph.setFormula(0, 3, "SUM(A)");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 3)).toBe(1);

    f.grid.push([7, null, null, null, null, null, null, null]);
    const result = f.graph.recalculate([{ row: 3, col: 0 }]);
    expect(points(result.computed)).toEqual(["0,3"]);
    expect(f.graph.getValue(0, 3)).toBe(8);
  });

  it("depends on one cell when a column ref narrows to the row", () => {
    const f = fixture();
    f.set(1, 0, 5);
    f.graph.setFormula(1, 3, "A*2");
    f.graph.recalculateAll();
    expect(f.graph.getValue(1, 3)).toBe(10);
    expect(f.graph.precedentsOf(1, 3)).toEqual({
      cells: [cellKey(1, 0)],
      rects: [],
    });
    expect(f.graph.recalculate([{ row: 0, col: 0 }]).computed).toEqual([]);
  });

  it("resolves a header ref to its column", () => {
    const f = fixture(4, 4, ["Qty", "Price", "Total", "Notes"]);
    f.set(0, 0, 2);
    f.set(0, 1, 3);
    f.graph.setFormula(0, 2, "[Qty]*[Price]");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toBe(6);
    expect(f.graph.dependentsOf(0, 0)).toEqual([{ row: 0, col: 2 }]);
  });

  it("keeps no dependency on a header no column answers to", () => {
    const f = fixture(4, 4, ["Qty"]);
    f.graph.setFormula(0, 2, "[Nope]+1");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toEqual(cellError("#NAME?"));
    expect(f.graph.precedentsOf(0, 2).cells).toEqual([]);
  });

  it("stores a rectangle, never one edge per cell", () => {
    const f = fixture();
    f.graph.setFormula(0, 3, "SUM(A1:A1000)");
    expect(f.graph.precedentsOf(0, 3).rects).toEqual([
      { top: 0, left: 0, bottom: 999, right: 0 },
    ]);
    const size = f.graph.indexSize();
    expect(size.cells).toBe(0);
    // 1000 rows over 64-row blocks: 16 index entries for 1000 cells.
    expect(size.blocks).toBe(16);
    expect(size.scans).toBe(0);
  });

  it("sends an oversized rectangle to the scan list instead of the index", () => {
    const f = fixture();
    f.graph.setFormula(0, 3, "SUM(A1:A50000)");
    expect(f.graph.indexSize()).toEqual({ cells: 0, blocks: 0, scans: 1 });
    expect(f.graph.dependentsOf(40000, 0)).toEqual([{ row: 0, col: 3 }]);
    expect(f.graph.dependentsOf(60000, 0)).toEqual([]);
  });

  it("keeps a whole-column dependency unbounded", () => {
    const f = fixture();
    f.graph.setFormula(0, 3, "SUM(A)");
    expect(f.graph.precedentsOf(0, 3).rects).toEqual([
      { top: 0, left: 0, bottom: Infinity, right: 0 },
    ]);
    expect(f.graph.indexSize().scans).toBe(1);
    expect(f.graph.dependentsOf(999_999, 0)).toEqual([{ row: 0, col: 3 }]);
  });

  it("does not depend on a range it cannot read", () => {
    const f = fixture();
    // A multi-cell range in an operand position is #VALUE!, so nothing in it
    // can change the answer.
    f.graph.setFormula(0, 3, "A1:A3+1");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 3)).toEqual(cellError("#VALUE!"));
    expect(f.graph.precedentsOf(0, 3)).toEqual({ cells: [], rects: [] });
  });

  it("counts one dependency when a cell is read twice", () => {
    const f = fixture();
    f.set(0, 0, 3);
    f.graph.setFormula(0, 3, "A1+A1+SUM(A1:A2)");
    f.graph.recalculateAll();
    expect(f.graph.dependentsOf(0, 0)).toEqual([{ row: 0, col: 3 }]);
    f.set(0, 0, 4);
    expect(points(f.graph.recalculate([{ row: 0, col: 0 }]).computed)).toEqual([
      "0,3",
    ]);
  });

  it("rebuilds header dependencies on reindex", () => {
    const grid: CellValue[][] = Array.from({ length: 3 }, () =>
      new Array<CellValue>(3).fill(null),
    );
    const headers = ["Qty", "Price", "Total"];
    const sheet = {
      ...createGridSheet(grid, headers),
      resolveHeader: (name: string) => headers.indexOf(name),
    };
    const graph = new SheetGraph({ sheet, functions: FUNCTIONS });
    grid[0][0] = 2;
    grid[0][1] = 7;
    graph.setFormula(0, 2, "[Qty]+1");
    graph.recalculateAll();
    expect(graph.getValue(0, 2)).toBe(3);

    // The columns swap places; the header now names a different index.
    headers[0] = "Price";
    headers[1] = "Qty";
    graph.reindex();
    graph.recalculate();
    expect(graph.getValue(0, 2)).toBe(8);
    expect(graph.dependentsOf(0, 1)).toEqual([{ row: 0, col: 2 }]);
    expect(graph.dependentsOf(0, 0)).toEqual([]);
  });
});

describe("cycles", () => {
  it("reports a cell that reads itself", () => {
    const f = fixture();
    f.graph.setFormula(0, 0, "A1+1");
    const result = f.graph.recalculateAll();
    expect(f.graph.getValue(0, 0)).toEqual(cellError("#CYCLE!"));
    expect(points(result.cycles[0])).toEqual(["0,0"]);
    expect(result.cycles).toHaveLength(1);
  });

  it("reports a cell that reads itself through a range", () => {
    const f = fixture();
    f.graph.setFormula(0, 2, "SUM(A1:C1)");
    const result = f.graph.recalculateAll();
    expect(f.graph.getValue(0, 2)).toEqual(cellError("#CYCLE!"));
    expect(points(result.cycles[0])).toEqual(["0,2"]);
  });

  it("reports every participant in a three-cell cycle", () => {
    const f = fixture();
    f.graph.setFormula(0, 0, "B1+1");
    f.graph.setFormula(0, 1, "C1+1");
    f.graph.setFormula(0, 2, "A1+1");
    const result = f.graph.recalculateAll();
    expect(result.cycles).toHaveLength(1);
    expect(points(result.cycles[0])).toEqual(["0,0", "0,1", "0,2"]);
    for (const col of [0, 1, 2]) {
      expect(f.graph.getValue(0, col)).toEqual(cellError("#CYCLE!"));
    }
  });

  it("poisons cells downstream of a cycle without naming them participants", () => {
    const f = fixture();
    f.graph.setFormula(0, 0, "B1");
    f.graph.setFormula(0, 1, "A1");
    f.graph.setFormula(0, 2, "A1+1");
    const result = f.graph.recalculateAll();
    expect(points(result.cycles.flat())).toEqual(["0,0", "0,1"]);
    expect(f.graph.getValue(0, 2)).toEqual(cellError("#CYCLE!"));
  });

  it("keeps healthy cells healthy alongside a cycle", () => {
    const f = fixture();
    f.set(0, 4, 6);
    f.graph.setFormula(0, 0, "B1");
    f.graph.setFormula(0, 1, "A1");
    f.graph.setFormula(0, 5, "E1*2");
    f.graph.recalculateAll();
    expect(f.graph.getValue(0, 5)).toBe(12);
  });

  it("separates two independent cycles", () => {
    const f = fixture();
    f.graph.setFormula(0, 0, "B1");
    f.graph.setFormula(0, 1, "A1");
    f.graph.setFormula(2, 0, "A4");
    f.graph.setFormula(3, 0, "A3");
    const result = f.graph.recalculateAll();
    expect(result.cycles.map(points)).toEqual([
      ["0,0", "0,1"],
      ["2,0", "3,0"],
    ]);
  });

  it("clears the error once the cycle is broken", () => {
    const f = fixture();
    f.set(0, 4, 5);
    f.graph.setFormula(0, 0, "B1");
    f.graph.setFormula(0, 1, "A1");
    f.graph.recalculateAll();

    f.graph.setFormula(0, 1, "E1");
    const result = f.graph.recalculate();
    expect(result.cycles).toEqual([]);
    expect(f.graph.getValue(0, 0)).toBe(5);
    expect(f.graph.getValue(0, 1)).toBe(5);
  });

  it("finds cycles without recomputing", () => {
    const f = fixture();
    f.graph.setFormula(0, 0, "B1");
    f.graph.setFormula(0, 1, "A1");
    expect(f.graph.findCycles().map(points)).toEqual([["0,0", "0,1"]]);
    expect(f.graph.getValue(0, 0)).toBe(null);
  });
});

describe("scale", () => {
  it("walks a ten-thousand-cell chain without overflowing the stack", () => {
    const rows = 10_000;
    const grid: CellValue[][] = Array.from({ length: rows }, () => [null]);
    grid[0] = [1];
    const graph = new SheetGraph({ sheet: createGridSheet(grid) });
    for (let row = 1; row < rows; row++) graph.setFormula(row, 0, `A${row}+1`);
    const result = graph.recalculateAll();
    expect(result.computed).toHaveLength(rows - 1);
    expect(graph.getValue(rows - 1, 0)).toBe(rows);
  });

  it("survives a cycle thousands of cells long", () => {
    const rows = 5_000;
    const grid: CellValue[][] = Array.from({ length: rows }, () => [null]);
    const graph = new SheetGraph({ sheet: createGridSheet(grid) });
    for (let row = 0; row < rows; row++) {
      const next = ((row + 1) % rows) + 1;
      graph.setFormula(row, 0, `A${next}`);
    }
    const result = graph.recalculateAll();
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toHaveLength(rows);
    expect(graph.getValue(0, 0)).toEqual(cellError("#CYCLE!"));
  });

  it("recomputes one cell out of ten thousand when only its input moves", () => {
    const rows = 10_000;
    const grid: CellValue[][] = Array.from({ length: rows }, () => [1, null]);
    const graph = new SheetGraph({ sheet: createGridSheet(grid) });
    for (let row = 0; row < rows; row++) graph.setFormula(row, 1, `A${row + 1}*2`);
    graph.recalculateAll();

    grid[4242][0] = 5;
    const result = graph.recalculate([{ row: 4242, col: 0 }]);
    expect(points(result.computed)).toEqual(["4242,1"]);
    expect(graph.getValue(4242, 1)).toBe(10);
  });
});

describe("keys", () => {
  it("round-trips an address and sorts row-major", () => {
    expect(keyPoint(cellKey(12, 3))).toEqual({ row: 12, col: 3 });
    expect(cellKey(0, 5)).toBeLessThan(cellKey(1, 0));
    expect(cellKey(1, 0)).toBeLessThan(cellKey(1, 1));
  });
});

describe("stronglyConnected", () => {
  it("returns singletons for an acyclic graph", () => {
    const adjacency = new Map([
      [1, [2]],
      [2, [3]],
      [3, []],
    ]);
    expect(stronglyConnected([1, 2, 3], (n) => adjacency.get(n) ?? [])).toEqual([
      [1],
      [2],
      [3],
    ]);
  });

  it("groups a cycle and orders the result", () => {
    const adjacency = new Map([
      [3, [1]],
      [1, [2]],
      [2, [3]],
      [4, []],
    ]);
    expect(stronglyConnected([4, 3, 2, 1], (n) => adjacency.get(n) ?? [])).toEqual([
      [1, 2, 3],
      [4],
    ]);
  });
});
