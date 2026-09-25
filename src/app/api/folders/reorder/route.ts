// POST /api/folders/reorder — place `movedId` directly before/after `targetId`
// as a SIBLING (adopting the target's parent + space), computing a fractional
// position between the target and its neighbour so no siblings are renumbered.
// This is what lets a folder land ABOVE/BELOW another folder in the sidebar,
// rather than only nesting inside it.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { positionBetween, updateFolder } from "@/lib/folder";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

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
    prisma.folder.findUnique({ where: { id: movedId }, select: { id: true, organizationId: true, spaceId: true } }),
    prisma.folder.findUnique({ where: { id: targetId }, select: { id: true, organizationId: true, spaceId: true, parentFolderId: true, position: true } }),
  ]);
  if (!moved || moved.organizationId !== u.organizationId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!target || target.organizationId !== u.organizationId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Full access on the moved folder and on where it lands: the target's
  // parent Folder, or the target's Space at its root. One world for both.
  const ctx = nodeCtxFromLevel(u.id, u.organizationId, accessLevel);
  const destRef = target.parentFolderId ? { kind: "folder" as const, id: target.parentFolderId } : { kind: "space" as const, id: target.spaceId };
  const roles = await nodeRoles(ctx, [{ kind: "folder", id: movedId }, destRef]);
  const movedRole = roles.get(`folder:${movedId}`)?.role ?? "none";
  if (movedRole === "none") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!roleAtLeast(movedRole, "FULL") || !roleAtLeast(roles.get(`${destRef.kind}:${destRef.id}`)?.role ?? "none", "FULL")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cycle guard: the moved folder's new parent is the target's parent. If that
  // parent lives inside the moved folder's own subtree, the move would create a
  // loop — reject. Walk up from the new parent looking for movedId.
  const newParentId = target.parentFolderId;
  let cursor: string | null = newParentId;
  let hops = 0;
  while (cursor && hops < 64) {
    if (cursor === movedId) {
      return NextResponse.json({ error: "Can't move a folder into its own subtree" }, { status: 400 });
    }
    const row: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { parentFolderId: true },
    });
    cursor = row?.parentFolderId ?? null;
    hops += 1;
  }

  // Siblings in the destination group (target's parent), ordered, minus the
  // moved folder itself — so we find the true neighbour on the drop side.
  const siblings = await prisma.folder.findMany({
    where: {
      spaceId: target.spaceId,
      parentFolderId: newParentId,
      archivedAt: null,
      id: { not: movedId },
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, position: true },
  });
  const targetIdx = siblings.findIndex((s) => s.id === targetId);
  const before = place === "before" ? siblings[targetIdx - 1]?.position : target.position;
  const after = place === "before" ? target.position : siblings[targetIdx + 1]?.position;
  const newPosition = positionBetween(before, after);

  try {
    const updated = await updateFolder(movedId, {
      spaceId: target.spaceId,
      parentFolderId: newParentId,
      position: newPosition,
    });
    return NextResponse.json({ folder: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to reorder folder" }, { status: 400 });
  }
}
