// POST /api/folders/reorder: place `movedId` directly before or after
// `targetId` as a SIBLING (under the target's parent), at a fractional
// position between the target and its neighbour, so no siblings are
// renumbered. This is what lets a folder land ABOVE or BELOW another folder
// in the sidebar, rather than only nesting inside it.
//
// The placement rule (node-rules P4): under the parent the Folder already has
// this is a reorder, and it needs Full access on the Folder and on that
// parent, as it did. Under any other parent it is a MOVE (P2), so it goes
// through the one move helper (node-placement moveFolder): Full access on the
// Folder and where it is now, Can edit where it goes, the Space taken from
// the new parent, and the whole subtree carried in one transaction. It used
// to write the moved row alone, which left its sub-folders in the old Space
// under a parent in the new one.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { positionBetween } from "@/lib/folder";
import { nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { moveFolder } from "@/lib/access/node-placement";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accessLevel = u.accessLevel ?? "EMPLOYEE";

  const body = await req.json().catch(() => null);
  const movedId = body?.movedId;
  const targetId = body?.targetId;
  const place = body?.place;
  if (typeof movedId !== "string" || typeof targetId !== "string" || (place !== "before" && place !== "after")) {
    return NextResponse.json({ error: "Body must be { movedId, targetId, place: 'before'|'after' }" }, { status: 400 });
  }
  if (movedId === targetId) return NextResponse.json({ error: "Can't reorder a folder relative to itself" }, { status: 400 });

  const [moved, target] = await Promise.all([
    prisma.folder.findFirst({ where: { id: movedId, organizationId: u.organizationId }, select: { id: true } }),
    prisma.folder.findFirst({ where: { id: targetId, organizationId: u.organizationId, archivedAt: null }, select: { id: true, spaceId: true, parentFolderId: true, position: true } }),
  ]);
  if (!moved || !target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = nodeCtxFromLevel(u.id, u.organizationId, accessLevel);
  if ((await nodeRole(ctx, { kind: "folder", id: movedId })).role === "none") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((await nodeRole(ctx, { kind: "folder", id: targetId })).role === "none") return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Siblings in the destination group (the target's parent), ordered, minus
  // the moved folder itself, so the true neighbour on the drop side is found.
  const siblings = await prisma.folder.findMany({
    where: { spaceId: target.spaceId, parentFolderId: target.parentFolderId, archivedAt: null, id: { not: movedId } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, position: true },
  });
  const targetIdx = siblings.findIndex((s) => s.id === targetId);
  const before = place === "before" ? siblings[targetIdx - 1]?.position : target.position;
  const after = place === "before" ? target.position : siblings[targetIdx + 1]?.position;
  const position = positionBetween(before, after);

  // The new parent is the target's: its parent Folder (whose Space settles
  // the Space), or the root of the target's Space.
  const result = await moveFolder(ctx, movedId, target.parentFolderId
    ? { parentFolderId: target.parentFolderId, position }
    : { spaceId: target.spaceId, parentFolderId: null, position });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ folder: result.folder, movedFolders: result.movedFolders });
}
