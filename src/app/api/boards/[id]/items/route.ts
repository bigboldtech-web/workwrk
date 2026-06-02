// GET  /api/boards/[id]/items — list non-archived items
// POST /api/boards/[id]/items — append a new item to the board

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canReadBoard } from "@/lib/board";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { createBoardItem, listBoardItems } from "@/lib/board-items";
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const canRead = await canReadBoard(id, c.userId, c.accessLevel);
  if (!canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const items = await listBoardItems(id, { includeArchived });
  return NextResponse.json({ items });
}

const createSchema = z.object({
  title: z.string().min(1).max(280),
  status: z.string().max(40).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  groupKey: z.string().max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const board = await prisma.board.findUnique({
    where: { id },
    select: { spaceId: true, organizationId: true },
  });
  if (!board || board.organizationId !== c.organizationId || !board.spaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const space = await getSpaceForReader(board.spaceId, c.userId, c.accessLevel);
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const canEdit = await canEditSpace(board.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const item = await createBoardItem({
      organizationId: c.organizationId,
      boardId: id,
      title: parsed.data.title,
      status: parsed.data.status,
      ownerId: parsed.data.ownerId ?? undefined,
      groupKey: parsed.data.groupKey,
      metadata: parsed.data.metadata,
      actorId: c.userId,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create item" },
      { status: 400 },
    );
  }
}
