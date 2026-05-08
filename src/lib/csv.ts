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
