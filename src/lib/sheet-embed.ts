// The public table embed's snapshot, computed on the SERVER from the same engine
// the grid runs (spec-tables-forms section 2 /embed/tables/[id], Data):
//
//   - computed display values, so a formula cell stored as { "=": "A1+B2" }
//     renders its number, never "[object Object]";
//   - column NAMES with the letter as the fallback, so the header row of a
//     sheet-born table (26 unnamed columns) reads A, B, C instead of blanks;
//   - an alignment per column (numbers right), and the reserved $fmt and $rh
//     keys never surface as columns;
//   - trailing blank rows and trailing unused columns trimmed, so a new table
//     reads as the data a person typed, not 1,000 empty rows by 26 columns.
//
// Every row goes through the engine BEFORE paging: a formula on page 1 may
// read row 4,000, so the page is cut from the evaluated whole. The engine's
// row anchoring is the law (A1 row N is storage index N-1), so rows go in
// unsorted storage order.
//
// Pure: imports only the engine host, the formatters and the entry typer,
// all server safe.

import { createTableEngine, columnLetter, type NamedRangeDef, type TableEngine } from "./sheet-engine-host";
import { isFormulaCell } from "./sheet-engine";
import { formatCellValue, type ColumnFormat } from "./sheet-format";
import { isReservedKey, readCellStyle, type CellStyle } from "./sheet-cell-style";
import { isOpenColumnType } from "./sheet-entry";

export interface EmbedSourceColumn {
  id: string;
  type: string;
  label?: string;
  formula?: string;
  format?: ColumnFormat;
}

export interface EmbedSourceRow {
  id: string;
  values: Record<string, unknown>;
}

export interface EmbedColumn {
  id: string;
  /** The column's name, or its letter when it has none. */
  name: string;
  letter: string;
  type: string;
  align: "left" | "right" | "center";
}

export interface EmbedRow {
  id: string;
  cells: string[];
}

export interface EmbedSnapshot {
  columns: EmbedColumn[];
  rows: EmbedRow[];
}

const NUMERIC_TYPES = new Set(["number", "currency", "percent", "rating"]);
const FORMATTABLE_TYPES = new Set(["number", "currency", "percent", "date"]);

/** The header text: the name, else the letter (A, B, ... AA). */
export function columnDisplayName(label: string | undefined | null, index: number): string {
  const t = typeof label === "string" ? label.trim() : "";
  return t || columnLetter(index);
}

function openCellText(v: unknown, style: CellStyle | undefined): string {
  if (v == null || v === "") return "";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const nf = style?.nf;
  if (!nf) return String(v);
  return formatCellValue(nf === "percent" ? v * 100 : v, nf, { style: nf, decimals: style?.dp, thousands: true, currency: "USD" });
}

/** One cell's display text, by the grid's own rules (tables/[id] renderCellContent). */
export function embedCellText(
  column: EmbedSourceColumn,
  row: EmbedSourceRow,
  engine: TableEngine | null,
  people?: ReadonlyMap<string, string>,
): string {
  const v = row.values[column.id];
  const computed = column.type === "formula" || isFormulaCell(v);

  if (computed) {
    if (!engine) return "";
    let text = "";
    try { text = engine.display(column.id, row.id); } catch { return ""; }
    if (text.startsWith("#")) return text;
    const value = (() => { try { return engine.value(column.id, row.id); } catch { return null; } })();
    if (column.type === "checkbox") return value === true || text === "TRUE" ? "✓" : "";
    if (FORMATTABLE_TYPES.has(column.type)) {
      if (typeof value === "number") return formatCellValue(value, column.type, column.format);
      if (column.type === "date" && typeof value === "string") return formatCellValue(value, "date", column.format);
    }
    // An OPEN column formats a computed number only when the CELL carries a
    // number format ($, %), exactly as the grid does. With no format the
    // grid shows the engine's display text, which trims float noise to 10
    // digits (=800/1200 reads 0.6666666667, =0.1+0.2 reads 0.3); String(value)
    // would print the raw double and the public view would disagree.
    if (isOpenColumnType(column.type) && typeof value === "number") {
      const style = readCellStyle(row.values, column.id);
      if (style?.nf) return openCellText(value, style);
    }
    return text;
  }

  switch (column.type) {
    case "checkbox": return v === true || v === "true" ? "✓" : "";
    case "lookup": case "rollup": case "link": case "attachment": {
      // Relational cells compute from OTHER tables, which a public embed does
      // not load. A count is honest; a guessed value is not.
      if (Array.isArray(v) && v.length) return column.type === "attachment" ? `${v.length} file${v.length === 1 ? "" : "s"}` : `${v.length} linked`;
      return "";
    }
    case "person": {
      const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      return arr.map((id) => people?.get(id) ?? "").filter(Boolean).join(", ");
    }
    case "multi_select": return Array.isArray(v) ? v.map(String).join(", ") : typeof v === "string" ? v : "";
    case "rating": return formatCellValue(v, "rating");
    case "number": case "currency": case "percent": {
      if (v == null || v === "") return "";
      const n = typeof v === "number" ? v : Number(String(v).trim());
      const numeric = typeof v === "number" || (String(v).trim() !== "" && Number.isFinite(n));
      if (!numeric || (typeof v !== "number" && !column.format)) {
        if (column.type === "currency") return `$${String(v)}`;
        if (column.type === "percent") return `${String(v)}%`;
        return String(v);
      }
      return formatCellValue(n, column.type, column.format);
    }
    case "date": return v == null || v === "" ? "" : formatCellValue(v, "date", column.format);
    default: {
      if (v == null || v === "") return "";
      if (typeof v === "object") return Array.isArray(v) ? v.map(String).join(", ") : "";
      return column.type === "short_text" ? openCellText(v, readCellStyle(row.values, column.id)) : String(v);
    }
  }
}

