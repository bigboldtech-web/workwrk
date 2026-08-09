// PATCH  /api/items/[id] — update title / status / owner / metadata
// DELETE /api/items/[id] — archive (soft); ?hard=1 hard-deletes

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveBoardItem, updateBoardItem, PRIORITY_OPTIONS } from "@/lib/board-items";
import { moveToTrash } from "@/lib/trash";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import { parseBoardSchema } from "@/lib/field-catalog";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { nextOccurrenceAfter, occurrenceKey, parseRecurrence } from "@/lib/recurrence";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { prisma } from "@/lib/prisma";
import { dispatchEvent } from "@/services/webhookDispatcher";

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
      recurRule: gate.item.recurRule,
      recurNextAt: gate.item.recurNextAt,
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
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string; name?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId, userName: u.name ?? null };
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

// Recurrence ("Set Recurring") config. After a patch sets/clears recurRule (or
// moves the due date, which re-anchors the series), compute the anchor's
// recurNextAt. SCHEDULE-triggered series get a spawn time (first occurrence
// strictly after the anchor's own due date AND after now, so the anchor covers
// the current cycle and the first spawned copy is the next one) plus a seeded
// metadata.lastSpawnedKey so the cron only spawns cycles after the anchor's
// own. ON_COMPLETE series never use the cron, so recurNextAt stays null —
// completing the task advances them. Clearing the rule clears recurNextAt and
// the spawn bookkeeping too. Returns the re-updated row or null.
async function applyRecurrenceSchedule(itemId: string, rawRule: unknown, actorId: string) {
  const rule = parseRecurrence(rawRule);
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { dueAt: true, startAt: true, metadata: true },
  });
  if (!item) return null;
  const md = item.metadata && typeof item.metadata === "object"
    ? { ...(item.metadata as Record<string, unknown>) }
    : {};
  delete md.lastSpawnedKey;
  delete md.skippedOccurrences;
  let recurNextAt: Date | null = null;
  if (rule && (rule.trigger ?? "SCHEDULE") === "SCHEDULE") {
    const base = new Date(item.dueAt ?? item.startAt ?? new Date());
    const threshold = new Date(Math.max(Date.now(), base.getTime()));
    recurNextAt = nextOccurrenceAfter(threshold, rule, base);
    md.lastSpawnedKey = occurrenceKey(base);
  }
  return updateBoardItem(itemId, { recurNextAt, metadata: md }, actorId);
}

const recurRuleSchema = z.object({
  freq: z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]),
  interval: z.number().int().min(1).max(365),
  // ClickUp "Set Recurring" options — all optional; parseRecurrence defaults them.
  trigger: z.enum(["SCHEDULE", "ON_COMPLETE"]).optional(),
  createNew: z.boolean().optional(),
  forever: z.boolean().optional(),
  count: z.number().int().min(0).max(9999).nullable().optional(),
  until: z.string().datetime().nullable().optional(),
  resetStatus: z.string().max(40).nullable().optional(),
  syncDue: z.boolean().optional(),
  // Calendar-aware fields — weekly weekday set (ISO 1=Mon..7=Sun), monthly
  // day-of-month (29-31 clamp to month end), yearly month/day.
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional(),
  monthDay: z.number().int().min(1).max(31).nullable().optional(),
  yearMonth: z.number().int().min(1).max(12).nullable().optional(),
  yearDay: z.number().int().min(1).max(31).nullable().optional(),
});

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
  // Recurring tasks — the series rule, or null to stop repeating. recurNextAt
  // is derived server-side, never accepted from the client.
  recurRule: recurRuleSchema.nullable().optional(),
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
    // Event pipes ("lay pipes as you go") — flat payloads: ids + the
    // fields automation conditions test. Fire-and-forget, never throws.
    if (parsed.data.status !== undefined && gate.item.status !== updated.status) {
      dispatchEvent({
        organizationId: c.organizationId,
        event: "task.status_changed",
        payload: {
          id: updated.id,
          boardId: gate.item.boardId,
          title: updated.title,
          status: updated.status,
          previousStatus: gate.item.status,
          ownerId: updated.ownerId,
          assigneeId: updated.ownerId,
          priority: updated.priority,
          dueAt: updated.dueAt,
          actorId: c.userId,
          updatedAt: updated.updatedAt,
        },
      }).catch(() => {});
    }
    if (parsed.data.ownerId !== undefined && gate.item.ownerId !== updated.ownerId) {
      dispatchEvent({
        organizationId: c.organizationId,
        event: "task.assignee_changed",
        payload: {
          id: updated.id,
          boardId: gate.item.boardId,
          title: updated.title,
          status: updated.status,
          ownerId: updated.ownerId,
          assigneeId: updated.ownerId,
          previousAssigneeId: gate.item.ownerId,
          priority: updated.priority,
          dueAt: updated.dueAt,
          actorId: c.userId,
          updatedAt: updated.updatedAt,
        },
      }).catch(() => {});
    }
    // Repeat turned on/off/changed → (re)compute the anchor's spawn schedule.
    if (parsed.data.recurRule !== undefined) {
      const rescheduled = await applyRecurrenceSchedule(id, parsed.data.recurRule ?? null, c.userId);
      if (rescheduled) return NextResponse.json({ item: rescheduled });
    } else if (parsed.data.dueAt !== undefined) {
      // The due date IS the series anchor — moving it re-anchors an active
      // SCHEDULE series (recurNextAt + lastSpawnedKey recomputed from it).
      const storedRule = parseRecurrence(gate.item.recurRule);
      if (storedRule && (storedRule.trigger ?? "SCHEDULE") === "SCHEDULE") {
        const rescheduled = await applyRecurrenceSchedule(id, gate.item.recurRule, c.userId);
        if (rescheduled) return NextResponse.json({ item: rescheduled });
      }
    }
    // Completing an ON_COMPLETE recurring task advances its series in place —
    // return the rolled-forward row so the board updates without a refetch.
    if (parsed.data.status !== undefined) {
      const recur = await advanceSeriesOnComplete(id, updated.status, c.userId);
      if (recur.recurred && recur.item) {
        return NextResponse.json({ item: recur.item, recurred: true });
      }
    }
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
    // Recoverable delete — snapshot to Trash, then remove (subtasks cascade).
    await moveToTrash("item", id, { organizationId: c.organizationId, userId: c.userId, userName: c.userName });
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveBoardItem(id, c.userId);
  return NextResponse.json({ item: archived });
}
