// Tiny CSV serializer. RFC 4180-ish — quotes fields containing
// comma / quote / newline, doubles up internal quotes. UTF-8 BOM
// prepended so Excel on Windows opens non-ASCII correctly.
//
// We deliberately don't stream: at the volume Fortune-500 admins
// actually export interactively (a quarter of expenses, a year of
// time-off requests for one team), the full payload comfortably
// fits in memory. Pure background reports go through a different
// path that we'll build later when needed.

export type CsvCell = string | number | boolean | Date | null | undefined;

export function toCsv(rows: Record<string, CsvCell>[], columns?: string[]): string {
  if (rows.length === 0 && !columns) return "﻿\n";
  const headers = columns ?? Object.keys(rows[0] ?? {});
  const lines: string[] = [];
  lines.push(headers.map(escapeCell).join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  // BOM + CRLF per RFC 4180. Excel needs the BOM for UTF-8.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function escapeCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  // Quote if it contains the field separator, quote char, or any
  // line break. Internal quotes are doubled per RFC 4180.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvFilename(type: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${type}-${stamp}.csv`;
}

/**
 * Text someone else typed, made safe to open in a spreadsheet: a cell that
 * starts with = + - @, a tab or a carriage return is read by Excel and Sheets
 * as a formula (CSV injection), so it gets a leading apostrophe, which both
 * apps show as plain text. Use it on free text from other people (form
 * answers, a table's text cells in GET /api/tables/[id]/export), never on
 * numbers.
 */
export function csvFormulaSafe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/**
 * Text that is a number AS DISPLAYED, and so cannot start a formula: an
 * optional minus, an optional opening bracket (accounting negatives), an
 * optional currency symbol, then digits with grouping, a decimal part, an
 * exponent, a percent, a trailing symbol or a closing bracket. Anchored at
 * both ends, so "-2+3" and "-cmd|..." do not match. It never admits a leading
 * "+", because no number the product displays starts with one.
 */
const CSV_SAFE_NUMBER = /^-?\(?\p{Sc}?\d[\d,]*(\.\d+)?(e[-+]?\d+)?%?\s?\p{Sc}?\)?$/iu;

/**
 * One cell of a CSV export: a number goes out as the number it is, and
 * everything else through csvFormulaSafe.
 *
 * THE DECISION IS MADE ON THE TEXT, AND ONLY ON THE TEXT. Both table exports
 * used to exempt cells from csvFormulaSafe by what they WERE rather than by
 * what they SAID: the server export skipped every cell of a numeric column,
 * and the sheet's File > Download skipped any cell whose underlying value was
 * a number. A number column can hold text (a type change keeps the cells
 * that do not convert, and an import or a form answer can land text there),
 * so "=HYPERLINK(...)" or "-cmd|' /C calc'!A0" typed into one went out raw,
 * and Excel runs a cell that starts with = + - or @ as a formula. Excel sees
 * only the text, so the text is the only thing that can decide.
 *
 * The exemption exists for one reason: a negative number must stay a
 * number. Escaping "-42" to "'-42" would open it as text, which is data
 * corruption of its own.
 */
export function csvExportCell(text: string): string {
  return CSV_SAFE_NUMBER.test(text) ? text : csvFormulaSafe(text);
}

/** A header row plus data rows, all text, serialised with the same rules. */
export function toCsvMatrix(rows: readonly (readonly CsvCell[])[]): string {
  return "﻿" + rows.map((r) => r.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Parse CSV text into rows of cells: comma separators, double-quoted fields,
 * "" escapes inside quotes, \r\n or \n line endings, a leading UTF-8 BOM and
 * trailing blank lines ignored. The one parser behind the in-place import
 * dialog's preview and POST /api/tables/[id]/import, so the preview a person
 * checks is exactly what is written.
 *
 * A quote opens a quoted field only as the field's FIRST character. Anywhere
 * else it is a literal character, as Google Sheets reads it: `Pipe,12" long,4`
 * is three cells with the inch mark kept, and an unquoted
 * `=HYPERLINK("a","b")` stays one cell. Treating every quote as an opener
 * swallowed the rest of the file into one cell until the next stray quote,
 * and the import then wrote one row where there were many.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // True until the current field has consumed any character (a quoted
  // field's closing quote counts, so `""` then `"` is not a second opener).
  let atFieldStart = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; }
      else if (ch === ",") { row.push(cell); cell = ""; atFieldStart = true; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; atFieldStart = true; }
      else if (ch === "\r") { /* handled on \n */ }
      else { cell += ch; atFieldStart = false; }
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
}
