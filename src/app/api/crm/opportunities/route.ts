// GET /api/crm/opportunities — list deals (optionally filtered by stage)
// POST /api/crm/opportunities — create a deal
// PATCH /api/crm/opportunities — move a deal between stages
//   { id, pipelineStageId }  (used by drag-to-stage in the kanban)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCrmContext } from "@/lib/crm/auth";
import { triggerEvent } from "@/lib/workflows/runtime";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const { searchParams } = new URL(req.url);
  const stageId = searchParams.get("stageId");

  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(stageId ? { pipelineStageId: stageId } : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      pipelineStage: { select: { id: true, name: true, color: true, isWon: true, isLost: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ opportunities });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  accountId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
  expectedCloseDate: z.string().optional(),
  description: z.string().max(4000).optional(),
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

  // Default to the first non-Won/non-Lost stage if none specified.
  let stageId = parsed.data.pipelineStageId;
  if (!stageId) {
    const firstStage = await prisma.pipelineStage.findFirst({
      where: { organizationId: ctx.orgId, isWon: false, isLost: false, archivedAt: null },
      orderBy: { position: "asc" },
    });
    stageId = firstStage?.id;
  }

  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      accountId: parsed.data.accountId,
      pipelineStageId: stageId,
      amount: parsed.data.amount,
      currency: parsed.data.currency ?? "USD",
      expectedCloseDate: parsed.data.expectedCloseDate ? new Date(parsed.data.expectedCloseDate) : null,
      description: parsed.data.description,
      ownerId: parsed.data.ownerId ?? ctx.userId,
    },
    include: {
      account: { select: { id: true, name: true } },
      pipelineStage: { select: { id: true, name: true, color: true, isWon: true, isLost: true } },
    },
  });

  return NextResponse.json({ opportunity });
}

const patchSchema = z.object({
  id: z.string().min(1),
  pipelineStageId: z.string().optional(),
  amount: z.number().optional(),
  name: z.string().min(1).max(160).optional(),
  expectedCloseDate: z.string().nullable().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.opportunity.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // If moved to a Won/Lost stage, stamp closedAt + isWon.
  let closedAt: Date | null | undefined;
  let isWon: boolean | null | undefined;
  if (parsed.data.pipelineStageId && parsed.data.pipelineStageId !== existing.pipelineStageId) {
    const newStage = await prisma.pipelineStage.findUnique({ where: { id: parsed.data.pipelineStageId } });
    if (newStage?.isWon) {
      closedAt = new Date();
      isWon = true;
    } else if (newStage?.isLost) {
      closedAt = new Date();
      isWon = false;
    } else if (existing.closedAt) {
      // Reopening a closed deal
      closedAt = null;
      isWon = null;
    }
  }

  const opportunity = await prisma.opportunity.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.pipelineStageId !== undefined ? { pipelineStageId: parsed.data.pipelineStageId } : {}),
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.expectedCloseDate !== undefined
        ? { expectedCloseDate: parsed.data.expectedCloseDate ? new Date(parsed.data.expectedCloseDate) : null }
        : {}),
      ...(closedAt !== undefined ? { closedAt } : {}),
      ...(isWon !== undefined ? { isWon } : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      pipelineStage: { select: { id: true, name: true, color: true, isWon: true, isLost: true } },
    },
  });

  // Fire stage_changed only when the stage actually changed. Won/Lost
  // get their own dedicated event for cleaner routing.
  if (parsed.data.pipelineStageId && parsed.data.pipelineStageId !== existing.pipelineStageId) {
    const stageName = opportunity.pipelineStage?.name ?? "";
    triggerEvent(ctx.orgId, "opportunity.stage_changed", opportunity as unknown as Record<string, unknown>);
    if (opportunity.pipelineStage?.isWon) {
      triggerEvent(ctx.orgId, "opportunity.won", { ...opportunity, stageName } as unknown as Record<string, unknown>);
    } else if (opportunity.pipelineStage?.isLost) {
      triggerEvent(ctx.orgId, "opportunity.lost", { ...opportunity, stageName } as unknown as Record<string, unknown>);
    }
  }

  return NextResponse.json({ opportunity });
}
