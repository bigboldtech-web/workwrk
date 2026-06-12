// PATCH  /api/items/[id] — update title / status / owner / metadata
// DELETE /api/items/[id] — archive (soft); ?hard=1 hard-deletes

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveBoardItem, deleteBoardItem, updateBoardItem, PRIORITY_OPTIONS } from "@/lib/board-items";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import { parseBoardSchema } from "@/lib/field-catalog";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { prisma } from "@/lib/prisma";

async function loadAndGateRead(itemId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { board: { select: { id: true, slug: true, name: true, spaceId: true, organizationId: true, schema: true, statuses: true } } },
  });
  if (!item || item.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  // Phase 23b — gate via parent Board (which composes Space + Board.visibility).
  const board = await getBoardForReader(item.boardId, c.userId, c.accessLevel);
  if (!board) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const canEdit = await canEditBoard(item.boardId, c.userId, c.accessLevel);
  return { item, canEdit };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGateRead(id, c);
  if ("error" in gate) return gate.error;
  const [owner, tagAssignments] = await Promise.all([
    gate.item.ownerId
      ? prisma.user.findUnique({
          where: { id: gate.item.ownerId },
          select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
        })
      : Promise.resolve(null),
    prisma.tagAssignment.findMany({
      where: { entityType: "BOARD_ITEM", entityId: gate.item.id },
      include: { tag: { select: { id: true, name: true, color: true, archived: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return NextResponse.json({
    item: {
      id: gate.item.id,
      boardId: gate.item.boardId,
      spaceId: gate.item.board.spaceId,
      title: gate.item.title,
      status: gate.item.status,
      ownerId: gate.item.ownerId,
      groupKey: gate.item.groupKey,
      position: gate.item.position,
      metadata: gate.item.metadata,
      startAt: gate.item.startAt,
      dueAt: gate.item.dueAt,
      priority: gate.item.priority,
      itemTypeId: gate.item.itemTypeId,
      parentItemId: gate.item.parentItemId,
      tags: tagAssignments.filter((a) => !a.tag.archived).map((a) => ({ id: a.tag.id, name: a.tag.name, color: a.tag.color })),
      archivedAt: gate.item.archivedAt,
      createdAt: gate.item.createdAt,
      updatedAt: gate.item.updatedAt,
      owner,
    },
    // Board context so a standalone detail page (no board host) can
    // render custom fields + the right status palette + breadcrumb.
    board: {
      id: gate.item.board.id,
      slug: gate.item.board.slug,
      name: gate.item.board.name,
      fields: parseBoardSchema(gate.item.board.schema).fields,
      statuses: getBoardStatuses(gate.item.board),
    },
    canEdit: gate.canEdit,
  });
}

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

async function loadAndGate(itemId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { board: { select: { id: true, spaceId: true, organizationId: true } } },
  });
  if (!item || item.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const board = await getBoardForReader(item.boardId, c.userId, c.accessLevel);
  if (!board) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const canEdit = await canEditBoard(item.boardId, c.userId, c.accessLevel);
  if (!canEdit) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { item };
}

const patchSchema = z.object({
  title: z.string().min(1).max(280).optional(),
  status: z.string().max(40).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  groupKey: z.string().max(80).nullable().optional(),
  position: z.number().finite().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Phase 58 — first-class date columns; ISO strings or null.
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  // Task-system phase 2 — first-class priority + workspace tags.
  priority: z.enum(PRIORITY_OPTIONS.map((p) => p.value) as [string, ...string[]]).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  // Task Types — re-skin this row as an ItemType (null = default).
  itemTypeId: z.string().min(1).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGate(id, c);
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const updated = await updateBoardItem(id, parsed.data, c.userId);
    return NextResponse.json({ item: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update item" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGate(id, c);
  if ("error" in gate) return gate.error;
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";
  if (hard) {
    await deleteBoardItem(id);
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveBoardItem(id, c.userId);
  return NextResponse.json({ item: archived });
}
