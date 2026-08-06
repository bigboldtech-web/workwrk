// PATCH  /api/items/[id]/updates/[updateId] — edit a comment { body }.
//   Author-only: deleting someone's comment is moderation, rewriting
//   their words is not — so PATCH never falls back to space-edit access.
// DELETE /api/items/[id]/updates/[updateId] — soft-delete a comment.
// Allowed if the caller is the comment author OR has edit access on
// the parent Space (org admin / SpaceMember OWNER/ADMIN).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canEditSpace } from "@/lib/space";
import { deleteUpdate, editUpdate, getUpdate } from "@/lib/item-thread";
import { prisma } from "@/lib/prisma";

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

const patchSchema = z.object({
  body: z.string().min(1).max(10_000),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, updateId } = await params;
  const update = await getUpdate(updateId);
  if (!update || update.entityId !== id || update.organizationId !== c.organizationId || update.archivedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (update.authorId !== c.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const edited = await editUpdate(updateId, parsed.data.body);
    return NextResponse.json({ update: edited });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to edit comment" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, updateId } = await params;
  const update = await getUpdate(updateId);
  if (!update || update.entityId !== id || update.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Author can always delete their own comment. Otherwise need space-edit access.
  if (update.authorId !== c.userId) {
    const item = await prisma.item.findUnique({
      where: { id },
      select: { board: { select: { spaceId: true } } },
    });
    if (!item?.board.spaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const canEdit = await canEditSpace(item.board.spaceId, c.userId, c.accessLevel);
    if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteUpdate(updateId);
  return NextResponse.json({ ok: true });
}
