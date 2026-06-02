// GET  /api/items/[id]/updates — list comments on a Board Item
// POST /api/items/[id]/updates — add a new comment { body }

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { createUpdate, listUpdates } from "@/lib/item-thread";
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

async function loadItemForRead(itemId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { board: { select: { spaceId: true, organizationId: true } } },
  });
  if (!item || item.organizationId !== c.organizationId || !item.board.spaceId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(item.board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { item, spaceId: item.board.spaceId };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadItemForRead(id, c);
  if ("error" in gate) return gate.error;
  const updates = await listUpdates(id);
  return NextResponse.json({ updates });
}

const createSchema = z.object({
  body: z.string().min(1).max(10_000),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadItemForRead(id, c);
  if ("error" in gate) return gate.error;
  // Posting requires edit access — keeps random readers from spraying
  // comments into Spaces they only have read on.
  const canEdit = await canEditSpace(gate.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const update = await createUpdate({
      organizationId: c.organizationId,
      itemId: id,
      authorId: c.userId,
      body: parsed.data.body,
    });
    return NextResponse.json({ update }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post comment" },
      { status: 400 },
    );
  }
}
