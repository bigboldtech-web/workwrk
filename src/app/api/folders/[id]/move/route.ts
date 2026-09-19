// POST /api/folders/[id]/move — put a Folder under another Space or Folder.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Folder "…" row
// 13) and section 2 (`/folders/[id]` Data): "`POST /api/folders/[id]/move`
// (new)". audit spaces-boards Medium #18: the Folder menu had no Move row and
// `MoveTargetDialog` had no folder kind, so a Folder created in the wrong Space
// stayed there for good.
//
// WHY IT IS ITS OWN ROUTE WHEN PATCH ALREADY TAKES `spaceId`. Two reasons that
// are about correctness, not tidiness. First, a move has to be gated on BOTH
// ends: edit on the folder's current Space and edit on the destination Space,
// and PATCH only ever checked the first, so a person could push a folder into a
// Space they cannot write to. Second, the folder's Lists carry their own
// `spaceId` and must travel with it; a bare PATCH left them pointing at the old
// Space, which is how a List ends up in a Space whose tree does not list it.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { isFolderDescendant, getFolderDepth, folderReadable } from "@/lib/folder";

export const dynamic = "force-dynamic";

const MAX_FOLDER_DEPTH = 6;

const bodySchema = z.object({
  spaceId: z.string().min(1).optional(),
  parentFolderId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const { id } = await params;

  const folder = await prisma.folder.findFirst({
    where: { id, organizationId: u.organizationId },
    select: { id: true, name: true, spaceId: true, parentFolderId: true },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The folder's own read gate, not only its Space's: a Space ADMIN denied a
  // PRIVATE folder must not be able to relocate it either.
  if (!(await folderReadable(id, u.id, accessLevel))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await getSpaceForReader(folder.spaceId, u.id, accessLevel))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditSpace(folder.spaceId, u.id, accessLevel))) {
    return NextResponse.json({ error: "You need edit access to move this folder." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { spaceId: rawSpaceId, parentFolderId = null } = parsed.data;

  // The destination Folder settles the destination Space when both are given
  // and disagree: a folder lives where its parent lives.
  let targetSpaceId = rawSpaceId ?? folder.spaceId;
  if (parentFolderId) {
    const parent = await prisma.folder.findFirst({
      where: { id: parentFolderId, organizationId: u.organizationId },
      select: { id: true, spaceId: true },
    });
    if (!parent) return NextResponse.json({ error: "That folder no longer exists" }, { status: 404 });
    if (await isFolderDescendant(folder.id, parent.id)) {
      return NextResponse.json({ error: "A folder can't move inside itself" }, { status: 400 });
    }
    if ((await getFolderDepth(parent.id)) + 1 >= MAX_FOLDER_DEPTH) {
      return NextResponse.json(
        { error: `Folders can only nest ${MAX_FOLDER_DEPTH} levels deep` },
        { status: 400 },
      );
    }
    targetSpaceId = parent.spaceId;
  }

  if (targetSpaceId !== folder.spaceId) {
    const dest = await getSpaceForReader(targetSpaceId, u.id, accessLevel);
    if (!dest) return NextResponse.json({ error: "That Space no longer exists" }, { status: 404 });
    if (!(await canEditSpace(targetSpaceId, u.id, accessLevel))) {
      return NextResponse.json({ error: "You need edit access to that Space." }, { status: 403 });
    }
  }

  // The folder, its descendant folders and every List in the branch move
  // together, or none of them do.
  const branch = await collectBranch(folder.id, u.organizationId);
  // `Whiteboard.folderId` is new (prisma/sql/2026-09-19-canvas-folder.sql).
  // Probe for it OUTSIDE the transaction: a throw inside one aborts the whole
  // move, and a deployment that has not applied the file yet must still be able
  // to move folders.
  let canvasesAnchored = true;
  try {
    await prisma.whiteboard.findFirst({ where: { folderId: folder.id }, select: { id: true } });
  } catch {
    canvasesAnchored = false;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.folder.update({
      where: { id: folder.id },
      data: { spaceId: targetSpaceId, parentFolderId },
    });
    if (targetSpaceId !== folder.spaceId) {
      await tx.folder.updateMany({ where: { id: { in: branch } }, data: { spaceId: targetSpaceId } });
      await tx.board.updateMany({
        where: { folderId: { in: [folder.id, ...branch] } },
        data: { spaceId: targetSpaceId },
      });
      // Canvases anchored to a folder carry their own spaceId. Left behind,
      // a Canvas showed on the Folder page and in the OLD Space's tree at the
      // same time.
      if (canvasesAnchored) {
        await tx.whiteboard.updateMany({
          where: { folderId: { in: [folder.id, ...branch] } },
          data: { spaceId: targetSpaceId },
        });
      }
    }
    return row;
  });

  return NextResponse.json({
    folder: { id: updated.id, name: updated.name, spaceId: updated.spaceId, parentFolderId: updated.parentFolderId },
    movedFolders: branch.length,
  });
}

/** Every folder strictly beneath `rootId`, breadth-first and depth-bounded. */
async function collectBranch(rootId: string, organizationId: string): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootId];
  for (let depth = 0; depth < MAX_FOLDER_DEPTH + 2 && frontier.length > 0; depth += 1) {
    const kids = await prisma.folder.findMany({
      where: { organizationId, parentFolderId: { in: frontier } },
      select: { id: true },
    });
    frontier = kids.map((k) => k.id).filter((kid) => !out.includes(kid) && kid !== rootId);
    out.push(...frontier);
  }
  return out;
}
