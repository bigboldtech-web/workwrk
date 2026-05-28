// GET    /api/tables/[id]   table + row count
// PATCH  /api/tables/[id]   update name / description / columns
// DELETE /api/tables/[id]   delete (rows cascade)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { rows: true } } },
  });
  if (!table) return jsonError("not found", 404);

  return jsonSuccess({ ...table, rowCount: table._count.rows });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.dataTable.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 200);
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 2000) ?? null;
  if (Array.isArray(body.columns)) data.columns = body.columns;
  if (typeof body.isPublic === "boolean") data.isPublic = body.isPublic;

  const updated = await prisma.dataTable.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.dataTable.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);

  await prisma.dataTable.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
