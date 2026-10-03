// One table as CSV, the values the grid shows: formula cells evaluated by the
// SAME engine the grid runs (lib/sheet-embed buildEmbedSnapshot), so a
// formula exports its value, never "[object Object]"; headers are the column
// names with the letter as the fallback; trailing blank rows and unused
// columns are trimmed, so a seeded table exports the data a person typed.
//
// The one builder behind GET /api/tables/[id]/export and the tables in the
// workspace export (GET /api/export/all), so the two files never differ.
//
// CSV injection: a cell a colleague typed as =HYPERLINK(...) or +cmd runs
// as a formula when the file is opened in Excel or Sheets.
//
// THIS USED TO EXEMPT EVERY CELL OF A NUMERIC COLUMN, and that was the hole.
// A number column can hold text: a type change keeps the cells that do not
// convert, and an import or a form answer can land text there. So
// "=HYPERLINK(...)" typed into one went out raw. csvExportCell decides on the
// text alone, which is all Excel ever sees, and is the same function the
// sheet's File > Download uses, so the two exports cannot disagree. A real
// number (-5, 12.5%, -$42.00) still opens as a value.

import { buildEmbedSnapshot, type EmbedSourceColumn } from "@/lib/sheet-embed";
import { csvExportCell, csvFormulaSafe, toCsvMatrix } from "@/lib/csv";

export function tableCsv(table: { columns: unknown; settings: unknown }, rows: ReadonlyArray<{ id: string; values: unknown }>): string {
  const settings = table.settings as { namedRanges?: unknown } | null;
  const namedRanges = Array.isArray(settings?.namedRanges)
    ? settings.namedRanges.filter(
        (r): r is { name: string; ref: string } =>
          !!r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string" && typeof (r as { ref?: unknown }).ref === "string",
      )
    : [];
  const rawColumns: unknown[] = Array.isArray(table.columns) ? (table.columns as unknown[]) : [];
  const columns: EmbedSourceColumn[] = rawColumns
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c))
    .map((c) => ({
      id: String(c.id ?? ""),
      type: typeof c.type === "string" ? c.type : "short_text",
      label: typeof c.label === "string" ? c.label : "",
      formula: typeof c.formula === "string" ? c.formula : undefined,
      format: c.format && typeof c.format === "object" ? (c.format as EmbedSourceColumn["format"]) : undefined,
    }))
    .filter((c) => c.id !== "");

  const snap = buildEmbedSnapshot({
    columns,
    rows: rows.map((r) => ({ id: r.id, values: (r.values as Record<string, unknown> | null) ?? {} })),
    namedRanges,
  });
  return toCsvMatrix([
    snap.columns.map((c) => csvFormulaSafe(c.name)),
    ...snap.rows.map((r) => r.cells.map((v: string) => csvExportCell(v))),
  ]);
}
