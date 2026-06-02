// PATCH  /api/boards/[id]/fields/[key] — rename / re-options / reposition
// DELETE /api/boards/[id]/fields/[key] — remove a field (resequences)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { removeBoardField, updateBoardField } from "@/lib/board-fields";
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

async function gate(boardId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, organizationId: true },
  });
  if (!board || board.organizationId !== c.organizationId || !board.spaceId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const canEdit = await canEditSpace(board.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true as const };
}

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, key } = await params;
  const g = await gate(id, c);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const field = await updateBoardField(id, key, {
      label: parsed.data.label,
      options: parsed.data.options as never,
      position: parsed.data.position,
    });
    return NextResponse.json({ field });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update field" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id, key } = await params;
  const g = await gate(id, c);
  if ("error" in g) return g.error;
  try {
    await removeBoardField(id, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove field" },
      { status: 400 },
    );
  }
}
