import { describe, expect, it } from "vitest";
import { customisedCells, hasStoredMatrix } from "./matrix-retire";

describe("matrix retirement report", () => {
  it("an org with no stored matrix has nothing to export", () => {
    expect(hasStoredMatrix({})).toBe(false);
    expect(hasStoredMatrix({ permissions: {} })).toBe(false);
    expect(customisedCells(null)).toEqual([]);
  });
  it("names each cell the org changed from the shipped grid, and what it becomes", () => {
    const cells = customisedCells({ EMPLOYEE: { sops: { create: true } } } as never);
    expect(cells).toEqual([expect.objectContaining({ level: "EMPLOYEE", module: "sops", action: "create", stored: true, shipped: false })]);
    expect(cells[0].becomes).toMatch(/SOP folder/);
    expect(hasStoredMatrix({ permissions: { EMPLOYEE: {} } })).toBe(true);
  });
});
