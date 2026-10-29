// The number a table source counts (docs/plans/recurring-goals.md C5), over
// rows already read: pure (no prisma), so the count is proved over plain
// arrays and the server only reads. goal-source.server.ts loads the rows
// (lib/table-counts.ts liveTableRows: ROW_HAS_DATA decides `filled`, in the
// grid's storage order) and, when a formula is read, builds the engine
// through the embed's own path (lib/sheet-embed.ts embedEngine).
//
// A CELL READS AS THE GRID SHOWS IT. A computed cell (a formula column, or a
// stored { "=": ... } cell) reads the engine's value; any other cell its
// stored value. A filter is the grid's cellPassesFilter on the stored value
// and the shown text (a computed cell's engine display; a formula COLUMN's
// fill is computed too, where the grid's filter reads the stored nothing).
// A sum or an average adds the numbers only: text or a blank is left out,
// as a List's sum leaves out what is not a number.
//
// AN ERROR IS NOT A ZERO (C5, C10). A row whose computed cell in a column the
// count reads (the one it adds up, the Date column, a filter's) shows an
// error ("#REF!", "#DIV/0!") is left out and tallied, as the grid's Sum
// leaves it out. When every row the count would read errors, or no row has a
// number while some error, the formulas are broken (a column they read was
// deleted, say) and the count reports it, so the source pauses rather than
// storing a silent 0 that the close would freeze into the score.
//
// TODAY() IS THE WORKSPACE'S DAY. The engine reads NOW() and TODAY() from its
// clock's LOCAL parts (sheet-engine serialFromLocalDate), which on the
// server is the server's zone; wallClockIn hands it a Date whose local parts
// are the workspace zone's wall clock at that instant. A period's final
// number (a Right now freeze, the close's final count) pins that instant to
// the period's last moment (goal-source.server.ts tableClockAt). NOW() is
// day-granular for a goal: a read is shared within the day (the signature
// and the memo key name the day, not the hour).
//
// A DATE COLUMN'S DAY is a workspace-zone key by C3's rule (goal-source.ts
// dateKeyOf): "2026-11-01" is its own day, an instant at UTC midnight its UTC
// day, any other instant its day in the workspace zone; a time with no zone
// ("2026-11-01T09:00") is the day it names; a formula's date serial is the
// day it stands for.

import { cellPassesFilter } from "@/lib/sheet-filters";
import { isCellErrorCode, isErrorValue, isFormulaCell } from "@/lib/sheet-engine/types";
import { partsFromSerial } from "@/lib/sheet-engine/coerce";
import { zoneOffsetMinutes } from "@/lib/zoned-time";
import { dateKeyOf, keyInWindow, type SourceWindow } from "@/lib/goals/goal-source";
import type { TableColumn, TableSource } from "@/lib/goals/table-source";

/** A live row as a count reads it: its stored values, and whether it holds data (ROW_HAS_DATA). */
export interface TableRowRead {
  id: string;
  values: Record<string, unknown>;
  filled: boolean;
}

/** What a count asks of the engine (lib/sheet-engine-host.ts TableEngine answers it). */
export interface CellEngine {
  value(colId: string, rowId: string): unknown;
  display(colId: string, rowId: string): string;
}

/**
 * A Date whose LOCAL parts are `zone`'s wall clock at `at`, for the engine's
 * clock: TODAY() then reads the workspace's day, whatever zone the server
 * runs in.
 */
export function wallClockIn(zone: string, at: Date): Date {
  const shifted = new Date(at.getTime() + zoneOffsetMinutes(zone, at) * 60_000);
  return new Date(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
    shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds(), shifted.getUTCMilliseconds(),
  );
}

