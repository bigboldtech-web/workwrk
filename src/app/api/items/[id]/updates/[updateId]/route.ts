// DELETE /api/items/[id]/updates/[updateId] — soft-delete a comment.
// Allowed if the caller is the comment author OR has edit access on
// the parent Space (org admin / SpaceMember OWNER/ADMIN).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditSpace } from "@/lib/space";
import { deleteUpdate, getUpdate } from "@/lib/item-thread";
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
