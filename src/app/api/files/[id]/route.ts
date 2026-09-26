// GET    /api/files/[id]  one file row (the ?file= deep link needs its folder)
// PATCH  /api/files/[id]  rename / move / star
// DELETE /api/files/[id]  remove the record (does not delete the blob)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withFreshFileUrl } from "@/lib/file-urls";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { moveToTrash } from "@/lib/trash";
import { canReadFile } from "@/lib/file-access";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { PlacementConflict, checkFileEdit, lockFolderPlacement, resolveFileMove } from "@/lib/access/node-placement";

/**
 * One file row.
 *
 * Added for `/files?file=<id>`, which is where a starred file in the Docs
 * sidebar and a restored file in Trash both point (`TRASH_HREF.file`). The
 * page needs the file's folder to open the right folder around it, and there
 * was no way to ask for one file: every other reader took a list. Same
 * org scope and the one file read gate (src/lib/file-access.ts) as the list,
 * so a file the viewer may not see answers 404 rather than confirming it exists.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const file = await prisma.fileEntry.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!file) return jsonError("not found", 404);

  // The one read gate, shared with the /files list and /[id]/url
  // (src/lib/file-access.ts): a folder-only grantee who sees the row in the
  // list can open it here too.
  if (!(await canReadFile(file, getUserId(session), (session.user as { accessLevel?: string }).accessLevel))) return jsonError("not found", 404);

  const [fresh, uploader, folder, sf, sp] = await Promise.all([
    withFreshFileUrl(file),
    prisma.user.findFirst({ where: { id: file.uploadedById }, select: { id: true, firstName: true, lastName: true, avatar: true } }),
    file.folderId ? prisma.fileFolder.findFirst({ where: { id: file.folderId }, select: { id: true, name: true } }) : Promise.resolve(null),
    file.spaceFolderId ? prisma.folder.findFirst({ where: { id: file.spaceFolderId }, select: { id: true, name: true } }) : Promise.resolve(null),
    file.spaceId ? prisma.space.findFirst({ where: { id: file.spaceId }, select: { id: true, name: true, slug: true, icon: true, color: true } }) : Promise.resolve(null),
  ]);
  return jsonSuccess({
    ...fresh,
    uploadedBy: uploader ? { id: uploader.id, name: `${uploader.firstName ?? ""} ${uploader.lastName ?? ""}`.trim() || null, avatar: uploader.avatar, firstName: uploader.firstName, lastName: uploader.lastName } : null,
    folder: folder ? { id: folder.id, name: folder.name } : null,
    spaceFolder: sf ? { id: sf.id, name: sf.name } : null,
    space: sp ? { id: sp.id, name: sp.name, slug: sp.slug, icon: sp.icon, color: sp.color } : null,
  });
}

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
  if (!(await canReadFile(existing, getUserId(session), (session.user as { accessLevel?: string }).accessLevel))) return jsonError("not found", 404);

  // A change to the file itself (its name, description or drive folder) is
  // a write in the container it sits in: Can edit there (node-rules
  // fileEditDecision), never a Can view grant. Starring stays a reader's
  // mark, as it always was.
  const accessLevelFor = (session.user as { accessLevel?: string }).accessLevel;
  const editsFile = typeof body.name === "string" || body.folderId !== undefined || typeof body.description === "string" || body.description === null;
  if (editsFile) {
    const edit = await checkFileEdit(nodeCtxFromLevel(getUserId(session), orgId, accessLevelFor), existing);
    if (!edit.ok) return jsonError(edit.error, edit.status);
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
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 500) ?? null;

  // THE PLACEMENT RULE for the file's place in the Space tree (node-rules P2
  // and P3, node-placement resolveFileMove). What the request names: a Space
  // folder (the Space comes from it; a spaceId that disagrees is a 400), a
  // Space's root (spaceFolderId cleared: the Space named, else the one the
  // file is in), or out of every Space (spaceId null). The folder is checked
  // for Trash and for an archived Space, and the move needs its uploader or
  // Full access where it is now, Full access on the place it leaves (and its
  // Space when it leaves every Space), and Can edit where it goes. A drive
  // folder (folderId) is not a Space container and keeps its own rule.
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  let placed: { spaceId: string | null; spaceFolderId: string | null } | null = null;
  if (body.spaceFolderId !== undefined || body.spaceId !== undefined) {
    const folderNamed = str(body.spaceFolderId);
    const req = folderNamed
      ? { spaceFolderId: folderNamed, ...(body.spaceId !== undefined ? { spaceId: str(body.spaceId) } : {}) }
      : { spaceFolderId: null, spaceId: body.spaceId !== undefined ? str(body.spaceId) : existing.spaceId };
    const move = await resolveFileMove(nodeCtxFromLevel(getUserId(session), orgId, accessLevelFor), existing, req);
    if (!move.ok) {
      return jsonError(move.status === 404 ? (req.spaceFolderId ? "space folder not found" : "space not found") : move.error, move.status);
    }
    if (!move.same) placed = { spaceId: move.spaceId, spaceFolderId: move.spaceFolderId };
  }

  if (!placed) {
    const updated = await prisma.fileEntry.update({ where: { id }, data });
    return jsonSuccess(await withFreshFileUrl(updated));
  }
  // The write half of P3: the folder's Space read again under the share lock
  // a move of that folder waits for, in the same transaction as the update,
  // so the file never keeps a Space its folder has just left.
  const where = placed;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockFolderPlacement(tx, orgId, { spaceId: where.spaceId, folderId: where.spaceFolderId });
      return tx.fileEntry.update({ where: { id }, data: { ...data, spaceId: where.spaceId, spaceFolderId: where.spaceFolderId } });
    });
    return jsonSuccess(await withFreshFileUrl(updated));
  } catch (err) {
    if (err instanceof PlacementConflict) return jsonError(err.message, err.status);
    throw err;
  }
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

  if (!(await canReadFile(existing, getUserId(session), (session.user as { accessLevel?: string }).accessLevel))) return jsonError("not found", 404);
  // Trash takes the file away from everyone who reads it there: Can edit on
  // where it sits (node-rules fileEditDecision), never Can view. A Can view
  // grantee used to Trash another person's file out of a Folder they only read.
  const edit = await checkFileEdit(nodeCtxFromLevel(getUserId(session), orgId, (session.user as { accessLevel?: string }).accessLevel), existing);
  if (!edit.ok) return jsonError(edit.error, edit.status);

  await moveToTrash("file", id, { organizationId: orgId, userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });
  return jsonSuccess({ deleted: true });
}
