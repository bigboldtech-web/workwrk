// POST /api/folders/[id]/duplicate — copy a shelf and everything on it.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Folder "…" row
// 14) and section 2 Data. audit spaces-boards Medium #18: the Folder menu had
// no Duplicate row and no route behind one.
//
// WHAT TRAVELS. Sub-folders (to the depth limit), the Lists in each of them
// with their statuses, fields and saved views, and — only when the confirm's
// "Include tasks" box was ticked — the tasks. What deliberately does NOT
// travel: members and grants (a copy is not a re-share; the copy inherits the
// Space exactly as a new folder would), comments, activity, time entries and
// attachments, all of which belong to the originals they were written on.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { folderReadable, folderVisibleTo } from "@/lib/folder";
import { duplicateBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

const MAX_FOLDER_DEPTH = 6;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const organizationId = u.organizationId;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { includeTasks?: unknown } | null;
  const includeTasks = body?.includeTasks === true;

  const src = await prisma.folder.findFirst({
    where: { id, organizationId },
    select: {
      id: true, name: true, description: true, icon: true, color: true,
      spaceId: true, parentFolderId: true, visibility: true, position: true, settings: true,
    },
  });
  if (!src) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // READ THE FOLDER, NOT ONLY ITS SPACE. Gated on the Space alone, a Space
  // ADMIN who is denied a PRIVATE folder could copy its Lists (and, with
  // includeTasks, its tasks) into a folder they own and read the lot, while
  // /folders/[id] answered them with the in-shell 404. `folderReadable` is the
  // same gate the page resolves through.
  if (!(await folderReadable(id, u.id, accessLevel))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await getSpaceForReader(src.spaceId, u.id, accessLevel))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditSpace(src.spaceId, u.id, accessLevel))) {
    return NextResponse.json({ error: "You need edit access to duplicate this folder." }, { status: 403 });
  }

  const root = await prisma.folder.create({
    data: {
      organizationId,
      spaceId: src.spaceId,
      parentFolderId: src.parentFolderId,
      name: `${src.name} (copy)`,
      description: src.description,
      icon: src.icon,
      color: src.color,
      ownerId: u.id,
      visibility: src.visibility,
      position: src.position + 1,
      settings: src.settings as object,
    },
    select: { id: true, name: true },
  });

  // Breadth-first, so a sub-folder is always created after its new parent.
  // A copy never widens access: a nested PRIVATE folder or List the actor
  // cannot read is skipped rather than cloned into something they own, and the
  // response says how many were left behind so the toast can too.
  const isOrgAdmin = accessLevel === "SUPER_ADMIN" || accessLevel === "COMPANY_ADMIN";
  let copiedFolders = 0;
  let copiedLists = 0;
  let skipped = 0;
  let failed = 0;
  const queue: Array<{ sourceId: string; targetId: string; depth: number }> = [
    { sourceId: src.id, targetId: root.id, depth: 0 },
  ];

  while (queue.length > 0) {
    const node = queue.shift()!;

    const lists = await prisma.board.findMany({
      where: { organizationId, folderId: node.sourceId, archivedAt: null },
      select: { id: true, visibility: true, ownerId: true },
    });
    for (const list of lists) {
      if (!isOrgAdmin && list.visibility === "PRIVATE" && list.ownerId !== u.id) { skipped += 1; continue; }
      let clone: { id: string } | null = null;
      try {
        clone = await duplicateBoard(list.id, u.id, organizationId, { includeTasks });
      } catch {
        // A List flavour that refuses to duplicate (an entity-bound board)
        // must not abort the whole folder copy; the rest still lands and the
        // count in the response tells the truth about what arrived.
        failed += 1;
        continue;
      }
      // duplicateBoard lands the copy beside the ORIGINAL, so the re-anchor is
      // what puts it on the new shelf. It used to share the catch above: a
      // failure there left a stray "(copy)" List sitting in the real folder
      // with nothing counting it. Its own catch removes the orphan instead.
      try {
        await prisma.board.update({ where: { id: clone.id }, data: { folderId: node.targetId } });
        copiedLists += 1;
      } catch {
        await prisma.board.delete({ where: { id: clone.id } }).catch(() => {});
        failed += 1;
      }
    }

    if (node.depth + 1 >= MAX_FOLDER_DEPTH) continue;
    const kids = await prisma.folder.findMany({
      where: { organizationId, parentFolderId: node.sourceId, archivedAt: null },
      select: { id: true, name: true, description: true, icon: true, color: true, visibility: true, ownerId: true, position: true, settings: true },
    });
    for (const kid of kids) {
      if (!folderVisibleTo(kid, u.id, accessLevel)) { skipped += 1; continue; }
      const created = await prisma.folder.create({
        data: {
          organizationId,
          spaceId: src.spaceId,
          parentFolderId: node.targetId,
          name: kid.name,
          description: kid.description,
          icon: kid.icon,
          color: kid.color,
          ownerId: u.id,
          visibility: kid.visibility,
          position: kid.position,
          settings: kid.settings as object,
        },
        select: { id: true },
      });
      copiedFolders += 1;
      queue.push({ sourceId: kid.id, targetId: created.id, depth: node.depth + 1 });
    }
  }

  return NextResponse.json({
    folder: { id: root.id, name: root.name },
    copiedFolders,
    copiedLists,
    skipped,
    failed,
    includeTasks,
  });
}
