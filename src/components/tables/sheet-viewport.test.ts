import { describe, expect, it } from "vitest";
import { pageStep, SHEET_ROW_H } from "./sheet-grid";
import { buildRowGeometry } from "@/lib/sheet-row-geometry";

// The bounded-viewport fixes for the sheet: once the grid scrolls inside its
// own box (and not the page), PageDown / PageUp must turn the VIEW by a page
// along with the cursor, as Sheets does. Before, only the cursor moved and
// the view sat still until the cursor fell off its bottom edge.

describe("pageStep (PageDown / PageUp)", () => {
  const geom = buildRowGeometry(1000, SHEET_ROW_H);

  it("moves the cursor a page and scrolls the view the same distance", () => {
    // 630px viewport: floor(630 / 32) - 2 = 17 rows per page.
    const step = pageStep(geom, 7, 1000, 630, 1);
    expect(step.dr).toBe(17);
    expect(step.scrollBy).toBe(17 * SHEET_ROW_H);
  });

  it("PageUp scrolls back by the same distance", () => {
    const step = pageStep(geom, 24, 1000, 630, -1);
    expect(step.dr).toBe(-17);
    expect(step.scrollBy).toBe(-17 * SHEET_ROW_H);
  });

  it("stops at the first and last row instead of scrolling past them", () => {
    expect(pageStep(geom, 3, 1000, 630, -1).scrollBy).toBe(-3 * SHEET_ROW_H);
    expect(pageStep(geom, 995, 1000, 630, 1).scrollBy).toBe(4 * SHEET_ROW_H);
    expect(pageStep(geom, 999, 1000, 630, 1).scrollBy).toBe(0);
  });

  it("scrolls the real pixel distance when rows have custom heights", () => {
    const tall = buildRowGeometry(100, SHEET_ROW_H, (i) => (i === 2 ? 200 : undefined));
    // From row 0, 17 rows down crosses the 200px row 2.
    expect(pageStep(tall, 0, 100, 630, 1).scrollBy).toBe(16 * SHEET_ROW_H + 200);
  });

  it("still steps one row on a viewport shorter than three rows", () => {
    expect(pageStep(geom, 10, 1000, 40, 1)).toEqual({ dr: 1, scrollBy: SHEET_ROW_H });
  });
});
