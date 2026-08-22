// PATCH /api/files/[id]   rename / move / star
// DELETE /api/files/[id]  remove the record (does not delete the blob)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withFreshFileUrl } from "@/lib/file-urls";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { moveToTrash } from "@/lib/trash";
import { getSpaceForReader } from "@/lib/space";

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

  // Phase 22b — gate by Space visibility. Hide existence (404 not 403)
  // so a viewer can't probe for the presence of files in Spaces they
  // shouldn't see.
  if (existing.spaceId) {
    const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
    const space = await getSpaceForReader(existing.spaceId, getUserId(session), accessLevel);
    if (!space) return jsonError("not found", 404);
  }

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

  // Space anchors — move the file anywhere: into a Space folder (spaceId is
  // derived from the folder), to a Space root (folder cleared), or out of
  // Spaces entirely (both cleared).
  if (body.spaceFolderId !== undefined) {
    if (body.spaceFolderId === null || body.spaceFolderId === "") {
      data.spaceFolderId = null;
    } else {
      const sf = await prisma.folder.findFirst({
        where: { id: body.spaceFolderId, space: { organizationId: orgId } },
        select: { id: true, spaceId: true },
      });
      if (!sf) return jsonError("space folder not found", 404);
      data.spaceFolderId = sf.id;
      data.spaceId = sf.spaceId;
    }
  }
  if (body.spaceId !== undefined && data.spaceId === undefined) {
    if (body.spaceId === null || body.spaceId === "") {
      data.spaceId = null;
      if (data.spaceFolderId === undefined) data.spaceFolderId = null;
    } else {
      const space = await prisma.space.findFirst({ where: { id: body.spaceId, organizationId: orgId }, select: { id: true } });
      if (!space) return jsonError("space not found", 404);
      data.spaceId = space.id;
      if (data.spaceFolderId === undefined) data.spaceFolderId = null;
    }
  }
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 500) ?? null;

  const updated = await prisma.fileEntry.update({ where: { id }, data });
  return jsonSuccess(await withFreshFileUrl(updated));
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

  if (existing.spaceId) {
    const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
    const space = await getSpaceForReader(existing.spaceId, getUserId(session), accessLevel);
    if (!space) return jsonError("not found", 404);
  }

  await moveToTrash("file", id, { organizationId: orgId, userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });
  return jsonSuccess({ deleted: true });
}
