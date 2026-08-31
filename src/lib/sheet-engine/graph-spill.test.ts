// Dynamic-array (spill) behaviour, driven through the WHOLE engine: the real
// function library computes an array, the graph spills it into neighbouring
// cells, and edits ripple through the spill the way Google Sheets / Excel do.
//
// The invariant under test is data integrity: a spilled cell is never stored,
// a recompute never orphans a cell, a collision degrades to #SPILL! instead of
// overwriting content, and clearing a blocker lets the array recover.

import { describe, expect, it } from "vitest";

import { createGridSheet, createSheetEngine } from "./index";
import { cellError, type CellValue } from "./types";

function grid(rows = 10, cols = 8): CellValue[][] {
  return Array.from({ length: rows }, () => new Array<CellValue>(cols).fill(null));
}

const SPILL = cellError("#SPILL!");

describe("spill: a column array", () => {
  it("keeps the anchor and lays the rest into the cells below", () => {
    const cells = grid();
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    engine.recalculateAll();

    expect(engine.getValue(0, 0)).toBe(1);
    expect(engine.getValue(1, 0)).toBe(2);
    expect(engine.getValue(2, 0)).toBe(3);
    // The overflow cells are spilled, not formulas of their own.
    expect(engine.hasFormula(1, 0)).toBe(false);
    expect(engine.isSpilled(1, 0)).toBe(true);
    expect(engine.isSpilled(0, 0)).toBe(false);
    // And they never touched the backing store.
    expect(cells[1][0]).toBeNull();
    expect(cells[2][0]).toBeNull();
  });

  it("reports the spilled cells as changed so the grid repaints them", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    const result = engine.recalculateAll();
    const touched = new Set(result.changed.map((p) => `${p.row},${p.col}`));
    expect(touched.has("0,0")).toBe(true);
    expect(touched.has("1,0")).toBe(true);
    expect(touched.has("2,0")).toBe(true);
  });
});

describe("spill: a 2D array", () => {
  it("fills a rectangle down and to the right", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 0, "=SEQUENCE(2,3)");
    engine.recalculateAll();
    expect(engine.getValue(0, 0)).toBe(1);
    expect(engine.getValue(0, 1)).toBe(2);
    expect(engine.getValue(0, 2)).toBe(3);
    expect(engine.getValue(1, 0)).toBe(4);
    expect(engine.getValue(1, 1)).toBe(5);
    expect(engine.getValue(1, 2)).toBe(6);
  });
});

describe("spill: dependents read spilled cells", () => {
  it("recomputes a formula that reads a cell another array spills into", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    // C1 reads A2, which only exists once A1's array spills.
    engine.setFormula(0, 2, "=A2*10");
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    engine.recalculateAll();
    expect(engine.getValue(0, 2)).toBe(20); // A2 == 2
  });

  it("re-ripples when the array reshapes", () => {
    const cells = grid();
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 2, "=A3*10"); // reads A3
    engine.setFormula(0, 0, "=SEQUENCE(2)");
    engine.recalculateAll();
    // A3 is outside a 2-tall array, so it's empty → 0.
    expect(engine.getValue(0, 2)).toBe(0);

    engine.setFormula(0, 0, "=SEQUENCE(4)"); // now spills through A3 == 3
    engine.recalculate([{ row: 0, col: 0 }]);
    expect(engine.getValue(2, 0)).toBe(3);
    expect(engine.getValue(0, 2)).toBe(30);
  });
});

