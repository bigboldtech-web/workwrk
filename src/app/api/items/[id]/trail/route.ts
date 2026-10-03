// GET /api/items/[id]/trail: the task's connection trail (src/lib/task-trail.ts).
//
// Read only. Gated on the task first (gateItem "view", the one item gate),
// then every entry by its own read rule, so the trail names only what this
// viewer may open. A reader who reached the task only through a List it is
// linked into gets no trail: the task's connections belong to its home.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { loadTaskTrail } from "@/lib/task-trail-server";
import { viewerFromSession } from "@/lib/access/viewer";
import { nodeCtxFromSession } from "@/lib/access/node-access";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;
  const noStore = { headers: { "Cache-Control": "no-store" } };
  if (gate.decision.via === "linked-list") return NextResponse.json({ entries: [], ownerNotice: null }, noStore);
  try {
    const [session, viewer, nodeCtx] = await Promise.all([getServerSession(authOptions), viewerFromSession(), nodeCtxFromSession()]);
    if (!session || !viewer || !nodeCtx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const trail = await loadTaskTrail(
      { session: session as Parameters<typeof loadTaskTrail>[0]["session"], viewer, nodeCtx, fileViewer: c },
      { id: gate.item.id, organizationId: gate.item.organizationId, boardId: gate.item.boardId, metadata: gate.item.metadata, assigneeIds: gate.item.assigneeIds ?? [], ownerId: gate.item.ownerId ?? null, board: { spaceId: gate.item.board.spaceId } },
    );
    return NextResponse.json(trail, noStore);
  } catch (err) {
    console.error("[items/trail]", err);
    return NextResponse.json({ error: "Couldn't load the connections." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
