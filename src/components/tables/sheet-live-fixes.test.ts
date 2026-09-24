import { describe, expect, it } from "vitest";
import { columnSelectionCells, rowSelectionCells, EMPTY_GHOST_ROWS } from "./sheet-grid";
import { pushToast } from "@/components/layout/os/toast";

// The live-verify fixes for the Phase 5 sheet: the pure halves of the
// header-letter / gutter selection order and the keyed toast slot.

/** The rectangle a pair of corners spans, in display indices. */
function rect(rowIds: string[], a: { rowId: string; c: number }, b: { rowId: string; c: number }) {
  const ra = rowIds.indexOf(a.rowId);
  const rb = rowIds.indexOf(b.rowId);
  return { r1: Math.min(ra, rb), r2: Math.max(ra, rb), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
}

describe("columnSelectionCells (header letter click)", () => {
  const rowIds = Array.from({ length: 1000 }, (_, i) => `r${i}`);

  it("puts the active cell on the TOP row, so typing edits F1, not F1000", () => {
    const sel = columnSelectionCells(rowIds, 5, 5)!;
    expect(sel.active).toEqual({ rowId: "r0", c: 5 });
    expect(sel.anchor).toEqual({ rowId: "r999", c: 5 });
  });

  it("still spans the whole column", () => {
    const sel = columnSelectionCells(rowIds, 5, 5)!;
    expect(rect(rowIds, sel.anchor, sel.active)).toEqual({ r1: 0, r2: 999, c1: 5, c2: 5 });
  });

  it("Shift+click extends from the anchor column across full height", () => {
    const sel = columnSelectionCells(rowIds, 7, 5)!;
    expect(sel.active.c).toBe(7);
    expect(rect(rowIds, sel.anchor, sel.active)).toEqual({ r1: 0, r2: 999, c1: 5, c2: 7 });
  });

  it("answers null for a grid with no rows", () => {
    expect(columnSelectionCells([], 0, 0)).toBeNull();
  });
});

describe("rowSelectionCells (gutter number click)", () => {
  const rowIds = ["a", "b", "c", "d"];

  it("puts the active cell in column A of the row, so typing edits A9, not Z9", () => {
    const sel = rowSelectionCells("c", "c", 25);
    expect(sel.active).toEqual({ rowId: "c", c: 0 });
    expect(sel.anchor).toEqual({ rowId: "c", c: 25 });
    expect(rect(rowIds, sel.anchor, sel.active)).toEqual({ r1: 2, r2: 2, c1: 0, c2: 25 });
  });

  it("Shift+click keeps the anchor row and stays full width", () => {
    const sel = rowSelectionCells("d", "b", 25);
    expect(sel.active).toEqual({ rowId: "d", c: 0 });
    expect(rect(rowIds, sel.anchor, sel.active)).toEqual({ r1: 1, r2: 3, c1: 0, c2: 25 });
  });
});

describe("EMPTY_GHOST_ROWS", () => {
  it("paints enough placeholder rows to fill a tall viewport", () => {
    expect(EMPTY_GHOST_ROWS).toBeGreaterThanOrEqual(28);
  });
});

describe("pushToast (keyed toast slot)", () => {
  type T = { id: number; key?: string };

  it("stacks unkeyed toasts and keeps the newest three", () => {
    let xs: T[] = [];
    for (let i = 1; i <= 4; i++) xs = pushToast(xs, { id: i });
    expect(xs.map((x) => x.id)).toEqual([2, 3, 4]);
  });

  it("replaces a live toast with the same key instead of stacking", () => {
    let xs: T[] = [{ id: 1, key: "save" }, { id: 2 }];
    xs = pushToast(xs, { id: 3, key: "save" });
    expect(xs.map((x) => x.id)).toEqual([2, 3]);
  });

  it("leaves toasts with other keys alone", () => {
    const xs = pushToast<T>([{ id: 1, key: "a" }], { id: 2, key: "b" });
    expect(xs.map((x) => x.id)).toEqual([1, 2]);
  });
});
