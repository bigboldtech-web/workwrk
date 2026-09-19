// GET /api/items/[id]/subtasks, the task's children, ordered by position.
//
// Why this route exists: `ItemSubtasks` used to load EVERY item on the parent
// List and filter for `parentItemId === item.id` in the browser
// (item-subtasks.tsx). That is one full-List fetch per task opened, and it gets
// worse in a drawer that opens on every row click. This is the same data in one
// indexed query.
//
// Gated on the ITEM ref: an assignee who holds nothing on the List still sees
// the subtasks of the task they were given.

import { NextResponse } from "next/server";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { listBoardItemRows } from "@/lib/board-items";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  const rows = await prisma.item.findMany({
    where: {
      parentItemId: id,
      organizationId: c.organizationId,
      ...(includeArchived ? {} : { archivedAt: null }),
      // A subtask normally lives on the parent's List, and every caller so far
      // creates it that way. "Normally" is not a gate: the parent's role says
      // nothing about a child that has been moved to a List the viewer cannot
      // read, and this route would have returned its title, status, assignees
      // and dates. Scoping to the parent's board is the invariant the route
      // was already relying on, written down where it is enforced.
      boardId: gate.item.boardId,
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  // The enriched row shape every list renderer already speaks, so a subtask
  // row and a List row can never drift apart.
  const subtasks = await listBoardItemRows(rows);
  return NextResponse.json({ subtasks });
}
