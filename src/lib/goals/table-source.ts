// A target counted from a table (docs/plans/recurring-goals.md C5, C7 to
// C10): the stored shape, its checks, the columns it may read, the caps and
// the pause words. Pure and client safe (no prisma, no engine), so the target
// editor, the routes and the server count read the same rules; the count
// itself is table-count.ts, the reads goal-source.server.ts.
//
// THE STORED SHAPE (KeyResult.source):
//   { kind: "table", tableId, metric, filters, countedBy, dateColumnId }
// metric is Count of rows, or Sum of or Average of a number, currency,
// percent, rating or formula column; filters are the Tables column filters
// unchanged (SheetColumnFilter: value, range or contains by the column's
// type), every one of which must hold, as in the grid; countedBy is a Date
// column of the table (its day compared as a workspace-zone key, C3's rule)
// or Right now (no window; its final number is stored at the first cron run
// after the period's end).
//
// WHICH ROWS. Filled rows only, by the Tables list's own rule (ROW_HAS_DATA,
// lib/table-counts.ts), so the 1,000 blank rows a new table is born with
// never count; trashed rows never count. There is no "Row added": every
// seeded row carries the table's creation day, so a row filled in November
// would count in the month the table was made.
//
// NOT OFFERED: link, lookup and rollup columns. They read another table,
// whose access the goal cannot check for every viewer.

import { filterIsActive, filterKindFor, type SheetColumnFilter } from "@/lib/sheet-filters";

/** Over these, the source pauses ("This table is too large to count from a goal."). */
export const TABLE_PLAIN_CAP = 50_000;
/** A sum or a filter over a formula column runs the engine over every live row: a lower cap. */
export const TABLE_FORMULA_CAP = 20_000;
/** As many filters as a List source has rules. */
export const MAX_TABLE_FILTERS = 20;

export type TableCountedBy = "column" | "now";
export type TableMetric = { op: "count" } | { op: "sum" | "average"; columnId: string };

export interface TableSource {
  kind: "table";
  tableId: string;
  metric: TableMetric;
  /** The Tables column filters; only ones that narrow are kept. */
  filters: SheetColumnFilter[];
  countedBy: TableCountedBy;
  /** The Date column counted by, for countedBy "column". */
  dateColumnId: string | null;
}

/** The column types a target may add up (C5): numbers, and formulas worked out on the server. */
export const TABLE_NUMBER_TYPES: ReadonlySet<string> = new Set(["number", "currency", "percent", "rating", "formula"]);
/** The column types "a Date column" may be. */
export const TABLE_DATE_TYPES: ReadonlySet<string> = new Set(["date"]);
/** Columns that read another table: never added up, counted by or filtered on. */
export const TABLE_RELATION_TYPES: ReadonlySet<string> = new Set(["link", "lookup", "rollup"]);

export const TABLE_COUNTED_BY_LABEL: Record<TableCountedBy, string> = { column: "A Date column", now: "Right now" };

/** A column of a table as a goal reads it. */
export interface TableColumn {
  id: string;
  type: string;
  label: string;
  formula?: string;
  options?: string[];
}

function recordOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

/** DataTable.columns as a goal reads it; the reserved "$" keys and anything malformed are left out. */
export function tableColumnsOf(raw: unknown): TableColumn[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const out: TableColumn[] = [];
  for (const c of list) {
    const o = recordOf(c);
    if (!o || typeof o.id !== "string" || o.id === "" || o.id.startsWith("$")) continue;
    out.push({
      id: o.id,
      type: typeof o.type === "string" ? o.type : "short_text",
      label: typeof o.label === "string" ? o.label : "",
      ...(typeof o.formula === "string" ? { formula: o.formula } : {}),
      ...(Array.isArray(o.options) ? { options: o.options.filter((x): x is string => typeof x === "string") } : {}),
    });
  }
  return out;
}

