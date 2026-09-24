import { describe, expect, it } from "vitest";
import { ledgerFail, ledgerRowId, ledgerSettle, rowLedgerKey, TABLE_LEDGER_KEY, type SaveLedger } from "./sheet-save-ledger";

const empty: SaveLedger = new Map();

describe("the sheet's unsaved-write ledger", () => {
  it("GOLDEN: a later save of another cell does not clear a failed cell", () => {
    let l = ledgerFail(empty, rowLedgerKey("r1"), { a: "typed" });
    l = ledgerSettle(l, rowLedgerKey("r2"), ["a"]);
    expect(l.size).toBe(1);
    expect(l.get("row:r1")).toEqual({ a: "typed" });
  });
  it("GOLDEN: a columns save does not clear a failed cell", () => {
    let l = ledgerFail(empty, rowLedgerKey("r1"), { a: "typed" });
    l = ledgerSettle(l, TABLE_LEDGER_KEY, ["columns"]);
    expect(l.size).toBe(1);
  });
  it("a save of the same row settles only the keys it wrote", () => {
    let l = ledgerFail(empty, rowLedgerKey("r1"), { a: 1, b: 2 });
    l = ledgerSettle(l, rowLedgerKey("r1"), ["a"]);
    expect(l.get("row:r1")).toEqual({ b: 2 });
    l = ledgerSettle(l, rowLedgerKey("r1"), ["b"]);
    expect(l.size).toBe(0);
  });
  it("two failures on one row merge, the later value winning", () => {
    let l = ledgerFail(empty, rowLedgerKey("r1"), { a: 1 });
    l = ledgerFail(l, rowLedgerKey("r1"), { a: 2, b: 3 });
    expect(l.get("row:r1")).toEqual({ a: 2, b: 3 });
  });
  it("settling a key that is not unsaved returns the same map", () => {
    const l = ledgerFail(empty, TABLE_LEDGER_KEY, { name: "x" });
    expect(ledgerSettle(l, TABLE_LEDGER_KEY, ["columns"])).toBe(l);
    expect(ledgerSettle(l, rowLedgerKey("r9"), ["a"])).toBe(l);
  });
  it("reads the row id back from a row key only", () => {
    expect(ledgerRowId(rowLedgerKey("abc"))).toBe("abc");
    expect(ledgerRowId(TABLE_LEDGER_KEY)).toBeNull();
  });
});

describe("overlayLedger: a reload keeps the unsaved values on screen", () => {
  it("GOLDEN: a failed cell survives a reload that brings the server's old value", async () => {
    const { ledgerFail: fail, overlayLedger: overlay, rowLedgerKey: rk } = await import("./sheet-save-ledger");
    const ledger = fail(new Map(), rk("r1"), { a: "typed" });
    const out = overlay(ledger, { name: "T" }, [
      { id: "r1", values: { a: "old", b: "kept" } },
      { id: "r2", values: { a: "other" } },
    ]);
    expect(out.rows[0].values).toEqual({ a: "typed", b: "kept" });
    expect(out.rows[1].values).toEqual({ a: "other" });
    expect(out.ledger.size).toBe(1);
    expect(out.orphanedCells).toBe(0);
  });

  it("re-applies a failed table field such as a column rename", async () => {
    const { ledgerFail: fail, overlayLedger: overlay, TABLE_LEDGER_KEY: TK } = await import("./sheet-save-ledger");
    const cols = [{ id: "c", label: "Renamed" }];
    const out = overlay(fail(new Map(), TK, { columns: cols }), { name: "T", columns: [{ id: "c", label: "" }] }, []);
    expect(out.table).toEqual({ name: "T", columns: cols });
  });

  it("drops and counts the unsaved cells of a row deleted elsewhere", async () => {
    const { ledgerFail: fail, overlayLedger: overlay, rowLedgerKey: rk } = await import("./sheet-save-ledger");
    let ledger = fail(new Map(), rk("gone"), { a: 1, b: 2 });
    ledger = fail(ledger, rk("r1"), { a: 3 });
    const out = overlay(ledger, {}, [{ id: "r1", values: null }]);
    expect(out.orphanedCells).toBe(2);
    expect([...out.ledger.keys()]).toEqual([rk("r1")]);
    expect(out.rows[0].values).toEqual({ a: 3 });
  });

  it("returns the loaded data untouched when nothing is unsaved", async () => {
    const { overlayLedger: overlay } = await import("./sheet-save-ledger");
    const rows = [{ id: "r1", values: { a: 1 } }];
    const out = overlay(new Map(), { n: 1 }, rows);
    expect(out.rows).toEqual(rows);
    expect(out.orphanedCells).toBe(0);
  });
});

describe("the unsaved columns merge by id", () => {
  it("GOLDEN: a column added elsewhere survives the re-apply of a failed rename", async () => {
    const { ledgerFail: fail, overlayTableEntry: over, TABLE_LEDGER_KEY: TK } = await import("./sheet-save-ledger");
    const server = { name: "T", columns: [{ id: "a", label: "" }, { id: "x", label: "Theirs" }] };
    const ledger = fail(new Map(), TK, { columns: [{ id: "a", label: "Renamed" }, { id: "n", label: "New here" }] });
    expect(over(ledger, server).columns).toEqual([
      { id: "a", label: "Renamed" },
      { id: "x", label: "Theirs" },
      { id: "n", label: "New here" },
    ]);
  });
  it("applies other failed table fields as they are", async () => {
    const { ledgerFail: fail, overlayTableEntry: over, TABLE_LEDGER_KEY: TK } = await import("./sheet-save-ledger");
    expect(over(fail(new Map(), TK, { name: "Typed" }), { name: "Old", columns: [] })).toEqual({ name: "Typed", columns: [] });
  });
});
