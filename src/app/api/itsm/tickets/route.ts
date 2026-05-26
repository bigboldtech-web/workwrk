// GET /api/itsm/tickets — list this org's tickets (filterable by status)
// POST /api/itsm/tickets — submit a new ticket
// PATCH /api/itsm/tickets — update status / assign / resolve

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveItsmContext } from "@/lib/itsm/auth";
import { triggerEvent } from "@/lib/workflows/runtime";
import { logItemActivity } from "@/lib/activity/log";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assigneeId = searchParams.get("assigneeId");
  const workspaceId = searchParams.get("workspace");

  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(status ? { status: status as "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED" } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  return NextResponse.json({ tickets });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"]).optional(),
  category: z.string().max(80).optional(),
  source: z.enum(["PORTAL", "EMAIL", "CHAT", "PHONE", "API", "AGENT"]).optional(),
  requesterId: z.string().optional(),
  assigneeId: z.string().optional(),
  workspaceId: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const ticket = await prisma.ticket.create({
    data: {
      organizationId: ctx.orgId,
      workspaceId: parsed.data.workspaceId ?? null,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority ?? "NORMAL",
      category: parsed.data.category,
      source: parsed.data.source ?? "PORTAL",
      requesterId: parsed.data.requesterId ?? ctx.userId,
      assigneeId: parsed.data.assigneeId,
    },
  });

  triggerEvent(ctx.orgId, "ticket.created", ticket as unknown as Record<string, unknown>);

  logItemActivity({
    organizationId: ctx.orgId, entityType: "ticket", entityId: ticket.id,
    actorId: ctx.userId, action: "created", meta: { title: ticket.title },
  });

  return NextResponse.json({ ticket });
}

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(8000).nullable().optional(),
  status: z.enum(["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "WAITING_ON_VENDOR", "RESOLVED", "CLOSED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"]).optional(),
  category: z.string().max(80).nullable().optional(),
  slaTier: z.string().max(40).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  resolutionNotes: z.string().max(8000).nullable().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.ticket.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date();
  // Auto-stamp lifecycle timestamps on status transitions.
  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.slaTier !== undefined) updates.slaTier = parsed.data.slaTier;
  if (parsed.data.dueAt !== undefined) updates.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (parsed.data.assigneeId !== undefined) updates.assigneeId = parsed.data.assigneeId;
  if (parsed.data.resolutionNotes !== undefined) updates.resolutionNotes = parsed.data.resolutionNotes;

  if (parsed.data.status === "TRIAGED" && !existing.acknowledgedAt) updates.acknowledgedAt = now;
  if (parsed.data.status === "RESOLVED" && !existing.resolvedAt) updates.resolvedAt = now;
  if (parsed.data.status === "CLOSED" && !existing.closedAt) updates.closedAt = now;

  const ticket = await prisma.ticket.update({
    where: { id: parsed.data.id },
    data: updates,
  });

  // Per-item activity feed
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "status_changed",
      meta: { from: existing.status, to: parsed.data.status },
    });
  }
  if (parsed.data.priority !== undefined && parsed.data.priority !== existing.priority) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "priority_changed",
      meta: { from: existing.priority, to: parsed.data.priority },
    });
  }
  if (parsed.data.title !== undefined && parsed.data.title !== existing.title) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "renamed",
      meta: { from: existing.title, to: parsed.data.title },
    });
  }
  if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== existing.assigneeId) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "assigned",
      meta: { from: existing.assigneeId, to: parsed.data.assigneeId },
    });
  }

  return NextResponse.json({ ticket });
}