/** A sheet's column letter: 0 is A, 26 is AA. */
function letterOf(index: number): string {
  let s = "";
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** A column's name as the grid's header shows it: its label, else its letter. */
export function tableColumnName(columns: readonly TableColumn[], id: string): string {
  const i = columns.findIndex((c) => c.id === id);
  if (i < 0) return "A column";
  return columns[i].label.trim() || letterOf(i);
}

/** The columns a target may add up, count by and filter on (C5). */
export function offeredColumns(columns: readonly TableColumn[]): { numbers: TableColumn[]; dates: TableColumn[]; filters: TableColumn[] } {
  return {
    numbers: columns.filter((c) => TABLE_NUMBER_TYPES.has(c.type)),
    dates: columns.filter((c) => TABLE_DATE_TYPES.has(c.type)),
    filters: columns.filter((c) => !TABLE_RELATION_TYPES.has(c.type)),
  };
}

function filterOf(raw: unknown): SheetColumnFilter | null {
  const f = recordOf(raw);
  if (!f || !isId(f.colId)) return null;
  if (f.kind === "value") {
    if (!Array.isArray(f.values) || f.values.length > 100) return null;
    const values = [...new Set(f.values.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 200)))];
    return { colId: f.colId, kind: "value", values };
  }
  if (f.kind === "range") {
    const min = text(f.min, 40)?.trim();
    const max = text(f.max, 40)?.trim();
    return { colId: f.colId, kind: "range", ...(min ? { min } : {}), ...(max ? { max } : {}) };
  }
  if (f.kind === "contains") return { colId: f.colId, kind: "contains", value: text(f.value, 200) ?? "" };
  return null;
}

/**
 * A table source as stored or sent, or null when it is not one (a List, a
 * KPI combine, or something malformed). The one reader: the routes refuse
 * what this cannot read, and the count reads what it reads. A filter that
 * narrows nothing is dropped; one column is filtered once.
 */
export function parseTableSource(raw: unknown): TableSource | null {
  const s = recordOf(raw);
  if (!s || s.kind !== "table" || !isId(s.tableId)) return null;
  const m = recordOf(s.metric) ?? { op: "count" };
  let metric: TableMetric;
  if (m.op === "count") metric = { op: "count" };
  else if ((m.op === "sum" || m.op === "average") && isId(m.columnId)) metric = { op: m.op, columnId: m.columnId };
  else return null;
  const list = s.filters === undefined || s.filters === null ? [] : s.filters;
  if (!Array.isArray(list) || list.length > MAX_TABLE_FILTERS) return null;
  const filters: SheetColumnFilter[] = [];
  for (const raw of list) {
    const f = filterOf(raw);
    if (!f) return null;
    if (!filterIsActive(f) || filters.some((x) => x.colId === f.colId)) continue;
    filters.push(f);
  }
  const countedBy = s.countedBy === "column" || s.countedBy === "now" ? s.countedBy : null;
  if (!countedBy) return null;
  const dateColumnId = countedBy === "column" ? (isId(s.dateColumnId) ? s.dateColumnId : null) : null;
  if (countedBy === "column" && !dateColumnId) return null;
  return { kind: "table", tableId: s.tableId, metric, filters, countedBy, dateColumnId };
}

/** The stored JSON of a table source (exactly the keys parseTableSource reads). */
export function serializeTableSource(s: TableSource): Record<string, unknown> {
  return {
    kind: "table",
    tableId: s.tableId,
    metric: s.metric,
    filters: s.filters,
    countedBy: s.countedBy,
    ...(s.countedBy === "column" ? { dateColumnId: s.dateColumnId } : {}),
  };
}

/** The columns a source reads: the one it adds up, the one it counts by, the ones it filters on. */
export function columnsRead(s: TableSource): string[] {
  return [...new Set([
    ...(s.metric.op === "count" ? [] : [s.metric.columnId]),
    ...(s.countedBy === "column" && s.dateColumnId ? [s.dateColumnId] : []),
    ...s.filters.map((f) => f.colId),
  ])];
}

/** A formula column is read, so the count runs the engine over every live row (C5's lower cap). */
export function readsFormulaColumn(s: TableSource, columns: readonly TableColumn[]): boolean {
  const byId = new Map(columns.map((c) => [c.id, c]));
  return columnsRead(s).some((id) => byId.get(id)?.type === "formula");
}

