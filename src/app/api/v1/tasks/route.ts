import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { createPersonalTask } from "@/lib/work/personal-task";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import { TaskSource } from "@/generated/prisma";
import { API_DATE_RULE, parseApiDate, parseSlaHours } from "@/lib/api-input";

/** The values a task's priority and source may hold: the List priority set and the TaskSource enum. */
const PRIORITIES: readonly string[] = PRIORITY_OPTIONS.map((p) => p.value);
const SOURCES: readonly string[] = Object.values(TaskSource);

/**
 * One of `allowed`, in any case (an integration that sent "high" has always
 * been stored as HIGH), or null when the value is outside the list. Absent
 * is the default, never an error.
 */
function pickListed(value: unknown, allowed: readonly string[], fallback: string): string | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return null;
  const up = value.trim().toUpperCase();
  return allowed.includes(up) ? up : null;
}

/**
 * GET /api/v1/tasks: list; POST, create (with optional SLA + source).
 *
 * Phase 2 W4 (docs/plans/ui-refresh/spec-work-home.md section 4). Both halves
 * read and write `Item` now, not the legacy `Task` table: that table's whole UI
 * is deleted in this release, so a row POSTed here used to become content no
 * person could open. A task created through this endpoint lands on the
 * assignee's Personal list, and the `id` it returns opens at /item/<id>.
 *
 * THE RESPONSE SHAPE IS DELIBERATELY UNCHANGED. This is a published API, so
 * every key an integration reads is still there and still means the same
 * thing; the Item columns are projected back onto the legacy names
 * (`date` = `dueAt`, `slaHours` / `source` / `sourceRef` / `category` out of
 * `metadata.legacyTask`, `description` out of `metadata.description`), which
 * is the SAME bag scripts/migrate-legacy-tasks.ts wrote for migrated rows.
 *
 * TWO BEHAVIOURS CHANGED, both of them fixes:
 *   - `status` was one of three enum values. An Item's status is a per-List
 *     NAME, so the filter is an exact, case-insensitive match on that name.
 *   - `assigneeId` matched one column. An Item has an owner and an assignee
 *     set, so a task assigned to somebody by another person is now listed for
 *     them too.
 */
type LegacyBag = { slaHours?: unknown; source?: unknown; sourceRef?: unknown; category?: unknown; escalatedAt?: unknown };

/** Project an Item back onto the legacy Task keys this endpoint publishes. */
function asLegacyTask(row: {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: Date | null;
  ownerId: string | null;
  createdAt: Date;
  metadata: unknown;
}) {
  const md = (row.metadata ?? {}) as { description?: unknown; legacyTask?: LegacyBag };
  const legacy = md.legacyTask ?? {};
  return {
    id: row.id,
    title: row.title,
    description: typeof md.description === "string" ? md.description : null,
    date: row.dueAt,
    status: row.status,
    priority: row.priority,
    slaHours: typeof legacy.slaHours === "number" ? legacy.slaHours : null,
    escalatedAt: typeof legacy.escalatedAt === "string" ? legacy.escalatedAt : null,
    source: typeof legacy.source === "string" ? legacy.source : "MANUAL",
    sourceRef: typeof legacy.sourceRef === "string" ? legacy.sourceRef : null,
    assigneeId: row.ownerId,
    createdAt: row.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const assigneeId = url.searchParams.get("assigneeId");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Meetings ride the Item ladder as hidden rows (src/lib/system-items.ts);
  // they are not tasks and must not appear in the public task API.
  const where: Record<string, unknown> = { organizationId: ctx.organizationId, archivedAt: null, ...NOT_SYSTEM_ITEMS };
  if (assigneeId) where.OR = [{ ownerId: assigneeId }, { assigneeIds: { has: assigneeId } }];
  if (status) where.status = { equals: status, mode: "insensitive" };
  // A from or to that is not a date is the caller's mistake (400), not an
  // Invalid Date handed to the read (500).
  const fromAt = parseApiDate(from);
  const toAt = parseApiDate(to);
  if (!fromAt.ok) return Response.json({ error: `from ${API_DATE_RULE}` }, { status: 400 });
  if (!toAt.ok) return Response.json({ error: `to ${API_DATE_RULE}` }, { status: 400 });
  if (fromAt.value || toAt.value) {
    where.dueAt = {
      ...(fromAt.value ? { gte: fromAt.value } : {}),
      ...(toAt.value ? { lte: toAt.value } : {}),
    };
  }

  const rows = await prisma.item.findMany({
    where,
    take: limit + 1,
    // `dueAt` is nullable and Postgres sorts NULLs first on DESC, which would
    // put every undated task at the head of page one for ever. `nulls: "last"`
    // keeps the cursor stable and the dated work where a caller expects it.
    orderBy: [{ dueAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      ownerId: true,
      createdAt: true,
      metadata: true,
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data: page.map(asLegacyTask),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;
  // A body of null reads as an empty one, never a 500.
  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    title?: string;
    description?: string;
    date?: unknown;
    assigneeId?: string;
    kraId?: string;
    slaHours?: unknown;
    priority?: unknown;
    source?: unknown;
    sourceRef?: string;
    category?: string;
  };
  if (!body.title?.trim() || !body.assigneeId) {
    return Response.json({ error: "title and assigneeId are required" }, { status: 400 });
  }
  // A value outside the real lists is the caller's mistake, answered as one:
  // an unknown priority used to throw inside createBoardItem and answer 500,
  // and any source was stored as sent.
  const priority = pickListed(body.priority, PRIORITIES, "NORMAL");
  if (!priority) return Response.json({ error: `priority must be one of ${PRIORITIES.join(", ")}` }, { status: 400 });
  const source = pickListed(body.source, SOURCES, "MANUAL");
  if (!source) return Response.json({ error: `source must be one of ${SOURCES.join(", ")}` }, { status: 400 });
  // A date that is not one used to become an Invalid Date that failed inside
  // the create (500); a numeric string slaHours was stored as text and read
  // back as null. Both answer 400 now (src/lib/api-input.ts).
  const due = parseApiDate(body.date);
  if (!due.ok) return Response.json({ error: `date ${API_DATE_RULE}` }, { status: 400 });
  const sla = parseSlaHours(body.slaHours);
  if (!sla.ok) return Response.json({ error: "slaHours must be a number of hours" }, { status: 400 });

  // Assignee must be in caller's org. createPersonalTask re-checks this (it is
  // the one thing that must never be guessed at), but the check stays here so
  // the caller still gets the documented 404 rather than a 500.
  const assignee = await prisma.user.findFirst({
    where: { id: body.assigneeId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!assignee) return Response.json({ error: "Assignee not in org" }, { status: 404 });

  const created = await createPersonalTask({
    organizationId: ctx.organizationId,
    assigneeId: body.assigneeId,
    title: body.title.trim().slice(0, 200),
    description: body.description?.slice(0, 2000) ?? null,
    dueAt: due.value ?? new Date(),
    priority,
    legacy: {
      category: body.category?.slice(0, 80) ?? null,
      kraId: body.kraId ?? null,
      slaHours: sla.value,
      source,
      sourceRef: body.sourceRef ?? null,
    },
    actorId: null,
  });

  const task = {
    id: created.id,
    title: created.title,
    date: created.dueAt,
    status: created.status,
    priority: created.priority,
    slaHours: sla.value,
    source,
    sourceRef: body.sourceRef ?? null,
    assigneeId: created.assigneeId,
    createdAt: new Date(),
  };

  dispatchEvent({
    organizationId: ctx.organizationId,
    event: "task.created",
    payload: task,
  }).catch(() => {});

  return Response.json(task, { status: 201 });
}