describe("spill: collisions degrade to #SPILL!", () => {
  it("refuses to overwrite a literal in the spill range", () => {
    const cells = grid();
    cells[1][0] = 99; // a value sits where the array would land
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    engine.recalculateAll();

    expect(engine.getValue(0, 0)).toEqual(SPILL);
    expect(engine.getValue(1, 0)).toBe(99); // literal untouched
    expect(engine.getValue(2, 0)).toBeNull(); // nothing spilled
    expect(engine.isSpilled(1, 0)).toBe(false);
    expect(cells[1][0]).toBe(99); // store never mutated
  });

  it("recovers once the blocker is cleared", () => {
    const cells = grid();
    cells[1][0] = 99;
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    engine.recalculateAll();
    expect(engine.getValue(0, 0)).toEqual(SPILL);

    // Clear the blocker and tell the engine that cell changed.
    cells[1][0] = null;
    engine.recalculate([{ row: 1, col: 0 }]);
    expect(engine.getValue(0, 0)).toBe(1);
    expect(engine.getValue(1, 0)).toBe(2);
    expect(engine.getValue(2, 0)).toBe(3);
  });

  it("collides when a formula is typed into the spill range", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    engine.recalculateAll();
    expect(engine.getValue(1, 0)).toBe(2);

    // Someone drops a formula onto a spilled cell → the array must yield.
    engine.setFormula(1, 0, "=42");
    engine.recalculate([{ row: 1, col: 0 }]);
    expect(engine.getValue(0, 0)).toEqual(SPILL);
    expect(engine.getValue(1, 0)).toBe(42);
  });
});

describe("spill: clearing the anchor", () => {
  it("removes the whole footprint when the anchor formula is deleted", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 0, "=SEQUENCE(3)");
    engine.recalculateAll();
    expect(engine.isSpilled(2, 0)).toBe(true);

    engine.removeFormula(0, 0);
    engine.recalculate();
    expect(engine.isSpilled(1, 0)).toBe(false);
    expect(engine.isSpilled(2, 0)).toBe(false);
    expect(engine.getValue(1, 0)).toBeNull();
    expect(engine.getValue(2, 0)).toBeNull();
  });

  it("shrinks the footprint when the array gets smaller", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 0, "=SEQUENCE(4)");
    engine.recalculateAll();
    expect(engine.getValue(3, 0)).toBe(4);

    engine.setFormula(0, 0, "=SEQUENCE(2)");
    engine.recalculate([{ row: 0, col: 0 }]);
    expect(engine.getValue(1, 0)).toBe(2);
    expect(engine.isSpilled(2, 0)).toBe(false); // former tail released
    expect(engine.getValue(2, 0)).toBeNull();
    expect(engine.getValue(3, 0)).toBeNull();
  });
});

describe("spill: the flagship functions", () => {
  it("UNIQUE over a spilled column", () => {
    const cells = grid();
    for (const [r, v] of [3, 1, 3, 2, 1].entries()) cells[r][0] = v;
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 2, "=UNIQUE(A1:A5)");
    engine.recalculateAll();
    expect(engine.getValue(0, 2)).toBe(3);
    expect(engine.getValue(1, 2)).toBe(1);
    expect(engine.getValue(2, 2)).toBe(2);
    expect(engine.isSpilled(3, 2)).toBe(false);
  });

  it("SORT over a spilled column", () => {
    const cells = grid();
    for (const [r, v] of [3, 1, 2].entries()) cells[r][0] = v;
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 2, "=SORT(A1:A3)");
    engine.recalculateAll();
    expect([engine.getValue(0, 2), engine.getValue(1, 2), engine.getValue(2, 2)]).toEqual([1, 2, 3]);
  });

  it("FILTER over a spilled column", () => {
    const cells = grid();
    for (const [r, v] of ["a", "b", "c"].entries()) cells[r][0] = v;
    for (const [r, v] of [true, false, true].entries()) cells[r][1] = v;
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 3, "=FILTER(A1:A3,B1:B3)");
    engine.recalculateAll();
    expect(engine.getValue(0, 3)).toBe("a");
    expect(engine.getValue(1, 3)).toBe("c");
    expect(engine.isSpilled(2, 3)).toBe(false);
  });
});

