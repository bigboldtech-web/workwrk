// Pivot compute — pure, no React, no DOM. Given resolved table records and a
// { rowFields, colField, valueField, agg } config, group the rows and aggregate
// one value into a matrix (row groups × column-field values), with per-row,
// per-column and grand totals. The dialog resolves formula cells to plain
// values first, so this stays a pure function over a records array.

export type PivotAgg = "sum" | "count" | "avg" | "min" | "max";

export interface PivotConfig {
  /** Column ids to group rows by (nested, joined for the row label). */
  rowFields: string[];
  /** Column id whose distinct values become the matrix columns; null = a single
   *  "Total" column (a plain grouped aggregation). */
  colField: string | null;
  /** Column id to aggregate; null = COUNT of rows (value ignored). */
  valueField: string | null;
  agg: PivotAgg;
}

export interface PivotRow {
  /** The row-group label (row-field values joined by " / "). */
  key: string;
  /** One aggregated number per column in `columns`, then filled left-to-right. */
  cells: number[];
  /** The row's total across the columns. */
  total: number;
}

export interface PivotResult {
  /** Distinct column-field values (sorted); empty when colField is null. */
  columns: string[];
  rows: PivotRow[];
  columnTotals: number[];
  grandTotal: number;
  /** True when there is nothing to show (no config or no matching rows). */
  empty: boolean;
}

const BLANK = "(blank)";

/** A cell value coerced to a number, or null when it isn't numeric. Numeric
 *  text ("5") counts; blanks, booleans and junk do not. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** A cell value as a group label. null/"" become "(blank)" so they still form a
 *  group rather than vanishing. */
function toLabel(v: unknown): string {
  if (v === null || v === undefined || v === "") return BLANK;
  if (Array.isArray(v)) return v.length ? v.join(", ") : BLANK;
  return String(v);
}

/** Fold a bucket of raw cell values into one aggregate. COUNT counts non-empty
 *  cells; the numeric aggregates skip non-numbers and return 0 for an empty
 *  bucket (except AVG, which is 0 with no numbers — a pivot cell is never
 *  blank-vs-zero ambiguous the way a formula is). */
function aggregate(values: unknown[], agg: PivotAgg, valueField: string | null): number {
  if (agg === "count" || valueField === null) {
    return values.filter((v) => v !== null && v !== undefined && v !== "").length;
  }
  const nums: number[] = [];
  for (const v of values) {
    const n = toNumber(v);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return 0;
  switch (agg) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
    default: return 0;
  }
}

export function computePivot(
  records: ReadonlyArray<Record<string, unknown>>,
  config: PivotConfig,
): PivotResult {
  const empty = (): PivotResult => ({ columns: [], rows: [], columnTotals: [], grandTotal: 0, empty: true });
  if (config.rowFields.length === 0 || records.length === 0) return empty();
  // COUNT needs no value field; every other agg does.
  if (config.agg !== "count" && !config.valueField) return empty();

  const rowKeyOf = (r: Record<string, unknown>) => config.rowFields.map((f) => toLabel(r[f])).join(" / ");

  // Distinct column-field values, sorted (numbers numerically, else lexically).
  let columns: string[] = [];
  if (config.colField) {
    const set = new Set<string>();
    for (const r of records) set.add(toLabel(r[config.colField]));
    columns = [...set].sort((a, b) => {
      const na = Number(a); const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }

  // Bucket the raw value-cells by (rowKey, colValue). ROW ORDER = first
  // appearance, so a pivot is stable and reads in the table's own order.
  const rowOrder: string[] = [];
  const buckets = new Map<string, Map<string, unknown[]>>(); // rowKey → colValue → values
  const valueOf = (r: Record<string, unknown>) => (config.valueField ? r[config.valueField] : 1);

  for (const r of records) {
    const rk = rowKeyOf(r);
    let byCol = buckets.get(rk);
    if (!byCol) {
      byCol = new Map();
      buckets.set(rk, byCol);
      rowOrder.push(rk);
    }
    const ck = config.colField ? toLabel(r[config.colField]) : "__all__";
    const arr = byCol.get(ck) ?? [];
    arr.push(valueOf(r));
    byCol.set(ck, arr);
  }

  const colKeys = config.colField ? columns : ["__all__"];
  const rows: PivotRow[] = rowOrder.map((rk) => {
    const byCol = buckets.get(rk)!;
    const cells = colKeys.map((ck) => aggregate(byCol.get(ck) ?? [], config.agg, config.valueField));
    // The row total re-aggregates ALL of the row's values (correct for AVG,
    // where summing the per-column averages would be wrong).
    const all: unknown[] = [];
    for (const vs of byCol.values()) all.push(...vs);
    return { key: rk, cells, total: aggregate(all, config.agg, config.valueField) };
  });

  const columnTotals = colKeys.map((ck) => {
    const all: unknown[] = [];
    for (const byCol of buckets.values()) {
      const vs = byCol.get(ck);
      if (vs) all.push(...vs);
    }
    return aggregate(all, config.agg, config.valueField);
  });

  const allValues: unknown[] = [];
  for (const byCol of buckets.values()) for (const vs of byCol.values()) allValues.push(...vs);
  const grandTotal = aggregate(allValues, config.agg, config.valueField);

  return {
    columns: config.colField ? columns : [],
    rows,
    columnTotals,
    grandTotal,
    empty: rows.length === 0,
  };
}
