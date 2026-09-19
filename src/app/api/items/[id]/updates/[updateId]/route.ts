// PATCH  /api/items/[id]/updates/[updateId] — edit a comment { body }.
//   Author-only: deleting someone's comment is moderation, rewriting
//   their words is not, so PATCH never falls back to a wider role.
// DELETE /api/items/[id]/updates/[updateId] — soft-delete a comment.
//   The author always may. Anyone else needs FULL on the task (access
//   section 1: "delete of any comment on the task" is Full access only;
//   Can edit explicitly does NOT include it).
//
// Both verbs now gate on the ITEM ref rather than resolving a Space, so a
// personal-list task's comments can be edited and deleted like any other
// (before Phase 2 the DELETE branch 404'd on `!item.board.spaceId`).

import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteUpdate, editUpdate, getUpdate } from "@/lib/item-thread";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { publishItemChanged } from "@/lib/notify-realtime";

const patchSchema = z.object({
  body: z.string().min(1).max(10_000),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, updateId } = await params;
  // Reading the task is the floor; authorship is the real gate below.
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  const update = await getUpdate(updateId);
  if (!update || update.entityId !== id || update.organizationId !== c.organizationId || update.archivedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (update.authorId !== c.userId) {
    return NextResponse.json(
      { error: "no_access", reason: "not_comment_author" },
      { status: 403 },
    );
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const edited = await editUpdate(updateId, parsed.data.body);
    void publishItemChanged({
      itemId: id,
      boardId: gate.item.boardId,
      organizationId: c.organizationId,
      actorId: c.userId,
    });
    return NextResponse.json({ update: edited });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to edit comment" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, updateId } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  const update = await getUpdate(updateId);
  if (!update || update.entityId !== id || update.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // The author can always delete their own comment. Anyone else needs Full
  // access on the task: Can edit is deliberately not enough to delete another
  // person's words.
  if (update.authorId !== c.userId && gate.decision.role !== "FULL") {
    return NextResponse.json(
      { error: "no_access", reason: "moderation_needs_full_access" },
      { status: 403 },
    );
  }
  await deleteUpdate(updateId);
  void publishItemChanged({
    itemId: id,
    boardId: gate.item.boardId,
    organizationId: c.organizationId,
    actorId: c.userId,
  });
  return NextResponse.json({ ok: true });
}
