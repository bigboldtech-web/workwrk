import { describe, expect, it } from "vitest";
import {
  legacyZoomKey, parseZoom, pivotPatch, readFormsColumns, readFormsShowFieldNumbers, readFormsShowHelpText, readPivotConfig, readSheetFormulaBar, readSheetGridlines,
  readTablesColumns, readZoom, zoomKey,
} from "./tables-prefs";
import { homePatchSchema } from "./preferences-schema";

function store(entries: Record<string, string>): Pick<Storage, "getItem"> {
  return { getItem: (k: string) => (k in entries ? entries[k] : null) };
}

describe("zoom", () => {
  it("reads the new key first", () => {
    expect(readZoom(store({ [zoomKey("t")]: "125", [legacyZoomKey("t")]: "75" }), "t")).toBe(125);
  });
  it("falls back to the old key so nobody's zoom resets", () => {
    expect(readZoom(store({ [legacyZoomKey("t")]: "90" }), "t")).toBe(90);
  });
  it("is 100 when absent, off the ladder, or the storage throws", () => {
    expect(readZoom(store({}), "t")).toBe(100);
    expect(parseZoom("80")).toBe(100);
    expect(readZoom({ getItem: () => { throw new Error("blocked"); } }, "t")).toBe(100);
    expect(readZoom(null, "t")).toBe(100);
  });
});

describe("display preferences", () => {
  it("default every column on and the view checks on", () => {
    expect(readTablesColumns({})).toEqual({ location: true, rows: true, owner: true, updated: true });
    expect(readFormsColumns(undefined)).toEqual({ goesTo: true, responses: true, status: true, owner: true, updated: true });
    expect(readSheetGridlines({})).toBe(true);
    expect(readSheetFormulaBar({ tables: {} })).toBe(true);
  });
  it("reads each field on its own", () => {
    expect(readTablesColumns({ tables: { columns: { owner: false, bogus: false } } }).owner).toBe(false);
    expect(readSheetGridlines({ tables: { gridlines: false } })).toBe(false);
  });
  it("the strict schema accepts the new keys and refuses unknown ones", () => {
    expect(homePatchSchema.safeParse({ tables: { gridlines: false, formulaBar: true, columns: { owner: false } } }).success).toBe(true);
    expect(homePatchSchema.safeParse({ forms: { showHelpText: true, showFieldNumbers: false } }).success).toBe(true);
    expect(homePatchSchema.safeParse({ favoriteFormIds: ["f1"] }).success).toBe(true);
    expect(homePatchSchema.safeParse({ tables: { zoom: 125 } }).success).toBe(false);
  });
});

describe("pivot configuration", () => {
  const live = new Set(["a", "b"]);
  it("is null when never stored", () => {
    expect(readPivotConfig({}, "t", live)).toBeNull();
  });
  it("round-trips through the patch and drops deleted columns", () => {
    const patch = pivotPatch({ work: { surface: { other: { x: 1 } } } }, "t", {
      rowFields: ["a", "gone"], colField: "b", valueField: "gone", agg: "avg", view: "chart", chartType: "pie",
    });
    expect(patch.home.work.surface.other).toEqual({ x: 1 });
    const cfg = readPivotConfig(patch.home, "t", live);
    expect(cfg).toEqual({ rowFields: ["a"], colField: "b", valueField: "", agg: "avg", view: "chart", chartType: "pie" });
  });
  it("the patch passes the strict schema (home.work.surface is a loose record)", () => {
    const patch = pivotPatch({}, "t", { rowFields: [], colField: "", valueField: "", agg: "sum", view: "table", chartType: "bar" });
    expect(homePatchSchema.safeParse(patch.home).success).toBe(true);
  });
});

describe("the form builder's Display options", () => {
  it("shows help text and hides field numbers by default", () => {
    expect(readFormsShowHelpText(undefined)).toBe(true);
    expect(readFormsShowFieldNumbers(undefined)).toBe(false);
    expect(readFormsShowHelpText({ forms: { columns: {} } })).toBe(true);
  });
  it("reads the stored values per field", () => {
    expect(readFormsShowHelpText({ forms: { showHelpText: false } })).toBe(false);
    expect(readFormsShowFieldNumbers({ forms: { showFieldNumbers: true } })).toBe(true);
    expect(readFormsShowFieldNumbers({ forms: { showFieldNumbers: "yes" } })).toBe(false);
  });
});
