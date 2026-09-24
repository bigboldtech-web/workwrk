import { describe, expect, it } from "vitest";
import { importSummaryLine, pickerHeight, popoverPlacement } from "./csv-import-dialog";

describe("importSummaryLine", () => {
  const base = { newColumns: 0, skipped: 0, tableName: "Pipeline", newName: "clients" };

  it("makes the append verb agree with one row", () => {
    // The footer read "1 row go into Pipeline".
    expect(importSummaryLine({ ...base, mode: "append", rows: 1, newColumns: 1 })).toBe("1 row goes into Pipeline, with 1 new column.");
    expect(importSummaryLine({ ...base, mode: "append", rows: 2, skipped: 1 })).toBe("2 rows go into Pipeline, 1 skipped.");
  });

  it("keeps 'go' on the create line, whose subject is compound", () => {
    expect(importSummaryLine({ ...base, mode: "create", rows: 1, newColumns: 1 })).toBe("1 row and 1 column go into a new table named clients.");
    expect(importSummaryLine({ ...base, mode: "create", rows: 3, newColumns: 2, newName: "  " })).toBe("3 rows and 2 columns go into a new table named Imported table.");
  });

  it("names the table a failed attempt already created instead of promising a new one", () => {
    // A retry after "The table was created but its rows did not import"
    // writes into that table; the line must not say "a new table".
    const line = importSummaryLine({ ...base, mode: "create", rows: 1, newColumns: 2, madeName: "clients" });
    expect(line).toBe("1 row goes into clients, the table this import already created.");
    expect(line).not.toMatch(/new table/);
  });

  it("falls back to 'this table' when appending into an unnamed table", () => {
    expect(importSummaryLine({ ...base, mode: "append", rows: 5, tableName: "" })).toBe("5 rows go into this table.");
  });
});

describe("popoverPlacement", () => {
  it("opens below when the list fits under the trigger", () => {
    expect(popoverPlacement({ popHeight: 300, anchorTop: 40, anchorBottom: 72, visibleHeight: 600 })).toBe("bottom");
  });

  it("opens above when only the room above the trigger fits", () => {
    expect(popoverPlacement({ popHeight: 300, anchorTop: 400, anchorBottom: 432, visibleHeight: 500 })).toBe("top");
  });

  it("asks the body to grow when neither side fits (the short-CSV case)", () => {
    // The reported case: a 295px body, the trigger ending 216px down, a
    // 278px list. Below it was cut after "New column"; above has no room.
    expect(popoverPlacement({ popHeight: 286, anchorTop: 184, anchorBottom: 216, visibleHeight: 295 })).toBe("grow");
  });

  it("treats an exact fit below as a fit", () => {
    expect(popoverPlacement({ popHeight: 200, anchorTop: 60, anchorBottom: 100, visibleHeight: 300 })).toBe("bottom");
  });
});

describe("pickerHeight", () => {
  it("matches the popovers measured in the real dialog", () => {
    // "Where Amount goes" on Pipeline: New column, 5 targets under one
    // label, Skip; measured 328px. The type list: 11 types; measured 330px.
    expect(pickerHeight(7, 1)).toBe(328);
    expect(pickerHeight(11, 0)).toBe(330);
  });

  it("drops the search row below 6 rows and caps the list at 280", () => {
    expect(pickerHeight(2, 0)).toBe(2 * 36 + 10);
    expect(pickerHeight(28, 1)).toBe(280 + 40 + 10);
  });
});
