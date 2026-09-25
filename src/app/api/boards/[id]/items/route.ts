// GET  /api/boards/[id]/items — list non-archived items
// POST /api/boards/[id]/items — append a new item to the board

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canContributeBoard, canReadBoard, getBoardForReader } from "@/lib/board";
import { createBoardItem, getBoardItemRow, listBoardItems, PRIORITY_OPTIONS } from "@/lib/board-items";
import { notifyItemAssigned } from "@/lib/notify-item";
import { unknownUserIds } from "@/lib/assignable";

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
  // 60, the limit the List's statuses schema allows (boards/[id]/route.ts).
  // At 40 a status the editor can mint (up to 50 characters plus a suffix)
  // could be declared and never set, and every create into it answered 400.
  status: z.string().max(60).optional(),
  // Shape-checked here, existence-checked against the org below. These columns
  // carry no foreign key, so nothing else refuses a typo or a 5000-character
  // string. See the same pair in PATCH /api/items/[id].
  ownerId: z.string().trim().min(1).max(64).nullable().optional(),
  assigneeIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  groupKey: z.string().max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Phase 58 — optional scheduling on create.
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  // Task-system phase 2 — first-class priority + workspace tags on create.
  priority: z.enum(PRIORITY_OPTIONS.map((p) => p.value) as [string, ...string[]]).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  // Task Types — the ItemType to re-skin this row as (null = default).
  itemTypeId: z.string().min(1).nullable().optional(),
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
  // Creating a task is CONTENT, not board management — a Space/Board MEMBER
  // may do it (canContributeBoard), only GUESTs are blocked.
  const canWrite = await canContributeBoard(id, c.userId, c.accessLevel);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // A task may only be created FOR a real, live person in this org: the
  // assignee columns have no foreign key, so an unchecked id lands in the row
  // and, once owner-only patches started merging, never leaves it again.
  const proposedUserIds = [
    ...(parsed.data.assigneeIds ?? []),
    ...(typeof parsed.data.ownerId === "string" ? [parsed.data.ownerId] : []),
  ];
  if (proposedUserIds.length > 0) {
    const unknown = await unknownUserIds(proposedUserIds, c.organizationId);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "no_access", reason: "unknown_assignee", requestAccess: false },
        { status: 400 },
      );
    }
  }
  try {
    const item = await createBoardItem({
      organizationId: c.organizationId,
      boardId: id,
      title: parsed.data.title,
      status: parsed.data.status,
      ownerId: parsed.data.ownerId ?? undefined,
      assigneeIds: parsed.data.assigneeIds,
      groupKey: parsed.data.groupKey,
      metadata: parsed.data.metadata,
      startAt: parsed.data.startAt ?? null,
      dueAt: parsed.data.dueAt ?? null,
      priority: parsed.data.priority ?? null,
      itemTypeId: parsed.data.itemTypeId ?? null,
      tagIds: parsed.data.tagIds,
      parentItemId: parsed.data.parentItemId ?? null,
      actorId: c.userId,
    });
    // Inbox notification — a task created FOR someone else lands in their
    // bell. Routed through src/lib/notify-item.ts so the recipient's
    // /settings/notifications toggle is the only switch that matters; the
    // helper no-ops when the owner is the actor or the item is unassigned.
    // Never throws (best effort) — the item is already saved.
    await notifyItemAssigned({
      organizationId: c.organizationId,
      item: { id: item.id, title: item.title, dueAt: item.dueAt ?? null },
      ownerId: parsed.data.ownerId ?? null,
      actorId: c.userId,
    });
    // Respond with the FULL enriched row (counts/links/time/creator — the
    // exact listBoardItems shape): clients append this straight into their
    // cached list, and a lean row there diverges from refetched rows.
    return NextResponse.json({ item: (await getBoardItemRow(item.id)) ?? item }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create item" },
      { status: 400 },
    );
  }
}