const ZONELESS = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** C3's day key of a table date (a stored string or instant, or an engine date serial), or null. */
export function tableDateKey(v: unknown, zone: string): string | null {
  if (typeof v === "number") {
    const p = partsFromSerial(v);
    return p ? `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : null;
  }
  if (typeof v === "string") {
    const m = ZONELESS.exec(v.trim());
    if (m) return m[1];
  }
  return dateKeyOf(v, zone);
}

function numberOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** An engine error, as the engine hands it out (its code string) or as a value. */
const isError = (v: unknown): boolean => (typeof v === "string" ? isCellErrorCode(v) : isErrorValue(v));

/**
 * A count over a table's rows: its number, and how many rows were left out
 * because a computed cell the count reads shows an error. `broken`: every
 * row it would read errors, or no row has a number while some error; the
 * source pauses (TABLE_PAUSE.formulas) instead of storing that number.
 */
export type TableTally =
  | { broken: false; value: number | null; errorRows: number }
  | { broken: true; errorRows: number };

/**
 * The source's number over these rows: filled rows only, inside the window
 * (by its Date column) and passing every filter; Count of rows, or Sum of
 * or Average of a column. An average of nothing is null: the target reads
 * its starting number. `engine` is required when a computed cell is read;
 * without one a computed cell reads as empty.
 */
export function countTableRows(args: {
  source: TableSource;
  columns: readonly TableColumn[];
  rows: readonly TableRowRead[];
  engine: CellEngine | null;
  window: SourceWindow | null;
  zone: string;
}): TableTally {
  const { source, columns, rows, engine, zone } = args;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const computed = (colId: string, raw: unknown) => byId.get(colId)?.type === "formula" || isFormulaCell(raw);
  // A computed cell's value, and whether it is an error; a stored cell is never one.
  const valueOf = (colId: string, row: TableRowRead): { v: unknown; error: boolean } => {
    const raw = row.values[colId];
    if (!computed(colId, raw)) return { v: raw, error: false };
    if (!engine) return { v: null, error: false };
    try {
      const v = engine.value(colId, row.id);
      return { v, error: isError(v) };
    } catch {
      return { v: null, error: false };
    }
  };
  const shownOf = (colId: string, row: TableRowRead): { shown: string; error: boolean } => {
    const raw = row.values[colId];
    if (computed(colId, raw)) {
      if (!engine) return { shown: "", error: false };
      try {
        const shown = String(engine.display(colId, row.id) ?? "");
        return { shown, error: isCellErrorCode(shown) };
      } catch {
        return { shown: "", error: false };
      }
    }
    return { shown: String(Array.isArray(raw) ? raw.join(" ") : raw ?? ""), error: false };
  };
  const window = source.countedBy === "column" ? args.window : null;
  let n = 0;
  let sum = 0;
  let numbers = 0;
  let errorRows = 0;
  for (const row of rows) {
    if (!row.filled) continue;
    // A row a plain test leaves out is not counted whatever else it shows;
    // one that only an error keeps from deciding is an error row.
    let errored = false;
    if (window) {
      const day = valueOf(source.dateColumnId ?? "", row);
      if (day.error) errored = true;
      else if (!keyInWindow(tableDateKey(day.v, zone), window)) continue;
    }
    let passes = true;
    for (const f of source.filters) {
      const shown = shownOf(f.colId, row);
      if (shown.error) errored = true;
      else if (!cellPassesFilter(f, row.values[f.colId], shown.shown, byId.get(f.colId)?.type)) {
        passes = false;
        break;
      }
    }
    if (!passes) continue;
    if (errored) {
      errorRows += 1;
      continue;
    }
    if (source.metric.op === "count") {
      n += 1;
      continue;
    }
    const cell = valueOf(source.metric.columnId, row);
    if (cell.error) {
      errorRows += 1;
      continue;
    }
    const v = numberOf(cell.v);
    if (v == null) continue;
    sum += v;
    numbers += 1;
  }
  if (errorRows > 0 && (source.metric.op === "count" ? n === 0 : numbers === 0)) return { broken: true, errorRows };
  const value = source.metric.op === "count" ? n : source.metric.op === "sum" ? sum : numbers === 0 ? null : sum / numbers;
  return { broken: false, value, errorRows };
}

/** True when any of these columns holds a cell formula of its own in these rows (the engine is needed for it). */
export function readsStoredFormula(rows: readonly TableRowRead[], read: readonly string[]): boolean {
  if (read.length === 0) return false;
  for (const row of rows) for (const id of read) if (isFormulaCell(row.values[id])) return true;
  return false;
}
