// GET    /api/tables/[id]/rows         list rows for a table
// POST   /api/tables/[id]/rows         create a row { values?: Record<string, unknown> }
// PATCH  /api/tables/[id]/rows         patch row { id, values } — shallow-merge
// DELETE /api/tables/[id]/rows         delete by id

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";

// Phase 32b — gate by parent Space visibility. Returns null when the
// table doesn't exist OR is scoped to a Space the viewer can't read.
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
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    take: 5000,
  });
  return jsonSuccess(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json();
  const values = typeof body.values === "object" && body.values !== null ? body.values : {};

  const max = await prisma.dataTableRow.findFirst({
    where: { tableId: id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const row = await prisma.dataTableRow.create({
    data: {
      organizationId: orgId,
      tableId: id,
      values: values as Prisma.InputJsonValue,
      position: (max?.position ?? 0) + 1,
      createdById: userId,
    },
  });
  return jsonSuccess(row, 201);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json();
  const rowId = typeof body.id === "string" ? body.id : null;
  if (!rowId) return jsonError("row id required");

  const existing = await prisma.dataTableRow.findFirst({
    where: { id: rowId, tableId: id },
    select: { id: true, values: true },
  });
  if (!existing) return jsonError("row not found", 404);

  const incoming = typeof body.values === "object" && body.values !== null ? body.values : null;
  const data: Record<string, unknown> = {};
  if (incoming) {
    const merged = { ...(existing.values as Record<string, unknown>), ...incoming };
    data.values = merged as Prisma.InputJsonValue;
  }
  if (typeof body.position === "number") data.position = body.position;

  const updated = await prisma.dataTableRow.update({ where: { id: rowId }, data });
  return jsonSuccess(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const table = await resolveTable(id, orgId, getUserId(session), accessLevel);
  if (!table) return jsonError("not found", 404);

  const body = await req.json();
  const rowId = typeof body.id === "string" ? body.id : null;
  if (!rowId) return jsonError("row id required");

  const existing = await prisma.dataTableRow.findFirst({ where: { id: rowId, tableId: id } });
  if (!existing) return jsonError("row not found", 404);

  await prisma.dataTableRow.delete({ where: { id: rowId } });
  return jsonSuccess({ deleted: true });
}
