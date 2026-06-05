// GET    /api/tables/[id]   table + row count
// PATCH  /api/tables/[id]   update name / description / columns
// DELETE /api/tables/[id]   delete (rows cascade)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";

// Phase 32b — gate scoped tables by their parent Space's visibility.
// Mirrors the Files/Whiteboards/Docs per-row gate from Phase 22b.
// Hide existence (404, not 403) so viewers can't probe for table IDs
// in Spaces they shouldn't see.
async function checkSpaceVisible(
  spaceId: string | null,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  if (!spaceId) return true;
  const space = await getSpaceForReader(spaceId, userId, accessLevel ?? "EMPLOYEE");
  return Boolean(space);
}

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
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  if (!(await checkSpaceVisible(table.spaceId, getUserId(session), accessLevel))) {
    return jsonError("not found", 404);
  }

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
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  if (!(await checkSpaceVisible(existing.spaceId, getUserId(session), accessLevel))) {
    return jsonError("not found", 404);
  }

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
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  if (!(await checkSpaceVisible(existing.spaceId, getUserId(session), accessLevel))) {
    return jsonError("not found", 404);
  }

  await prisma.dataTable.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
