// GET /api/helpdesk/tickets — list, optionally filtered by status/assignee
// POST /api/helpdesk/tickets — create. customerId or customerEmail required
// PATCH /api/helpdesk/tickets — update status / assignee / CSAT

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { triggerEvent } from "@/lib/workflows/runtime";
import { logItemActivity } from "@/lib/activity/log";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const tickets = await prisma.supportTicket.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(status ? { status: status as "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM" } : {}),
    },
    include: { customer: { select: { id: true, name: true, email: true, companyName: true } } },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return NextResponse.json({ tickets });
}

const createSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().max(20000).optional(),
  customerEmail: z.string().email(),
  customerName: z.string().max(160).optional(),
  customerCompany: z.string().max(160).optional(),
  channel: z.enum(["EMAIL", "CHAT", "PHONE", "PORTAL", "SOCIAL", "IN_APP"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  category: z.string().max(40).optional(),
  slaTier: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

  // Find-or-create customer by email
  let customer = await prisma.supportCustomer.findUnique({
    where: { organizationId_email: { organizationId: ctx.orgId, email: parsed.data.customerEmail } },
  });
  if (!customer) {
    customer = await prisma.supportCustomer.create({
      data: {
        organizationId: ctx.orgId,
        email: parsed.data.customerEmail,
        name: parsed.data.customerName,
        companyName: parsed.data.customerCompany,
      },
    });
  }

  // Compute first response SLA from tier (hours)
  const slaHours: Record<string, number> = { Free: 48, Standard: 24, Premium: 8, Enterprise: 4 };
  const firstResponseDueAt = parsed.data.slaTier
    ? new Date(Date.now() + (slaHours[parsed.data.slaTier] ?? 24) * 60 * 60 * 1000)
    : null;

  const ticket = await prisma.supportTicket.create({
    data: {
      organizationId: ctx.orgId,
      subject: parsed.data.subject,
      body: parsed.data.body,
      customerId: customer.id,
      channel: parsed.data.channel ?? "EMAIL",
      priority: parsed.data.priority ?? "NORMAL",
      category: parsed.data.category,
      slaTier: parsed.data.slaTier,
      firstResponseDueAt,
    },
    include: { customer: { select: { id: true, name: true, email: true, companyName: true } } },
  });

  triggerEvent(ctx.orgId, "support_ticket.created", ticket as unknown as Record<string, unknown>);

  return NextResponse.json({ ticket });
}

const patchSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1).max(300).optional(),
  status: z.enum(["NEW", "OPEN", "PENDING_CUSTOMER", "PENDING_INTERNAL", "RESOLVED", "CLOSED", "SPAM"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  channel: z.enum(["EMAIL", "CHAT", "PORTAL", "PHONE", "SOCIAL", "API"]).optional(),
  category: z.string().max(80).nullable().optional(),
  slaTier: z.string().max(40).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  csatScore: z.number().int().min(0).max(5).nullable().optional(),
  csatComment: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.supportTicket.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  const updates: Record<string, unknown> = {};
  if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.channel !== undefined) updates.channel = parsed.data.channel;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.slaTier !== undefined) updates.slaTier = parsed.data.slaTier;
  if (parsed.data.assigneeId !== undefined) updates.assigneeId = parsed.data.assigneeId;
  if (parsed.data.csatScore !== undefined) updates.csatScore = parsed.data.csatScore;
  if (parsed.data.csatComment !== undefined) updates.csatComment = parsed.data.csatComment;

  // Auto-stamp lifecycle moments
  if (parsed.data.status === "RESOLVED" && !existing.resolvedAt) updates.resolvedAt = now;
  if (parsed.data.status === "CLOSED" && !existing.closedAt) updates.closedAt = now;
  if (parsed.data.status === "OPEN" && !existing.firstResponseAt) updates.firstResponseAt = now;

  const ticket = await prisma.supportTicket.update({
    where: { id: parsed.data.id },
    data: updates,
    include: { customer: { select: { id: true, name: true, email: true, companyName: true } } },
  });

  // Per-item activity feed
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "support_ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "status_changed",
      meta: { from: existing.status, to: parsed.data.status },
    });
  }
  if (parsed.data.priority !== undefined && parsed.data.priority !== existing.priority) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "support_ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "priority_changed",
      meta: { from: existing.priority, to: parsed.data.priority },
    });
  }
  if (parsed.data.subject !== undefined && parsed.data.subject !== existing.subject) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "support_ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "renamed",
      meta: { from: existing.subject, to: parsed.data.subject },
    });
  }
  if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== existing.assigneeId) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "support_ticket", entityId: parsed.data.id,
      actorId: ctx.userId, action: "assigned",
      meta: { from: existing.assigneeId, to: parsed.data.assigneeId },
    });
  }

  return NextResponse.json({ ticket });
}