describe("spill: range aggregates over a spilled region", () => {
  it("SUM(A1:A3) tracks a spill into A1:A3", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 2, "=SUM(A1:A3)");
    engine.setFormula(0, 0, "=SEQUENCE(3)"); // A1=1, A2=2, A3=3 → sum 6
    engine.recalculateAll();
    expect(engine.getValue(0, 2)).toBe(6);
  });

  it("re-sums when the spilled array reshapes", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 2, "=SUM(A1:A4)");
    engine.setFormula(0, 0, "=SEQUENCE(4)"); // 1+2+3+4 = 10
    engine.recalculateAll();
    expect(engine.getValue(0, 2)).toBe(10);

    engine.setFormula(0, 0, "=SEQUENCE(2)"); // now 1+2 = 3
    engine.recalculate([{ row: 0, col: 0 }]);
    expect(engine.getValue(0, 2)).toBe(3);
  });

  it("one array feeds another: SORT of a spilled SEQUENCE", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 0, "=SEQUENCE(3,1,3,-1)"); // 3,2,1 down A1:A3
    engine.setFormula(0, 2, "=SORT(A1:A3)"); // → 1,2,3
    engine.recalculateAll();
    expect([engine.getValue(0, 2), engine.getValue(1, 2), engine.getValue(2, 2)]).toEqual([1, 2, 3]);
  });
})

describe("spill: a blocked array recovers when a NEIGHBOUR frees the cell", () => {
  // Regression (adversarial review): a #SPILL!-blocked array was only retried
  // on a DIRECT edit to the blocker, never when another array's retreat freed
  // the cell — so it stayed stuck on #SPILL! forever.
  it("recovers when the winning array shrinks (setFormula path)", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 1, "=SEQUENCE(2)"); // B1 spills down into B2 (lower key wins)
    engine.setFormula(1, 0, "=SEQUENCE(1,2)"); // A2 wants A2+B2 → B2 taken → #SPILL!
    engine.recalculateAll();
    expect(engine.getValue(1, 0)).toEqual(SPILL);

    engine.setFormula(0, 1, "=SEQUENCE(1)"); // B1 no longer needs B2
    engine.recalculate([{ row: 0, col: 1 }]);
    expect(engine.getValue(1, 0)).toBe(1); // A2 recovered
    expect(engine.getValue(1, 1)).toBe(2); // and spilled into B2
  });

  it("recovers when the winning array is deleted (removeFormula path)", () => {
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 1, "=SEQUENCE(2)");
    engine.setFormula(1, 0, "=SEQUENCE(1,2)");
    engine.recalculateAll();
    expect(engine.getValue(1, 0)).toEqual(SPILL);

    engine.removeFormula(0, 1); // free B2 entirely
    engine.recalculate();
    expect(engine.getValue(1, 0)).toBe(1);
    expect(engine.getValue(1, 1)).toBe(2);
  });

  it("recovers when the winner shrinks because ITS OWN input changed", () => {
    const cells = grid();
    cells[9][7] = 2; // H10 drives the winner's size
    const engine = createSheetEngine({ sheet: createGridSheet(cells) });
    engine.setFormula(0, 1, "=SEQUENCE(H10)"); // B1 spills H10 rows
    engine.setFormula(1, 0, "=SEQUENCE(1,2)"); // wants B2 → blocked while H10>=2
    engine.recalculateAll();
    expect(engine.getValue(1, 0)).toEqual(SPILL);

    cells[9][7] = 1; // winner shrinks to 1 row → frees B2
    engine.recalculate([{ row: 9, col: 7 }]);
    expect(engine.getValue(1, 0)).toBe(1);
    expect(engine.getValue(1, 1)).toBe(2);
  });
});

describe("spill: off-sheet footprint is #SPILL!, never a wrapped write", () => {
  it("refuses a horizontal spill that runs past the last column", () => {
    // Anchor one short of the last column; a 1x3 array would need 2 more.
    const engine = createSheetEngine({ sheet: createGridSheet(grid()) });
    engine.setFormula(0, 18276, "=SEQUENCE(1,4)"); // 18276+3 = 18279 > MAX 18277
    engine.recalculateAll();
    expect(engine.getValue(0, 18276)).toEqual(SPILL);
    // Nothing wrapped into a later row's column 0.
    expect(engine.getValue(1, 0)).toBeNull();
  });
});