/** Which part of a source no longer fits its table's columns, or null when it all does. */
export type TableColumnProblem = "metric" | "date" | "filter";

/**
 * C10: the column it adds up, the one it counts by and every one it
 * filters on must still be a column of the table, of a type that may be
 * read that way (a filter's kind must still be its column's). A value
 * filter must still name an option its column offers: with every chosen
 * option renamed or removed it would match nothing, a silent 0 (the grid's
 * own filter drops options the column no longer has, readSavedFilters).
 * Null when the source still fits; else which part does not.
 */
export function tableColumnProblem(s: TableSource, columns: readonly TableColumn[]): TableColumnProblem | null {
  const byId = new Map(columns.map((c) => [c.id, c]));
  if (s.metric.op !== "count") {
    const c = byId.get(s.metric.columnId);
    if (!c || !TABLE_NUMBER_TYPES.has(c.type)) return "metric";
  }
  if (s.countedBy === "column") {
    const c = s.dateColumnId ? byId.get(s.dateColumnId) : undefined;
    if (!c || !TABLE_DATE_TYPES.has(c.type)) return "date";
  }
  for (const f of s.filters) {
    const c = byId.get(f.colId);
    if (!c || TABLE_RELATION_TYPES.has(c.type) || filterKindFor(c.type) !== f.kind) return "filter";
    if (f.kind === "value" && c.options && !f.values.some((v) => c.options!.includes(v))) return "filter";
  }
  return null;
}

/**
 * A formula column it reads whose formula holds "#REF!": a column it read
 * was deleted and the grid rewrote the reference (sheet-engine-host.ts
 * structure ops). Every row then reads the error, so the count pauses
 * rather than adding up nothing (TABLE_PAUSE.formulas).
 */
export function readsBrokenFormula(s: TableSource, columns: readonly TableColumn[]): boolean {
  const byId = new Map(columns.map((c) => [c.id, c]));
  return columnsRead(s).some((id) => {
    const c = byId.get(id);
    return c?.type === "formula" && typeof c.formula === "string" && c.formula.toUpperCase().includes("#REF!");
  });
}

/** The words a paused table source shows (under its target row, for editors) and the Inbox row names (C10), each with its fix (final review L5). */
export const TABLE_PAUSE = {
  tableGone: "The table it counts was deleted or moved to Trash. Restore it, or choose another table in Edit target.",
  lostTable: (name: string | null) => `${name || "The person who connected it"} can no longer open the table it counts. Reconnect it.`,
  tablesOff: "Tables is turned off for this workspace. An Admin can turn it on in Settings > Modules.",
  columnGone: "The column it adds up was removed or changed type. Choose another column in Edit target.",
  dateColumnGone: "The date column it counts by was removed or changed type. Choose another date column in Edit target.",
  filterColumnGone: "A column it filters on was removed or changed type. Change the filter in Edit target.",
  tooLarge: "This table is too large to count from a goal. Count from a smaller table.",
  formulas: "The table's formulas could not be worked out. Open the table to check them.",
} as const;

/** The preview's line when a few rows' formulas show an error (C5): those rows are left out, as the grid's Sum leaves them out. */
export function errorRowsWords(n: number): string {
  return n === 1 ? "1 row shows an error and is left out." : `${n.toLocaleString("en-US")} rows show an error and are left out.`;
}

/** The pause words of a column problem. */
export function columnPauseWords(p: TableColumnProblem): string {
  return p === "metric" ? TABLE_PAUSE.columnGone : p === "date" ? TABLE_PAUSE.dateColumnGone : TABLE_PAUSE.filterColumnGone;
}

/** The 400's words when a source being connected does not fit its table (H). */
export function columnConnectWords(p: TableColumnProblem): string {
  return p === "metric"
    ? "Choose a number column of this table to add up."
    : p === "date"
      ? "Choose a Date column of this table to count by."
      : "A filter names a column this table does not have, or one it cannot filter that way.";
}
