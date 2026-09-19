// POST /api/spaces/[id]/duplicate — copy a room, not just its nameplate.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Space "…" row
// 16): "copies Folders, Lists, statuses, fields and views (today it copies name
// and icon only, audit Medium #22). Calls `POST /api/spaces/[id]/duplicate
// { includeTasks }` (new; replaces the client-side copy)".
//
// WHAT WAS BROKEN. `space-more-menu.tsx` implemented Duplicate in the browser:
// it read the row it already had and POSTed `/api/spaces` with `{ name, icon }`.
// The result was an empty Space with a familiar name, and nothing told the
// person that the fifteen Lists they meant to copy had not come.
//
// WHAT TRAVELS: the Space's own settings (statuses palette, features), its
// Folders to the depth limit, and every List in them with statuses, fields and
// saved views; tasks only when the confirm's "Include tasks" box was ticked.
// WHAT DOES NOT: members and grants (a copy is not a re-share; the creator owns
// it and shares it deliberately), comments, activity and time entries.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSpace, getSpaceForReader, uniqueSpaceSlug } from "@/lib/space";
import { duplicateBoard } from "@/lib/board";
import { folderVisibleTo } from "@/lib/folder";

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

  const src = await prisma.space.findFirst({
    where: { id, organizationId },
    select: {
      id: true, name: true, description: true, icon: true, color: true,
      visibility: true, settings: true, parentSpaceId: true, displayOrder: true,
    },
  });
  if (!src) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getSpaceForReader(id, u.id, accessLevel))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditSpace(id, u.id, accessLevel))) {
    return NextResponse.json({ error: "You need edit access to duplicate this Space." }, { status: 403 });
  }

  const name = `${src.name} (copy)`;
  const slug = await uniqueSpaceSlug(organizationId, name);

  const space = await prisma.space.create({
    data: {
      organizationId,
      slug,
      name,
      description: src.description,
      icon: src.icon,
      color: src.color,
      // PRIVATE stays PRIVATE: a copy never widens who can see something.
      visibility: src.visibility,
      ownerId: u.id,
      parentSpaceId: src.parentSpaceId,
      displayOrder: src.displayOrder + 1,
      settings: src.settings as object,
    },
    select: { id: true, slug: true, name: true },
  });

  // The creator is a member of their own copy, exactly as `createSpace` does,
  // or they would make a Space they cannot open.
  await prisma.spaceMember.create({
    data: { spaceId: space.id, userId: u.id, role: "OWNER" },
  }).catch(() => { /* an admin may already resolve as a member; never fatal */ });

  let copiedFolders = 0;
  let copiedLists = 0;

  // Root-level Lists first, then the folder tree breadth-first. A copy never
  // widens access: a PRIVATE folder or List the actor cannot read is skipped
  // rather than cloned into a Space they own.
  const isOrgAdmin = accessLevel === "SUPER_ADMIN" || accessLevel === "COMPANY_ADMIN";
  const tally = { skipped: 0, failed: 0 };
  copiedLists += await copyListsInto(
    { organizationId, sourceSpaceId: src.id, sourceFolderId: null },
    { spaceId: space.id, folderId: null },
    u.id,
    includeTasks,
    isOrgAdmin,
    tally,
  );

  const queue: Array<{ sourceId: string | null; targetId: string | null; depth: number }> = [
    { sourceId: null, targetId: null, depth: 0 },
  ];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.depth >= MAX_FOLDER_DEPTH) continue;
    const kids = await prisma.folder.findMany({
      where: { organizationId, spaceId: src.id, parentFolderId: node.sourceId, archivedAt: null },
      select: { id: true, name: true, description: true, icon: true, color: true, visibility: true, ownerId: true, position: true, settings: true },
    });
    for (const kid of kids) {
      if (!folderVisibleTo(kid, u.id, accessLevel)) { tally.skipped += 1; continue; }
      const created = await prisma.folder.create({
        data: {
          organizationId,
          spaceId: space.id,
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
      copiedLists += await copyListsInto(
        { organizationId, sourceSpaceId: src.id, sourceFolderId: kid.id },
        { spaceId: space.id, folderId: created.id },
        u.id,
        includeTasks,
        isOrgAdmin,
        tally,
      );
      queue.push({ sourceId: kid.id, targetId: created.id, depth: node.depth + 1 });
    }
  }

  return NextResponse.json({
    space,
    copiedFolders,
    copiedLists,
    skipped: tally.skipped,
    failed: tally.failed,
    includeTasks,
  });
}

async function copyListsInto(
  from: { organizationId: string; sourceSpaceId: string; sourceFolderId: string | null },
  to: { spaceId: string; folderId: string | null },
  actorId: string,
  includeTasks: boolean,
  isOrgAdmin: boolean,
  tally: { skipped: number; failed: number },
): Promise<number> {
  const lists = await prisma.board.findMany({
    where: {
      organizationId: from.organizationId,
      spaceId: from.sourceSpaceId,
      folderId: from.sourceFolderId,
      archivedAt: null,
    },
    select: { id: true, visibility: true, ownerId: true },
  });
  let copied = 0;
  for (const list of lists) {
    if (!isOrgAdmin && list.visibility === "PRIVATE" && list.ownerId !== actorId) { tally.skipped += 1; continue; }
    let clone: { id: string } | null = null;
    try {
      clone = await duplicateBoard(list.id, actorId, from.organizationId, { includeTasks });
    } catch {
      // A List flavour that refuses to duplicate must not abort the Space
      // copy; the response count says what actually arrived.
      tally.failed += 1;
      continue;
    }
    // duplicateBoard lands the clone beside the ORIGINAL. When only this
    // re-anchor fails the copy is sitting in the user's real Space with
    // nothing counting it, so the orphan is removed rather than left behind.
    try {
      await prisma.board.update({
        where: { id: clone.id },
        data: { spaceId: to.spaceId, folderId: to.folderId },
      });
      copied += 1;
    } catch {
      await prisma.board.delete({ where: { id: clone.id } }).catch(() => {});
      tally.failed += 1;
    }
  }
  return copied;
}
