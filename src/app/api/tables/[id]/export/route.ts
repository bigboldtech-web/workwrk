// GET /api/tables/[id]/export   -> text/csv (formatted values)
//
// The one table row menu's "Export as CSV" (spec-tables-forms section 2
// /tables): the list page, the sidebar row and the Space tree can export a
// table without opening it. The file is src/lib/table-csv.ts tableCsv, the
// builder the workspace export uses too. The sheet's own File > Download
// keeps both its formatted and raw options.
//
// Gate: the module, the reader gate every table route uses, and never an
// Agent (spec: Agents never see an Export row; cap.agent.export).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError } from "@/lib/api-helpers";
import { readableTable } from "@/lib/table-gate";
import { viewerFromSession } from "@/lib/access/viewer";
import { tableCsv } from "@/lib/table-csv";

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
  const csv = tableCsv(table, rows);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(table.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
