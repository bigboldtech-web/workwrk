// POST /api/boards/[id]/duplicate — deep-clone a List/Board (columns,
// statuses, settings, views, and all non-archived items incl. subtasks) into
// the same space/folder as a fresh "(copy)" owned by the actor. History,
// comments, tags and time entries stay with the original. Edit access to the
// source board is required.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditBoard, duplicateBoard, getBoardForReader } from "@/lib/board";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { checkCreate } from "@/lib/access/node-placement";

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
  // `{ includeTasks }` from the Duplicate confirm. Absent means "include",
  // which is what every caller got before the checkbox existed.
  const body = (await req.json().catch(() => null)) as { includeTasks?: unknown } | null;
  const includeTasks = body && typeof body.includeTasks === "boolean" ? body.includeTasks : true;

  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditBoard(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You need Full access to this List to duplicate it." }, { status: 403 });
  }
  // The copy lands beside the original, so it takes the one create rule
  // there (node-rules P1): Can edit or higher on the List's Folder, or on its
  // Space at the root. A List grant alone never plants a new List in a
  // container its holder only passes through or reads.
  if (board.spaceId) {
    const lands = await checkCreate(
      nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel),
      board.folderId ? { kind: "folder", id: board.folderId } : { kind: "space", id: board.spaceId },
      "list",
    );
    if (!lands.ok) return NextResponse.json({ error: lands.error }, { status: lands.status });
  }

  try {
    const clone = await duplicateBoard(id, c.userId, c.organizationId, { includeTasks });
    return NextResponse.json({ board: clone });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't duplicate the List" },
      { status: 400 },
    );
  }
}
