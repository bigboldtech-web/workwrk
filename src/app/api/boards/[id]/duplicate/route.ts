// POST /api/boards/[id]/duplicate — deep-clone a List/Board (columns,
// statuses, settings, views, and all non-archived items incl. subtasks) into
// the same space/folder as a fresh "(copy)" owned by the actor. History,
// comments, tags and time entries stay with the original. Edit access to the
// source board is required.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditBoard, duplicateBoard, getBoardForReader } from "@/lib/board";

async function ctx() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditBoard(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You don't have permission to duplicate this List." }, { status: 403 });
  }

  try {
    const clone = await duplicateBoard(id, c.userId, c.organizationId);
    return NextResponse.json({ board: clone });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't duplicate the List" },
      { status: 400 },
    );
  }
}
