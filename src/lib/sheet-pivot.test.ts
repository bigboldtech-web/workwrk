import { describe, expect, it } from "vitest";

import { computePivot, type PivotConfig } from "./sheet-pivot";

// Sales records: region × product → amount.
const DATA = [
  { region: "West", product: "A", amount: 10, qty: 1 },
  { region: "West", product: "B", amount: 20, qty: 2 },
  { region: "East", product: "A", amount: 5, qty: 1 },
  { region: "East", product: "A", amount: 15, qty: 3 },
  { region: "East", product: "B", amount: 30, qty: 1 },
];

function cfg(over: Partial<PivotConfig>): PivotConfig {
  return { rowFields: ["region"], colField: null, valueField: "amount", agg: "sum", ...over };
}

describe("computePivot", () => {
  it("groups rows and sums a value (no column field)", () => {
    const r = computePivot(DATA, cfg({}));
    expect(r.columns).toEqual([]);
    expect(r.rows.map((x) => [x.key, x.total])).toEqual([
      ["West", 30],
      ["East", 50],
    ]);
    expect(r.grandTotal).toBe(80);
  });

  it("pivots region × product into a matrix with totals", () => {
    const r = computePivot(DATA, cfg({ colField: "product" }));
    expect(r.columns).toEqual(["A", "B"]);
    // West: A=10, B=20 ; East: A=20, B=30
    expect(r.rows.find((x) => x.key === "West")!.cells).toEqual([10, 20]);
    expect(r.rows.find((x) => x.key === "East")!.cells).toEqual([20, 30]);
    expect(r.columnTotals).toEqual([30, 50]); // A total, B total
    expect(r.grandTotal).toBe(80);
  });

  it("counts rows when agg is count", () => {
    const r = computePivot(DATA, cfg({ colField: "product", agg: "count", valueField: null }));
    expect(r.rows.find((x) => x.key === "East")!.cells).toEqual([2, 1]); // East A×2, B×1
    expect(r.grandTotal).toBe(5);
  });

  it("averages, and the row total re-averages (not sum of averages)", () => {
    const r = computePivot(DATA, cfg({ colField: "product", agg: "avg" }));
    const east = r.rows.find((x) => x.key === "East")!;
    expect(east.cells).toEqual([10, 30]); // A: (5+15)/2=10, B: 30
    expect(east.total).toBe(50 / 3); // (5+15+30)/3, NOT (10+30)/2
  });

  it("supports min and max", () => {
    const mn = computePivot(DATA, cfg({ colField: "product", agg: "min" }));
    expect(mn.rows.find((x) => x.key === "East")!.cells).toEqual([5, 30]);
    const mx = computePivot(DATA, cfg({ colField: "product", agg: "max" }));
    expect(mx.rows.find((x) => x.key === "East")!.cells).toEqual([15, 30]);
  });

  it("labels blanks as (blank) rather than dropping them", () => {
    const data = [{ region: "", product: "A", amount: 5 }, { region: "West", product: "A", amount: 10 }];
    const r = computePivot(data, cfg({}));
    expect(r.rows.map((x) => x.key)).toContain("(blank)");
  });

  it("returns empty for no row fields, no records, or a value agg with no value field", () => {
    expect(computePivot(DATA, cfg({ rowFields: [] })).empty).toBe(true);
    expect(computePivot([], cfg({})).empty).toBe(true);
    expect(computePivot(DATA, cfg({ valueField: null, agg: "sum" })).empty).toBe(true);
  });

  it("groups by multiple row fields joined with ' / '", () => {
    const r = computePivot(DATA, cfg({ rowFields: ["region", "product"], colField: null }));
    expect(r.rows.map((x) => x.key)).toEqual(["West / A", "West / B", "East / A", "East / B"]);
    expect(r.rows.find((x) => x.key === "East / A")!.total).toBe(20);
  });
});
