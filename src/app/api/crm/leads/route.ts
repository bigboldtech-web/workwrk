// GET /api/crm/leads — list this org's leads
// POST /api/crm/leads — create a lead

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCrmContext } from "@/lib/crm/auth";
import { triggerEvent } from "@/lib/workflows/runtime";
import { logItemActivity } from "@/lib/activity/log";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const leads = await prisma.lead.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(status ? { status: status as "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ leads });
}

const createSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  company: z.string().max(120).optional(),
  title: z.string().max(120).optional(),
  source: z.string().max(40).optional(),
  notes: z.string().max(4000).optional(),
  ownerId: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: ctx.orgId,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email || undefined,
      phone: parsed.data.phone,
      company: parsed.data.company,
      title: parsed.data.title,
      source: parsed.data.source,
      notes: parsed.data.notes,
      ownerId: parsed.data.ownerId ?? ctx.userId,
    },
  });

  triggerEvent(ctx.orgId, "lead.created", lead as unknown as Record<string, unknown>);
  logItemActivity({
    organizationId: ctx.orgId,
    entityType: "LEAD",
    entityId: lead.id,
    actorId: ctx.userId,
    action: "CREATED",
    meta: { source: lead.source ?? null },
  });

  return NextResponse.json({ lead });
}

const patchSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().max(120).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "DISQUALIFIED"]).optional(),
  source: z.string().max(40).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.lead.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const lead = await prisma.lead.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.firstName !== undefined ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName !== undefined ? { lastName: parsed.data.lastName } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.company !== undefined ? { company: parsed.data.company } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.source !== undefined ? { source: parsed.data.source } : {}),
      ...(parsed.data.ownerId !== undefined ? { ownerId: parsed.data.ownerId } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.status === "CONVERTED" && !existing.convertedAt ? { convertedAt: new Date() } : {}),
    },
  });

  // Activity log — emits one row per meaningful change so the Updates
  // drawer's Activity tab shows the audit trail.
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    logItemActivity({
      organizationId: ctx.orgId,
      entityType: "LEAD",
      entityId: existing.id,
      actorId: ctx.userId,
      action: "STATUS_CHANGED",
      meta: { from: existing.status, to: parsed.data.status },
    });
  }
  if (parsed.data.ownerId !== undefined && parsed.data.ownerId !== existing.ownerId) {
    logItemActivity({
      organizationId: ctx.orgId,
      entityType: "LEAD",
      entityId: existing.id,
      actorId: ctx.userId,
      action: "ASSIGNED",
      meta: { from: existing.ownerId, to: parsed.data.ownerId },
    });
  }

  return NextResponse.json({ lead });
}
