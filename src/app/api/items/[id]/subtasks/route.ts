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
import { decideContext } from "@/lib/list-links";
import { linkedListsOf, listReader } from "@/lib/list-links-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const all = await prisma.item.findMany({
    where: {
      parentItemId: id,
      organizationId: c.organizationId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    // Position, then id: the order a subtask renumber keeps
    // (PUT /api/boards/[id]/order with parentId), so tied ones never swap.
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  // A subtask normally lives on the parent's List. One moved to ANOTHER List
  // stays this task's subtask (pen test 2026-11-28, V-40: it vanished from
  // here while still tied to the parent). The parent's role says nothing about
  // that List, so such a child is listed only to a viewer whose own gate opens
  // it (the gate that opens it anywhere else), never on the parent's word.
  const rows: typeof all = [];
  for (const row of all) {
    if (row.boardId === gate.item.boardId) rows.push(row);
    else if (!("error" in (await gateItem(row.id, c, "view")))) rows.push(row);
  }
  // Phase 5b. A task's children are part of its share (a subtask belongs to
  // its parent), so a reader who can open a linked parent may list them. What
  // changes is the projection: in a List the parent is linked into, each child
  // shows THAT List's values. The List is the one that let a linked-only reader
  // in, or a valid ?list= (any other value is ignored); else the home.
  let contextBoardId: string | null = gate.decision.via === "linked-list" && gate.viaLinkedList ? gate.viaLinkedList.id : null;
  const { rootId, links } = await linkedListsOf(gate.item);
  const asked = url.searchParams.get("list");
  if (asked && asked !== gate.item.boardId) {
    const readable = links.some((l) => l.boardId === asked) ? !!(await listReader(c).row(asked)) : false;
    const kind = decideContext({ requested: asked, homeBoardId: gate.item.boardId, linkedBoardIds: links.map((l) => l.boardId), requestedReadable: readable });
    if (kind === "linked") contextBoardId = asked;
  }
  // The enriched row shape every list renderer already speaks, so a subtask
  // row and a List row can never drift apart.
  const subtasks = await listBoardItemRows(rows, { viewer: c, contextBoardId, rootId });
  return NextResponse.json({ subtasks });
}
