// POST /api/boards/[id]/move: move a List to a different Space or Folder.
// Body: { spaceId, folderId? }. Picking a Space makes the List sit at the
// Space's root (folderId null); picking a Folder nests it there, and the
// Folder's Space is the List's Space.
//
// The placement rule (node-rules P1 to P7) through its one move helper
// (node-placement moveList): Full access on the List and on the place it
// leaves (and on its Space when it leaves the Space), Can edit where it goes,
// and the Space derived from the Folder (a Space that disagrees is a 400). A
// refusal is a 403 with one sentence naming what is needed. The Move dialog
// lists only the destinations this accepts (GET /api/move/destinations).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { boardRoleOf } from "@/lib/board";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { moveList } from "@/lib/access/node-placement";

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

  const { board, role } = await boardRoleOf(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId || role === "none") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const spaceId = typeof body?.spaceId === "string" && body.spaceId ? body.spaceId : null;
  const folderId = typeof body?.folderId === "string" && body.folderId ? body.folderId : null;
  if (!spaceId && !folderId) return NextResponse.json({ error: "Pick a destination Space." }, { status: 400 });

  const result = await moveList(nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel), id, { spaceId, folderId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ board: result.list });
}
