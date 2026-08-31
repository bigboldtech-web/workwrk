// POST /api/boards/[id]/move — move a List/Board to a different Space or
// Folder. Body: { spaceId, folderId? }. Picking a Space makes the board
// space-direct (folderId=null); picking a Folder nests it there (the folder's
// space is used). Requires edit access to the source board AND the target
// space. A WORKSPACE-visibility board inherits the target space's membership.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import { canEditSpace } from "@/lib/space";

async function ctx() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditBoard(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You don't have permission to move this List." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : null;
  const folderId = typeof body?.folderId === "string" ? body.folderId : null;
  if (!spaceId) return NextResponse.json({ error: "Pick a destination Space." }, { status: 400 });

  // Target space must be in this org and editable by the actor.
  const space = await prisma.space.findFirst({
    where: { id: spaceId, organizationId: c.organizationId },
    select: { id: true },
  });
  if (!space) return NextResponse.json({ error: "Destination Space not found." }, { status: 404 });
  if (!(await canEditSpace(spaceId, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You don't have permission to move it there." }, { status: 403 });
  }
  // A target folder must live inside the target space.
  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, spaceId, archivedAt: null },
      select: { id: true },
    });
    if (!folder) return NextResponse.json({ error: "That folder isn't in the chosen Space." }, { status: 400 });
  }

  try {
    await prisma.board.update({ where: { id }, data: { spaceId, folderId } });
    return NextResponse.json({ board: { id, spaceId, folderId } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't move the List" },
      { status: 400 },
    );
  }
}
