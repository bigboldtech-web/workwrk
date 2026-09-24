import { describe, expect, it } from "vitest";
import { gutterRowNumber, rowNumbersById } from "./sheet-grid";

// Google Sheets keeps a row's own number under a filter. The gutter used to
// print the visible position, so a filter that left rows 6 and 8 labelled
// them 1 and 2 beside a name box that said D8.

const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i + 1}` }));

describe("rowNumbersById", () => {
  it("numbers every row by its storage position, 1-based", () => {
    const m = rowNumbersById(rows);
    expect(m.get("r1")).toBe(1);
    expect(m.get("r6")).toBe(6);
    expect(m.get("r10")).toBe(10);
    expect(m.size).toBe(10);
  });

  it("answers an empty map for no rows", () => {
    expect(rowNumbersById([]).size).toBe(0);
  });
});

describe("gutterRowNumber", () => {
  const numberOf = (id: string) => rowNumbersById(rows).get(id);

  it("keeps the real row numbers of a filtered view (rows 6 and 8 read 6 and 8)", () => {
    const visible = ["r6", "r8"];
    expect(visible.map((id, displayIndex) => gutterRowNumber(id, displayIndex, numberOf))).toEqual([6, 8]);
  });

  it("keeps each row's own number under a display sort", () => {
    const sorted = ["r3", "r1", "r2"];
    expect(sorted.map((id, displayIndex) => gutterRowNumber(id, displayIndex, numberOf))).toEqual([3, 1, 2]);
  });

  it("falls back to the display position without a lookup, or for an unknown row", () => {
    expect(gutterRowNumber("r6", 0)).toBe(1);
    expect(gutterRowNumber("ghost", 4, numberOf)).toBe(5);
  });
});
