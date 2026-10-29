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
// A sum or an average adds the numbers only: an error, text or a blank is
// left out, as a List's sum leaves out what is not a number.
//
// TODAY() IS THE WORKSPACE'S DAY. The engine reads NOW() and TODAY() from its
// clock's LOCAL parts (sheet-engine serialFromLocalDate), which on the
// server is the server's zone; wallClockIn hands it a Date whose local parts
// are the workspace zone's wall clock at that instant.
//
// A DATE COLUMN'S DAY is a workspace-zone key by C3's rule (goal-source.ts
// dateKeyOf): "2026-11-01" is its own day, an instant at UTC midnight its UTC
// day, any other instant its day in the workspace zone; a time with no zone
// ("2026-11-01T09:00") is the day it names; a formula's date serial is the
// day it stands for.

import { cellPassesFilter } from "@/lib/sheet-filters";
import { isFormulaCell } from "@/lib/sheet-engine/types";
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
}): number | null {
  const { source, columns, rows, engine, zone } = args;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const computed = (colId: string, raw: unknown) => byId.get(colId)?.type === "formula" || isFormulaCell(raw);
  const valueOf = (colId: string, row: TableRowRead): unknown => {
    const raw = row.values[colId];
    if (!computed(colId, raw)) return raw;
    if (!engine) return null;
    try {
      return engine.value(colId, row.id);
    } catch {
      return null;
    }
  };
  const shownOf = (colId: string, row: TableRowRead): string => {
    const raw = row.values[colId];
    if (computed(colId, raw)) {
      if (!engine) return "";
      try {
        return String(engine.display(colId, row.id) ?? "");
      } catch {
        return "";
      }
    }
    return String(Array.isArray(raw) ? raw.join(" ") : raw ?? "");
  };
  const window = source.countedBy === "column" ? args.window : null;
  let n = 0;
  let sum = 0;
  let numbers = 0;
  for (const row of rows) {
    if (!row.filled) continue;
    if (window && !keyInWindow(tableDateKey(valueOf(source.dateColumnId ?? "", row), zone), window)) continue;
    if (!source.filters.every((f) => cellPassesFilter(f, row.values[f.colId], shownOf(f.colId, row), byId.get(f.colId)?.type))) continue;
    n += 1;
    if (source.metric.op === "count") continue;
    const v = numberOf(valueOf(source.metric.columnId, row));
    if (v == null) continue;
    sum += v;
    numbers += 1;
  }
  if (source.metric.op === "count") return n;
  if (source.metric.op === "sum") return sum;
  return numbers === 0 ? null : sum / numbers;
}

/** True when any of these columns holds a cell formula of its own in these rows (the engine is needed for it). */
export function readsStoredFormula(rows: readonly TableRowRead[], read: readonly string[]): boolean {
  if (read.length === 0) return false;
  for (const row of rows) for (const id of read) if (isFormulaCell(row.values[id])) return true;
  return false;
}
