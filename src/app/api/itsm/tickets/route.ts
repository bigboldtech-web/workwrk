// GET /api/itsm/tickets — list this org's tickets (filterable by status)
// POST /api/itsm/tickets — submit a new ticket
// PATCH /api/itsm/tickets — update status / assign / resolve

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveItsmContext } from "@/lib/itsm/auth";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assigneeId = searchParams.get("assigneeId");

  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(status ? { status: status as "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED" } : {}),
      ...(assigneeId ? { assigneeId } : {}),
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
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority ?? "NORMAL",
      category: parsed.data.category,
      source: parsed.data.source ?? "PORTAL",
      requesterId: parsed.data.requesterId ?? ctx.userId,
      assigneeId: parsed.data.assigneeId,
    },
  });

  return NextResponse.json({ ticket });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "WAITING_ON_VENDOR", "RESOLVED", "CLOSED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"]).optional(),
  assigneeId: z.string().nullable().optional(),
  resolutionNotes: z.string().max(8000).optional(),
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
  const updates: Partial<{ status: typeof parsed.data.status; priority: typeof parsed.data.priority; assigneeId: string | null; resolutionNotes: string; acknowledgedAt: Date | null; resolvedAt: Date | null; closedAt: Date | null }> = {};
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.assigneeId !== undefined) updates.assigneeId = parsed.data.assigneeId;
  if (parsed.data.resolutionNotes !== undefined) updates.resolutionNotes = parsed.data.resolutionNotes;

  if (parsed.data.status === "TRIAGED" && !existing.acknowledgedAt) updates.acknowledgedAt = now;
  if (parsed.data.status === "RESOLVED" && !existing.resolvedAt) updates.resolvedAt = now;
  if (parsed.data.status === "CLOSED" && !existing.closedAt) updates.closedAt = now;

  const ticket = await prisma.ticket.update({
    where: { id: parsed.data.id },
    data: updates,
  });

  return NextResponse.json({ ticket });
}
