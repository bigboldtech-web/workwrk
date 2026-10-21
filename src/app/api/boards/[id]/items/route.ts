// GET  /api/boards/[id]/items — list non-archived items
//      ?links=1 (Phase 5b): the List's own rows UNION the rows linked into it
// POST /api/boards/[id]/items — append a new item to the board
//
// Phase 5b. Every row is projected for the viewer (src/lib/board-items-view.ts):
// the reserved "$" keys are never sent, a connect value is reduced to the
// tasks the viewer can read, and connect and mirror columns come back as
// `connections` and `mirrors`. WITHOUT ?links=1 the rows are exactly today's
// home rows otherwise, so no existing client changes; the canvas asks for the
// union only once LIST_LINK_CANVAS_LIVE flips (src/lib/list-links.ts).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canReadBoard } from "@/lib/board";
import { listBoardItems } from "@/lib/board-items";
import { createItemAs } from "@/lib/items/item-create";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const canRead = await canReadBoard(id, c.userId, c.accessLevel);
  if (!canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const items = await listBoardItems(id, {
    includeArchived,
    view: { viewer: c, contextBoardId: id },
    includeLinked: url.searchParams.get("links") === "1",
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // The body is createItemAs (src/lib/items/item-create.ts), shared with the
  // MCP server's create_task, which runs it as the person who connected the app.
  return createItemAs(c, id, await req.json().catch(() => null));
}
