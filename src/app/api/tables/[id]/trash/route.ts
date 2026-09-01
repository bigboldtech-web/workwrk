// GET  /api/tables/[id]/trash   — list this table's soft-deleted rows
// POST /api/tables/[id]/trash   — { action: "restore" | "purge", ids: [...] }
//                                  | { action: "empty" }
//
// Row trash: a deleted row is soft-deleted (deletedAt stamped) and hidden from
// the grid, recoverable here for 60 days, then purged by cron. "restore" clears
// deletedAt; "purge"/"empty" hard-delete (unrecoverable).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";

async function resolveTable(id: string, orgId: string, userId: string, accessLevel: string | null | undefined) {
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, organizationId: true, spaceId: true },
  });
  if (!table) return null;
  if (table.spaceId) {
    const space = await getSpaceForReader(table.spaceId, userId, accessLevel ?? "EMPLOYEE");
    if (!space) return null;
  }
  return table;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 500,
    select: { id: true, values: true, position: true, deletedAt: true },
  });
  return jsonSuccess({ rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const ids: string[] = Array.isArray(body?.ids)
    ? [...new Set((body.ids as unknown[]).filter((x): x is string => typeof x === "string"))].slice(0, 5000)
    : [];

  if (action === "restore") {
    if (ids.length === 0) return jsonError("ids required", 400);
    // Only trashed rows of THIS table are eligible — a caller can't revive a
    // row from another table or one that was never deleted.
    const res = await prisma.dataTableRow.updateMany({
      where: { tableId: id, id: { in: ids }, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    return jsonSuccess({ restored: res.count });
  }

  if (action === "purge") {
    if (ids.length === 0) return jsonError("ids required", 400);
    const res = await prisma.dataTableRow.deleteMany({
      where: { tableId: id, id: { in: ids }, deletedAt: { not: null } },
    });
    return jsonSuccess({ purged: res.count });
  }

  if (action === "empty") {
    const res = await prisma.dataTableRow.deleteMany({
      where: { tableId: id, deletedAt: { not: null } },
    });
    return jsonSuccess({ purged: res.count });
  }

  return jsonError("unknown action", 400);
}
