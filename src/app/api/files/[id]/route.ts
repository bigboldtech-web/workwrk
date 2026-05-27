// PATCH /api/files/[id]   rename / move / star
// DELETE /api/files/[id]  remove the record (does not delete the blob)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.fileEntry.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("not found", 404);

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 200);
  if (body.folderId !== undefined) {
    if (body.folderId === null || body.folderId === "") data.folderId = null;
    else {
      const folder = await prisma.fileFolder.findFirst({ where: { id: body.folderId, organizationId: orgId }, select: { id: true } });
      if (!folder) return jsonError("folder not found", 404);
      data.folderId = body.folderId;
    }
  }
  if (typeof body.starred === "boolean") data.starred = body.starred;
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 500) ?? null;

  const updated = await prisma.fileEntry.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.fileEntry.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("not found", 404);

  await prisma.fileEntry.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
