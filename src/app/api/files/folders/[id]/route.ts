// PATCH  /api/files/folders/[id] { name?, parentId? }   rename / move a drive folder
// DELETE /api/files/folders/[id]                        move a drive folder to Trash
//
// spec-docs-knowledge section 2 (/files): folder rows get Rename, New folder
// inside and "Move to Trash (FULL; a trashed folder carries its files to
// Trash as one restorable snapshot)". The delete is the one Trash's
// "file_folder" kind (src/lib/trash.ts): the folder, every subfolder and every
// file inside them are captured as ONE TrashItem and restored together, so a
// person never has to empty a folder by hand and nothing scatters to the root.
// Full access on a drive folder today = its creator or an org admin (the
// drive has no grant rows until the access flip); a move refuses a cycle.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSessionObject } from "@/lib/access/viewer";
import { moveToTrash } from "@/lib/trash";

async function isDescendant(orgId: string, folderId: string, candidateAncestorId: string): Promise<boolean> {
  let cur: string | null = candidateAncestorId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === folderId) return true;
    seen.add(cur);
    const row: { parentId: string | null } | null = await prisma.fileFolder.findFirst({ where: { id: cur, organizationId: orgId }, select: { parentId: true } });
    cur = row?.parentId ?? null;
  }
  return false;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.fileFolder.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!existing) return jsonError("not found", 404);

  const body = await req.json().catch(() => ({}));
  const data: { name?: string; parentId?: string | null } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 120);
    if (!name) return jsonError("name required");
    data.name = name;
  }
  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === "") {
      data.parentId = null;
    } else if (typeof body.parentId === "string") {
      if (body.parentId === id) return jsonError("A folder cannot be moved into itself", 400);
      const parent = await prisma.fileFolder.findFirst({ where: { id: body.parentId, organizationId: orgId }, select: { id: true } });
      if (!parent) return jsonError("parent not found", 404);
      if (await isDescendant(orgId, id, body.parentId)) return jsonError("A folder cannot be moved into one of its own subfolders", 400);
      data.parentId = body.parentId;
    }
  }
  if (Object.keys(data).length === 0) return jsonError("nothing to change", 400);

  const folder = await prisma.fileFolder.update({
    where: { id },
    data,
    select: { id: true, name: true, parentId: true, createdAt: true, updatedAt: true, _count: { select: { files: true, children: true } } },
  });
  return jsonSuccess(folder);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const existing = await prisma.fileFolder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, createdById: true },
  });
  if (!existing) return jsonError("not found", 404);
  const orgRole = viewerFromSessionObject(session)?.orgRole;
  if (existing.createdById !== userId && orgRole !== "OWNER" && orgRole !== "ADMIN") {
    return jsonError("You need Full access on this folder to move it to Trash.", 403);
  }

  const moved = await moveToTrash("file_folder", id, {
    organizationId: orgId,
    userId,
    userName: (session.user as { name?: string }).name ?? null,
  });
  if (!moved) return jsonError("not found", 404);
  return jsonSuccess({ deleted: true, trashed: true });
}
