// POST   /api/items/[id]/updates/[updateId]/reactions { emoji } — react
// DELETE /api/items/[id]/updates/[updateId]/reactions { emoji } — un-react
//
// Reacting is commenting-weight, so it gates at "comment" on the ITEM ref, the
// same door the composer uses. Both verbs answer with the comment's whole
// reaction set, so the client renders truth rather than an optimistic guess,
// and both are idempotent (the unique key does the work): a double-click
// cannot double-count and un-reacting twice is not an error.

import { NextResponse } from "next/server";
import { z } from "zod";
import { addReaction, getUpdate, removeReaction } from "@/lib/item-thread";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { publishItemChanged } from "@/lib/notify-realtime";

const bodySchema = z.object({
  // One or two code points covers every emoji including the joined ones; a
  // cap is here so the column can never be used as free text storage.
  emoji: z.string().min(1).max(16),
});

async function resolve(
  id: string,
  updateId: string,
): Promise<{ error: NextResponse } | { ok: true }> {
  const update = await getUpdate(updateId);
  if (!update || update.entityType !== "BOARD_ITEM" || update.entityId !== id || update.archivedAt) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, updateId } = await params;
  const gate = await gateItem(id, c, "comment");
  if ("error" in gate) return gate.error;
  const found = await resolve(id, updateId);
  if ("error" in found) return found.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const reactions = await addReaction({
    organizationId: c.organizationId,
    updateId,
    userId: c.userId,
    emoji: parsed.data.emoji,
  });
  void publishItemChanged({
    itemId: id,
    boardId: gate.item.boardId,
    organizationId: c.organizationId,
    actorId: c.userId,
  });
  return NextResponse.json({ reactions });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, updateId } = await params;
  const gate = await gateItem(id, c, "comment");
  if ("error" in gate) return gate.error;
  const found = await resolve(id, updateId);
  if ("error" in found) return found.error;

  // The emoji arrives in the body on DELETE too (a query string would put an
  // emoji in the URL and in every access log). A DELETE with no body clears
  // nothing rather than clearing everything.
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const reactions = await removeReaction({ updateId, userId: c.userId, emoji: parsed.data.emoji });
  void publishItemChanged({
    itemId: id,
    boardId: gate.item.boardId,
    organizationId: c.organizationId,
    actorId: c.userId,
  });
  return NextResponse.json({ reactions });
}
