// GET /api/tables/[id]/export   -> text/csv (formatted values)
//
// The one table row menu's "Export as CSV" (spec-tables-forms section 2
// /tables): the list page, the sidebar row and the Space tree can export a
// table without opening it. Formula cells are evaluated by the SAME engine
// the grid runs (lib/sheet-embed buildEmbedSnapshot), so a formula exports its
// value, never "[object Object]"; headers are the column names with the letter
// as the fallback; trailing blank rows and unused columns are trimmed, so a
// seeded table exports the data a person typed. The sheet's own File >
// Download keeps both its formatted and raw options.
//
// Gate: the module, the reader gate every table route uses, and never an
// Agent (spec: Agents never see an Export row; cap.agent.export).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError } from "@/lib/api-helpers";
import { readableTable } from "@/lib/table-gate";
import { viewerFromSession } from "@/lib/access/viewer";
import { buildEmbedSnapshot, type EmbedSourceColumn } from "@/lib/sheet-embed";
import { csvExportCell, csvFormulaSafe, toCsvMatrix } from "@/lib/csv";

function fileName(name: string): string {
  const base = (name || "table").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "table";
  return `${base}.csv`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const viewer = await viewerFromSession().catch(() => null);
  if (viewer?.isAgent) return jsonError("Agents cannot export", 403);

  const table = await readableTable(id, orgId, userId, session);
  if (!table) return jsonError("not found", 404);

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id, deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, values: true },
  });
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
  // CSV injection: a cell a colleague typed as =HYPERLINK(...) or +cmd runs
  // as a formula when the file is opened in Excel or Sheets.
  //
  // THIS USED TO EXEMPT EVERY CELL OF A NUMERIC COLUMN, and that was the
  // hole. A number column can hold text: a type change keeps the cells that
  // do not convert, and an import or a form answer can land text there. So
  // "=HYPERLINK(...)" typed into one went out raw. csvExportCell decides on
  // the text alone, which is all Excel ever sees, and is the same function
  // the sheet's File > Download uses, so the two exports cannot disagree.
  // A real number (-5, 12.5%, -$42.00) still opens as a value.
  const safeCell = (v: string) => csvExportCell(v);
  const csv = toCsvMatrix([
    snap.columns.map((c) => csvFormulaSafe(c.name)),
    ...snap.rows.map((r) => r.cells.map(safeCell)),
  ]);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(table.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
