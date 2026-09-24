import { describe, it, expect } from "vitest";
import { computePivot } from "@/lib/sheet-pivot";
import { pivotToTable } from "./pivot-dialog";

// "Insert as a new table" must give every row exactly as many values as the
// header row has names, with or without a Columns field.

const records = [
  { a: "North", b: 10, c: "Q1" },
  { a: "North", b: 5, c: "Q2" },
  { a: "South", b: 30, c: "Q1" },
];

describe("pivotToTable", () => {
  it("with no Columns field: Group and Total only, no unheaded repeat of the Total", () => {
    const result = computePivot(records, { rowFields: ["a"], colField: null, valueField: "b", agg: "sum" });
    const t = pivotToTable(result, "A");
    expect(t.headers).toEqual(["A", "Total"]);
    expect(t.rows).toEqual([
      ["North", 15],
      ["South", 30],
      ["Grand Total", 45],
    ]);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
  });

  it("with a Columns field: one value per column heading, then the Total", () => {
    const result = computePivot(records, { rowFields: ["a"], colField: "c", valueField: "b", agg: "sum" });
    const t = pivotToTable(result, "A");
    expect(t.headers).toEqual(["A", "Q1", "Q2", "Total"]);
    expect(t.rows[0]).toEqual(["North", 10, 5, 15]);
    expect(t.rows[t.rows.length - 1]).toEqual(["Grand Total", 40, 5, 45]);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
  });

  it("falls back to Group when there is no row label", () => {
    const result = computePivot([{ a: "x", b: "not a number" }], { rowFields: ["a"], colField: null, valueField: "b", agg: "avg" });
    const t = pivotToTable(result, "");
    expect(t.headers[0]).toBe("Group");
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
  });
});
