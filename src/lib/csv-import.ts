// The pure half of the in-place CSV import dialog (spec-tables-forms section
// 3, CsvImportDialog): what the preview shows and what the default mapping
// is, before anything is written. The write itself is POST /api/tables/[id]/
// import with `columns` built from this plan, so the preview a person checks
// is exactly what lands.

import { parseCsv } from "./csv";
import { columnLetter } from "./sheet-engine-host";

/** The row cap POST /api/tables/[id]/import enforces. */
export const CSV_IMPORT_MAX_ROWS = 5000;
export const CSV_PREVIEW_ROWS = 20;

/** The types a CSV column may be created as (text in, typed on entry). */
export const CSV_IMPORT_TYPES = [
  { value: "short_text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Single select" },
  { value: "multi_select", label: "Multiple select" },
  { value: "url", label: "Link" },
  { value: "email", label: "Email" },
] as const;

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  width: number;
  /** False when the headers are the synthetic "Column N" names, not the file's first row. */
  hasHeader: boolean;
}

/** Split the text into a header row and data rows. `hasHeader` false = "Column 1", "Column 2", ... */
export function readCsv(text: string, hasHeader: boolean): ParsedCsv {
  const all = parseCsv(text);
  const width = all.reduce((m, r) => Math.max(m, r.length), 0);
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => (all[0]?.[i] ?? "").trim() || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  return { headers, rows: hasHeader ? all.slice(1) : all, width, hasHeader };
}

const NUM_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const CURRENCY_RE = /^[-+]?[$£€¥₹]\s?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const PCT_RE = /^[-+]?\d+(\.\d+)?\s?%$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const BOOL_RE = /^(true|false|yes|no)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;

/**
 * A starting type for one CSV column from its non-empty cells: the type every
 * sampled value fits, else Text. A guess the person can change before the
 * write; it never decides anything alone.
 */
export function guessColumnType(values: readonly string[]): string {
  const cells = values.map((v) => v.trim()).filter((v) => v !== "").slice(0, 200);
  if (cells.length === 0) return "short_text";
  const all = (re: RegExp) => cells.every((c) => re.test(c));
  if (all(NUM_RE)) return "number";
  if (all(CURRENCY_RE)) return "currency";
  if (all(PCT_RE)) return "percent";
  if (all(DATE_RE)) return "date";
  if (all(BOOL_RE)) return "checkbox";
  if (all(EMAIL_RE)) return "email";
  if (all(URL_RE)) return "url";
  if (cells.some((c) => c.length > 120 || c.includes("\n"))) return "long_text";
  return "short_text";
}

export interface TargetColumn {
  id: string;
  label: string;
}

/** One CSV column's fate: an existing column, a new one (name and type), or skipped. */
export type CsvColumnPlan =
  | { kind: "existing"; target: string }
  | { kind: "new"; label: string; type: string }
  | { kind: "skip" };

/**
 * The default plan. Creating a new table: every CSV column becomes a new
 * column with its header as the name and the guessed type. Appending to a
 * table: a column whose name matches (case-insensitive) is written into;
 * otherwise, a sheet-born table's UNNAMED column at the same position is used
 * (a new table's A, B, C are unnamed), so the data lands where a spreadsheet
 * user expects instead of after column Z; anything left becomes a new column.
 * Every existing column is used at most once.
 *
 * A headerless file ("First row is a header" off) has no names to match: its
 * "Column N" headers are made up. So its columns go by position alone, CSV
 * column 1 into A, 2 into B and so on, named or not, as pasting into Sheets
 * does. Only a CSV column past the table's last column becomes a new one.
 * Matching by name there would send the data after the last column (or into
 * a column someone once called "Column 3") while A to E stayed empty.
 */
export function defaultPlan(parsed: ParsedCsv, target: readonly TargetColumn[] | null): CsvColumnPlan[] {
  if (!target) {
    return parsed.headers.map((h, i) => ({ kind: "new", label: h, type: guessColumnType(parsed.rows.map((r) => r[i] ?? "")) }));
  }
  if (!parsed.hasHeader) {
    return parsed.headers.map((h, i) => {
      const at = target[i];
      if (at) return { kind: "existing", target: at.id };
      return { kind: "new", label: h, type: guessColumnType(parsed.rows.map((r) => r[i] ?? "")) };
    });
  }
  const used = new Set<string>();
  return parsed.headers.map((h, i) => {
    const byName = target.find((c) => !used.has(c.id) && c.label.trim() !== "" && c.label.trim().toLowerCase() === h.trim().toLowerCase());
    if (byName) { used.add(byName.id); return { kind: "existing", target: byName.id }; }
    const same = target[i];
    if (same && !used.has(same.id) && same.label.trim() === "") { used.add(same.id); return { kind: "existing", target: same.id }; }
    return { kind: "new", label: h, type: guessColumnType(parsed.rows.map((r) => r[i] ?? "")) };
  });
}

/** The import route's `columns` body, one entry per CSV column. */
export function planToBody(plan: readonly CsvColumnPlan[]): { target?: string; label?: string; type?: string; skip?: boolean }[] {
  return plan.map((p) => (p.kind === "existing" ? { target: p.target } : p.kind === "skip" ? { skip: true } : { label: p.label, type: p.type }));
}

/** The name or letter an existing column shows in the mapping picker. */
export function targetColumnName(target: readonly TargetColumn[], id: string): string {
  const i = target.findIndex((c) => c.id === id);
  if (i < 0) return "";
  return target[i].label.trim() || columnLetter(i);
}

/** "128 rows and 5 new columns" style summary pieces, for the line before the write. */
export function planSummary(parsed: ParsedCsv, plan: readonly CsvColumnPlan[]): { rows: number; newColumns: number; skipped: number } {
  return {
    rows: parsed.rows.length,
    newColumns: plan.filter((p) => p.kind === "new").length,
    skipped: plan.filter((p) => p.kind === "skip").length,
  };
}

/** A file name without its extension, as a table name. */
export function tableNameFromFile(fileName: string): string {
  return (fileName.replace(/\.[^.]+$/, "").trim() || "Imported table").slice(0, 200);
}
