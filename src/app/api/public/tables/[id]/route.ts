// GET /api/public/tables/[id]   read-only public table data (no auth)
//
// Returns columns + rows for a DataTable, but only if its `isPublic`
// flag is true. Mirrors the public-form responder pattern. No write
// methods on this path; for writes, callers must use the authenticated
// /api/tables/[id]/rows route.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const table = await prisma.dataTable.findFirst({
    where: { id, isPublic: true },
    select: { id: true, name: true, description: true, columns: true },
  });
  if (!table) return jsonError("not found", 404);

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    take: 5000,
    select: { id: true, values: true, position: true },
  });

  return jsonSuccess({ ...table, rows });
}
