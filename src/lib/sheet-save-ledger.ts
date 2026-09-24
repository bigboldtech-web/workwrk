// The sheet's unsaved-write ledger (tables/[id] page): which writes the
// server has not accepted yet, keyed "row:<id>" (that row's unsaved cell
// values) or "table" (unsaved table fields such as columns or name).
//
// One boolean was not enough: a later save of a different cell cleared it
// while the first cell was still unsaved, and the title row read Saved over
// a value that existed only in the browser. A failure merges its keys in;
// a landed save settles only the keys it actually wrote. The indicator
// reads Not saved while any entry is left, and Retry re-sends each entry.
//
// Pure: the page holds the map in state and a ref; this decides.

export type SaveLedger = ReadonlyMap<string, Readonly<Record<string, unknown>>>;

export const TABLE_LEDGER_KEY = "table";
export const rowLedgerKey = (rowId: string) => `row:${rowId}`;
export const ledgerRowId = (key: string): string | null => (key.startsWith("row:") ? key.slice(4) : null);

/** A write failed: its values join whatever that key already had unsaved. */
export function ledgerFail(ledger: SaveLedger, key: string, values: Record<string, unknown>): SaveLedger {
  const next = new Map(ledger);
  next.set(key, { ...(ledger.get(key) ?? {}), ...values });
  return next;
}

/** A write landed (or the server's value replaced ours on purpose): the keys
 *  it wrote are no longer unsaved. Returns the same map when nothing changed. */
export function ledgerSettle(ledger: SaveLedger, key: string, keys: readonly string[]): SaveLedger {
  const cur = ledger.get(key);
  if (!cur) return ledger;
  const rest: Record<string, unknown> = { ...cur };
  let changed = false;
  for (const k of keys) {
    if (k in rest) { delete rest[k]; changed = true; }
  }
  if (!changed) return ledger;
  const next = new Map(ledger);
  if (Object.keys(rest).length > 0) next.set(key, rest);
  else next.delete(key);
  return next;
}

/**
 * A reload (load() on the sheet) brings server truth, which does not hold the
 * values the ledger is still waiting to save. Re-apply them on top, so a value
 * the grid promised to keep on screen is still on screen after any failure
 * path that reloads (a failed paste, rename, column config, undo or redo, the
 * conflict toast's Reload, "rows were deleted elsewhere"), and the Retry the
 * indicator offers re-sends a value the person can see.
 *
 * Row entries apply to the row with that id; an entry whose row no longer
 * exists (deleted elsewhere) cannot be saved anywhere, so it leaves the ledger
 * and its cell count comes back as `orphanedCells` for the caller to say so.
 * The table entry (columns, name, and any other table field) applies over the
 * loaded table. Columns merge BY ID rather than replacing the server's list
 * (mergeUnsavedColumns), so a column someone else added or changed while this
 * save was failing is never dropped by the re-apply or by the Retry after it.
 */
export function overlayLedger<R extends { id: string; values: Record<string, unknown> | null }, T extends object>(
  ledger: SaveLedger,
  table: T,
  rows: readonly R[],
): { table: T; rows: R[]; ledger: SaveLedger; orphanedCells: number } {
  if (ledger.size === 0) return { table, rows: [...rows], ledger, orphanedCells: 0 };
  const nextTable = overlayTableEntry(ledger, table);
  const present = new Set(rows.map((r) => r.id));
  let orphanedCells = 0;
  const next = new Map(ledger);
  for (const key of ledger.keys()) {
    const rowId = ledgerRowId(key);
    if (rowId && !present.has(rowId)) {
      orphanedCells += Object.keys(ledger.get(key) ?? {}).length;
      next.delete(key);
    }
  }
  const nextRows = rows.map((r) => {
    const entry = next.get(rowLedgerKey(r.id));
    return entry ? { ...r, values: { ...(r.values ?? {}), ...entry } } : r;
  });
  return { table: nextTable, rows: nextRows, ledger: orphanedCells > 0 ? next : ledger, orphanedCells };
}

type ColumnLike = { id: string };
const isColumnList = (v: unknown): v is ColumnLike[] =>
  Array.isArray(v) && v.every((c) => !!c && typeof c === "object" && typeof (c as ColumnLike).id === "string");

/**
 * The unsaved columns over the server's: a column in both takes the unsaved
 * version (a rename, a type, a width the person set), a column only in the
 * unsaved list (added here, not saved) is appended, and a column only on the
 * server (added elsewhere, or deleted here without saving) is KEPT, because
 * dropping a column definition hides its cells. Server order first.
 */
export function mergeUnsavedColumns<C extends ColumnLike>(server: readonly C[], unsaved: readonly C[]): C[] {
  const mine = new Map(unsaved.map((c) => [c.id, c]));
  const onServer = new Set(server.map((c) => c.id));
  return [...server.map((c) => mine.get(c.id) ?? c), ...unsaved.filter((c) => !onServer.has(c.id))];
}

/** The ledger's table entry over a loaded table (columns merged by id). */
export function overlayTableEntry<T extends object>(ledger: SaveLedger, table: T): T {
  const entry = ledger.get(TABLE_LEDGER_KEY);
  if (!entry) return table;
  const next = { ...table, ...entry } as Record<string, unknown>;
  const serverCols = (table as Record<string, unknown>).columns;
  if ("columns" in entry && isColumnList(entry.columns) && isColumnList(serverCols)) {
    next.columns = mergeUnsavedColumns(serverCols, entry.columns);
  }
  return next as T;
}
