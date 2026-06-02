// PATCH  /api/boards/[id]/views/[viewId] — rename / re-order / re-config
// DELETE /api/boards/[id]/views/[viewId] — remove (cannot delete the
//        last view; UI should disable that case)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
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

async function loadGate(boardId: string, viewId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const view = await prisma.view.findUnique({
    where: { id: viewId },
    include: { board: { select: { spaceId: true, organizationId: true, id: true } } },
  });
  if (!view || view.boardId !== boardId || view.board.organizationId !== c.organizationId || !view.board.spaceId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(view.board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const canEdit = await canEditSpace(view.board.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { view };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  displayOrder: z.number().int().min(0).max(1_000_000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; viewId: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, viewId } = await params;
  const gate = await loadGate(id, viewId, c);
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // Promoting a view to default? Demote the previous default in the same tx.
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.config !== undefined) data.config = parsed.data.config as object;
  if (parsed.data.isDefault) {
    await prisma.$transaction(async (tx) => {
      await tx.view.updateMany({
        where: { boardId: id, isDefault: true, NOT: { id: viewId } },
        data: { isDefault: false },
      });
      await tx.view.update({ where: { id: viewId }, data });
    });
  } else {
    await prisma.view.update({ where: { id: viewId }, data });
  }
  const updated = await prisma.view.findUnique({ where: { id: viewId } });
  return NextResponse.json({ view: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; viewId: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, viewId } = await params;
  const gate = await loadGate(id, viewId, c);
  if ("error" in gate) return gate.error;
  const total = await prisma.view.count({ where: { boardId: id } });
  if (total <= 1) {
    return NextResponse.json({ error: "Cannot delete the last view on a board" }, { status: 400 });
  }
  await prisma.view.delete({ where: { id: viewId } });
  return NextResponse.json({ ok: true });
}
