// POST /api/items/[id]/restore — un-archive a task.
//
// spec-task-detail section 2 (States, archived): the Archived banner carries
// one "Restore" for Can edit and above, so a Member who archived their own
// task never has to find the Trash page to undo it (work-tasks #11). The Trash
// restore for HARD-deleted rows is a different door and stays at /api/trash.
//
// Gated at "restore", which is measured against the role BEFORE the archived
// cap: the cap exists to stop edits to an archived task, not to trap it there.

import { NextResponse } from "next/server";
import { getBoardItemRow, restoreBoardItem } from "@/lib/board-items";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { publishItemChanged } from "@/lib/notify-realtime";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "restore");
  if ("error" in gate) return gate.error;

  // Idempotent: restoring a live task answers 200 with the row, so a
  // double-click or a retry is never an error the reader has to interpret.
  const row = await restoreBoardItem(id, c.userId);
  void publishItemChanged({
    itemId: id,
    boardId: gate.item.boardId,
    organizationId: c.organizationId,
    actorId: c.userId,
  });
  return NextResponse.json({ item: (await getBoardItemRow(id, { viewer: c })) ?? row });
}
