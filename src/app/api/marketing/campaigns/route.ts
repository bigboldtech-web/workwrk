// GET/POST/PATCH /api/marketing/campaigns

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { logItemActivity } from "@/lib/activity/log";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {}),
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ campaigns });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(8000).optional(),
  channel: z.string().max(80).optional(),
  budget: z.number().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  goalMetric: z.string().max(40).optional(),
  goalTarget: z.number().int().nonnegative().optional(),
  utmCampaign: z.string().max(80).optional(),
  workspaceId: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const campaign = await prisma.campaign.create({
    data: {
      organizationId: ctx.orgId,
      workspaceId: parsed.data.workspaceId ?? null,
      name: parsed.data.name,
      description: parsed.data.description,
      channel: parsed.data.channel,
      budget: parsed.data.budget,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      goalMetric: parsed.data.goalMetric,
      goalTarget: parsed.data.goalTarget,
      utmCampaign: parsed.data.utmCampaign,
      ownerId: ctx.userId,
    },
  });
  return NextResponse.json({ campaign });
}

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).nullable().optional(),
  status: z.enum(["PLANNING", "APPROVED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  channel: z.string().max(80).nullable().optional(),
  budget: z.number().nonnegative().nullable().optional(),
  spent: z.number().nonnegative().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  goalMetric: z.string().max(40).nullable().optional(),
  goalTarget: z.number().int().nonnegative().nullable().optional(),
  goalActual: z.number().int().nonnegative().nullable().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.campaign.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const campaign = await prisma.campaign.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.channel !== undefined ? { channel: parsed.data.channel } : {}),
      ...(parsed.data.budget !== undefined ? { budget: parsed.data.budget } : {}),
      ...(parsed.data.spent !== undefined ? { spent: parsed.data.spent } : {}),
      ...(parsed.data.startDate !== undefined ? { startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null } : {}),
      ...(parsed.data.endDate !== undefined ? { endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null } : {}),
      ...(parsed.data.goalMetric !== undefined ? { goalMetric: parsed.data.goalMetric } : {}),
      ...(parsed.data.goalTarget !== undefined ? { goalTarget: parsed.data.goalTarget } : {}),
      ...(parsed.data.goalActual !== undefined ? { goalActual: parsed.data.goalActual } : {}),
    },
  });

  // Per-item activity feed
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "campaign", entityId: parsed.data.id,
      actorId: ctx.userId, action: "status_changed",
      meta: { from: existing.status, to: parsed.data.status },
    });
  }
  if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
    logItemActivity({
      organizationId: ctx.orgId, entityType: "campaign", entityId: parsed.data.id,
      actorId: ctx.userId, action: "renamed",
      meta: { from: existing.name, to: parsed.data.name },
    });
  }

  return NextResponse.json({ campaign });
}
