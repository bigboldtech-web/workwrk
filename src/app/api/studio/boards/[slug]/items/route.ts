// POST   /api/studio/boards/[slug]/items                — create row
// PATCH  /api/studio/boards/[slug]/items                — patch row by id
// DELETE /api/studio/boards/[slug]/items                — delete by id

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = (session.user as { id?: string }).id;
  const organizationId = (session.user as { organizationId?: string }).organizationId;
  if (!userId || !organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId, organizationId };
}

async function resolveBoard(slug: string, organizationId: string) {
  return prisma.studioBoard.findFirst({
    where: { slug, organizationId },
    select: { id: true },
  });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  values: z.record(z.string(), z.unknown()).optional(),
  status: z.string().max(40).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { slug } = await params;
  const board = await resolveBoard(slug, c.organizationId);
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Append to the end — pick next position deterministically.
  const max = await prisma.studioItem.findFirst({
    where: { boardId: board.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const item = await prisma.studioItem.create({
    data: {
      boardId: board.id,
      title: parsed.data.title.trim(),
      values: (parsed.data.values ?? {}) as unknown as Prisma.InputJsonValue,
      status: parsed.data.status,
      position: (max?.position ?? 0) + 1,
      createdById: c.userId,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  status: z.string().max(40).optional().nullable(),
  position: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { slug } = await params;
  const board = await resolveBoard(slug, c.organizationId);
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Verify the row belongs to the board before touching it.
  const existing = await prisma.studioItem.findFirst({
    where: { id: parsed.data.id, boardId: board.id },
    select: { id: true, values: true },
  });
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  // Shallow-merge `values` so a single-column PATCH doesn't wipe the
  // rest of the row's data. Callers can still send a full replacement
  // by including every column.
  const nextValues = parsed.data.values
    ? { ...(existing.values as Record<string, unknown>), ...parsed.data.values }
    : undefined;

  const updated = await prisma.studioItem.update({
    where: { id: existing.id },
    data: {
      title: parsed.data.title,
      status: parsed.data.status === null ? null : parsed.data.status,
      position: parsed.data.position,
      values: nextValues
        ? (nextValues as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { slug } = await params;
  const board = await resolveBoard(slug, c.organizationId);
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await prisma.studioItem.findFirst({
    where: { id, boardId: board.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  await prisma.studioItem.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