function alignFor(type: string): EmbedColumn["align"] {
  if (NUMERIC_TYPES.has(type)) return "right";
  if (type === "checkbox") return "center";
  return "left";
}

/** Evaluate everything, then trim trailing blank rows and unused columns. */
export function buildEmbedSnapshot(input: {
  columns: readonly EmbedSourceColumn[];
  rows: readonly EmbedSourceRow[];
  namedRanges?: readonly NamedRangeDef[];
  people?: ReadonlyMap<string, string>;
}): EmbedSnapshot {
  const cols = input.columns.filter((c) => c && typeof c.id === "string" && !isReservedKey(c.id));
  let engine: TableEngine | null = null;
  try {
    engine = createTableEngine({
      columns: cols.map((c) => ({ id: c.id, label: c.label ?? "", type: c.type, formula: c.formula })),
      rows: input.rows.map((r) => ({ id: r.id, values: r.values ?? {} })),
      namedRanges: input.namedRanges ?? [],
    });
  } catch {
    // A malformed table must not blank a public page: literals only.
    engine = null;
  }

  const matrix = input.rows.map((r) => ({
    id: r.id,
    cells: cols.map((c) => embedCellText(c, { id: r.id, values: r.values ?? {} }, engine, input.people)),
  }));

  // Trailing unused columns: no name, no formula, and no cell text anywhere.
  let lastCol = cols.length - 1;
  while (lastCol >= 0) {
    const c = cols[lastCol];
    const named = typeof c.label === "string" && c.label.trim() !== "";
    const used = named || !!c.formula || matrix.some((r) => r.cells[lastCol] !== "");
    if (used) break;
    lastCol -= 1;
  }
  const keep = lastCol + 1;

  // Trailing blank rows. A cell a COLUMN formula fills does not make a row
  // used: =[Price]*2 reads 0 on every empty row, and counting it would keep
  // all 1,000 seeded rows. A row counts when a person put something in it:
  // any stored cell (a value or a cell formula) or any shown text that did
  // not come from the column's own formula.
  const byColumnFormula = cols.map((c) => c.type === "formula");
  const rowUsed = (i: number): boolean => {
    const values = input.rows[i]?.values ?? {};
    const cells = matrix[i].cells;
    for (let c = 0; c < keep; c++) {
      const stored = values[cols[c].id];
      const hasStored = stored !== undefined && stored !== null && stored !== "" && stored !== false
        && !(Array.isArray(stored) && stored.length === 0);
      if (byColumnFormula[c] && !isFormulaCell(stored)) continue;
      if (hasStored || cells[c] !== "") return true;
    }
    return false;
  };
  let lastRow = matrix.length - 1;
  while (lastRow >= 0 && !rowUsed(lastRow)) lastRow -= 1;
  const kept = matrix.slice(0, lastRow + 1);

  // A formula column is right aligned when every value it shows is a number
  // (the spec: numbers right aligned with tnum), and left when any is text.
  const numericFormula = (c: number): boolean => {
    if (!engine) return false;
    let seen = false;
    for (const r of kept) {
      if (r.cells[c] === "" || r.cells[c].startsWith("#")) continue;
      let v: unknown = null;
      try { v = engine.value(cols[c].id, r.id); } catch { return false; }
      if (typeof v !== "number") return false;
      seen = true;
    }
    return seen;
  };

  return {
    columns: cols.slice(0, keep).map((c, i) => ({
      id: c.id,
      name: columnDisplayName(c.label, i),
      letter: columnLetter(i),
      type: c.type,
      align: c.type === "formula" && numericFormula(i) ? "right" : alignFor(c.type),
    })),
    rows: kept.map((r) => ({ id: r.id, cells: r.cells.slice(0, keep) })),
  };
}

/** The page of rows a cursor names: the cursor is the index of the first row. */
export function pageEmbedRows<T>(rows: readonly T[], cursor: string | null, limitRaw: string | null): { page: T[]; nextCursor: string | null; start: number } {
  const lim = Number(limitRaw);
  const limit = Number.isFinite(lim) && lim > 0 ? Math.min(1000, Math.floor(lim)) : 200;
  const c = Number(cursor);
  const start = Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
  const page = rows.slice(start, start + limit);
  const next = start + limit < rows.length ? String(start + limit) : null;
  return { page, nextCursor: next, start };
}
