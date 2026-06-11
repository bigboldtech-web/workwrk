// GET  /api/boards/[id]/items — list non-archived items
// POST /api/boards/[id]/items — append a new item to the board

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canEditBoard, canReadBoard, getBoardForReader } from "@/lib/board";
import { createBoardItem, listBoardItems, PRIORITY_OPTIONS } from "@/lib/board-items";

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
  // Phase 58 — optional scheduling on create.
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  // Task-system phase 2 — first-class priority + workspace tags on create.
  priority: z.enum(PRIORITY_OPTIONS.map((p) => p.value) as [string, ...string[]]).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  // Phase 72 — pass to create a subtask under the given parent.
  parentItemId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Phase 23b — compose Space + Board gates. Cross-org check is folded
  // into getBoardForReader.
  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditBoard(id, c.userId, c.accessLevel);
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
      startAt: parsed.data.startAt ?? null,
      dueAt: parsed.data.dueAt ?? null,
      priority: parsed.data.priority ?? null,
      tagIds: parsed.data.tagIds,
      parentItemId: parsed.data.parentItemId ?? null,
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
