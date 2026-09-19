import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { createPersonalTask } from "@/lib/work/personal-task";

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

  const where: Record<string, unknown> = { organizationId: ctx.organizationId, archivedAt: null };
  if (assigneeId) where.OR = [{ ownerId: assigneeId }, { assigneeIds: { has: assigneeId } }];
  if (status) where.status = { equals: status, mode: "insensitive" };
  if (from || to) {
    where.dueAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
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
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    date?: string;
    assigneeId?: string;
    kraId?: string;
    slaHours?: number;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    source?: "MANUAL" | "SOP" | "REVIEW" | "OKR" | "AI";
    sourceRef?: string;
    category?: string;
  };
  if (!body.title?.trim() || !body.assigneeId) {
    return Response.json({ error: "title and assigneeId are required" }, { status: 400 });
  }

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
    dueAt: body.date ? new Date(body.date) : new Date(),
    priority: body.priority ?? "NORMAL",
    legacy: {
      category: body.category?.slice(0, 80) ?? null,
      kraId: body.kraId ?? null,
      slaHours: body.slaHours && body.slaHours > 0 ? body.slaHours : null,
      source: body.source ?? "MANUAL",
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
    slaHours: body.slaHours && body.slaHours > 0 ? body.slaHours : null,
    source: body.source ?? "MANUAL",
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
