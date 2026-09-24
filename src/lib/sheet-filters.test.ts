import { describe, expect, it } from "vitest";
import {
  activeFilterCount, cellPassesFilter, dayKeyOf, emptyFilterFor, filterKindFor, filtersToConfig,
  parseShownNumber, readSavedFilters, type SheetColumnFilter,
} from "./sheet-filters";

const cols = [
  { id: "a", type: "short_text" },
  { id: "b", type: "select", options: ["Red", "Blue"] },
  { id: "c", type: "number" },
  { id: "d", type: "date" },
  { id: "e", type: "multi_select", options: ["x", "y"] },
];

describe("filterKindFor", () => {
  it("gives a value picker to select types, a range to numbers and dates, contains to text", () => {
    expect(filterKindFor("select")).toBe("value");
    expect(filterKindFor("multi_select")).toBe("value");
    expect(filterKindFor("number")).toBe("range");
    expect(filterKindFor("currency")).toBe("range");
    expect(filterKindFor("date")).toBe("range");
    expect(filterKindFor("short_text")).toBe("contains");
    expect(filterKindFor("formula")).toBe("contains");
    expect(filterKindFor(undefined)).toBe("contains");
  });
});

describe("several filters at once", () => {
  it("counts every narrowing filter plus the search, not a half-set one", () => {
    const fs: SheetColumnFilter[] = [
      { colId: "a", kind: "contains", value: "app" },
      { colId: "b", kind: "value", values: ["Red"] },
      emptyFilterFor("c", "number"),
    ];
    expect(activeFilterCount(fs, "")).toBe(2);
    expect(activeFilterCount(fs, " q ")).toBe(3);
  });

  it("round-trips through the saved config and keeps the old single filter for one release", () => {
    const fs: SheetColumnFilter[] = [
      { colId: "b", kind: "value", values: ["Red"] },
      { colId: "c", kind: "range", min: "2" },
      emptyFilterFor("a", "short_text"),
    ];
    const cfg = filtersToConfig(fs);
    expect(cfg.filters).toHaveLength(2);
    expect(cfg.filter).toEqual({ colId: "b", value: "Red" });
    expect(readSavedFilters(JSON.parse(JSON.stringify(cfg)), cols)).toEqual([
      { colId: "b", kind: "value", values: ["Red"] },
      { colId: "c", kind: "range", min: "2" },
    ]);
  });

  it("clears both keys when nothing narrows", () => {
    expect(filtersToConfig([emptyFilterFor("a", "short_text")])).toEqual({ filters: undefined, filter: undefined });
  });

  it("reads the previous release's one filter", () => {
    expect(readSavedFilters({ filter: { colId: "b", value: "Blue" } }, cols)).toEqual([{ colId: "b", kind: "value", values: ["Blue"] }]);
    expect(readSavedFilters({ filter: { colId: "a", value: "pp" } }, cols)).toEqual([{ colId: "a", kind: "contains", value: "pp" }]);
  });

  it("drops what the panel could not show: a gone column, a changed type, a gone option", () => {
    expect(readSavedFilters({ filters: [{ colId: "zz", kind: "contains", value: "x" }] }, cols)).toEqual([]);
    expect(readSavedFilters({ filters: [{ colId: "c", kind: "contains", value: "x" }] }, cols)).toEqual([]);
    expect(readSavedFilters({ filters: [{ colId: "b", kind: "value", values: ["Green"] }] }, cols)).toEqual([]);
    expect(readSavedFilters({ filter: { colId: "b", value: "Green" } }, cols)).toEqual([]);
    expect(readSavedFilters(null, cols)).toEqual([]);
  });
});

describe("cellPassesFilter", () => {
  it("matches any chosen option, including inside a multi-select cell", () => {
    const f: SheetColumnFilter = { colId: "b", kind: "value", values: ["Red", "Blue"] };
    expect(cellPassesFilter(f, "Red", "Red", "select")).toBe(true);
    expect(cellPassesFilter(f, "Green", "Green", "select")).toBe(false);
    expect(cellPassesFilter({ colId: "e", kind: "value", values: ["y"] }, ["x", "y"], "x y", "multi_select")).toBe(true);
    expect(cellPassesFilter({ colId: "e", kind: "value", values: ["y"] }, ["x"], "x", "multi_select")).toBe(false);
  });

  it("filters numbers by an inclusive range with either end optional", () => {
    const f: SheetColumnFilter = { colId: "c", kind: "range", min: "2", max: "10" };
    expect(cellPassesFilter(f, 2, "2", "number")).toBe(true);
    expect(cellPassesFilter(f, 10, "10", "number")).toBe(true);
    expect(cellPassesFilter(f, 11, "11", "number")).toBe(false);
    expect(cellPassesFilter(f, "", "", "number")).toBe(false);
    expect(cellPassesFilter({ colId: "c", kind: "range", min: "1000" }, "1234", "1,234", "currency")).toBe(true);
    expect(cellPassesFilter({ colId: "c", kind: "range", max: "50" }, 45, "45%", "percent")).toBe(true);
  });

  it("filters dates by day", () => {
    const f: SheetColumnFilter = { colId: "d", kind: "range", min: "2026-01-01", max: "2026-01-31" };
    expect(cellPassesFilter(f, "2026-01-15", "Jan 15, 2026", "date")).toBe(true);
    expect(cellPassesFilter(f, "2026-02-01", "Feb 1, 2026", "date")).toBe(false);
    expect(cellPassesFilter(f, "", "", "date")).toBe(false);
  });

  it("matches shown text for contains, case-insensitively", () => {
    const f: SheetColumnFilter = { colId: "a", kind: "contains", value: "APP" };
    expect(cellPassesFilter(f, "Apple", "Apple", "short_text")).toBe(true);
    expect(cellPassesFilter(f, "Pear", "Pear", "short_text")).toBe(false);
  });

  it("lets every row through a half-set filter", () => {
    expect(cellPassesFilter(emptyFilterFor("c", "number"), "", "", "number")).toBe(true);
  });
});

describe("parsers", () => {
  it("reads shown numbers and day keys", () => {
    expect(parseShownNumber("$1,234.50")).toBe(1234.5);
    expect(parseShownNumber("abc")).toBeNull();
    expect(parseShownNumber("")).toBeNull();
    expect(dayKeyOf("2026-03-04T10:00:00Z")).toBe("2026-03-04");
    expect(dayKeyOf("nope")).toBeNull();
  });
});
