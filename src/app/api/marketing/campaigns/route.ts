// GET/POST/PATCH /api/marketing/campaigns

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: ctx.orgId },
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
  status: z.enum(["PLANNING", "APPROVED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  spent: z.number().nonnegative().optional(),
  goalActual: z.number().int().nonnegative().optional(),
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
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.spent !== undefined ? { spent: parsed.data.spent } : {}),
      ...(parsed.data.goalActual !== undefined ? { goalActual: parsed.data.goalActual } : {}),
    },
  });
  return NextResponse.json({ campaign });
}
