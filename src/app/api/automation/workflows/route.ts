// /api/automation/workflows
//
// GET  → list the org's automation workflows (+ per-workflow run stats
//        and creator), newest-updated first. Archived rows are hidden
//        unless ?status=ARCHIVED or ?includeArchived=1.
// POST → create a DRAFT workflow (manager+).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  canManageAutomations,
  forbidden,
  resolveAutomationContext,
} from "@/lib/automation/hub-access";
import { getTrigger } from "@/lib/automation/registry-triggers";

const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ERROR", "ARCHIVED"] as const;

const definitionSchema = z.object({
  conditions: z.unknown().optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).nullish(),
  triggerEvent: z.string().trim().min(1).max(200).nullish(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).optional(),
  definition: definitionSchema.optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;

  const sp = req.nextUrl.searchParams;
  const statusParam = sp.get("status");
  if (statusParam && !WORKFLOW_STATUSES.includes(statusParam as (typeof WORKFLOW_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  const q = sp.get("q")?.trim();
  const includeArchived = sp.get("includeArchived") === "1";

  const workflows = await prisma.automationWorkflow.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(statusParam
        ? { status: statusParam as (typeof WORKFLOW_STATUSES)[number] }
        : includeArchived
          ? {}
          : { status: { not: "ARCHIVED" } }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      severity: true,
      triggerEvent: true,
      publishedVersionId: true,
      publishedAt: true,
      lastRunAt: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const ids = workflows.map((w) => w.id);
  const creatorIds = [...new Set(workflows.map((w) => w.createdById).filter((v): v is string => !!v))];

  const [runStats, creators] = await Promise.all([
    ids.length
      ? prisma.automationRun.groupBy({
          by: ["workflowId", "status"],
          where: { organizationId: ctx.orgId, workflowId: { in: ids } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    creatorIds.length
      ? prisma.user.findMany({
          where: { id: { in: creatorIds }, organizationId: ctx.orgId },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);

  const statsByWorkflow = new Map<string, Record<string, number>>();
  for (const row of runStats) {
    const bucket = statsByWorkflow.get(row.workflowId) ?? {};
    bucket[row.status] = row._count._all;
    statsByWorkflow.set(row.workflowId, bucket);
  }
  const creatorById = new Map(creators.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  return NextResponse.json({
    workflows: workflows.map((w) => {
      const counts = statsByWorkflow.get(w.id) ?? {};
      const success = counts.SUCCESS ?? 0;
      const terminal = success + (counts.FAILED ?? 0) + (counts.PARTIAL ?? 0);
      return {
        ...w,
        createdByName: w.createdById ? (creatorById.get(w.createdById) ?? null) : null,
        runCounts: counts,
        totalRuns: Object.values(counts).reduce((a, b) => a + b, 0),
        successRate: terminal > 0 ? Math.round((success / terminal) * 100) : null,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (!canManageAutomations(ctx)) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const triggerEvent = parsed.data.triggerEvent ?? null;
  if (triggerEvent && !getTrigger(triggerEvent)) {
    return NextResponse.json({ error: `Unknown trigger event: ${triggerEvent}` }, { status: 400 });
  }

  const workflow = await prisma.automationWorkflow.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: "DRAFT",
      severity: parsed.data.severity ?? "MINOR",
      triggerEvent,
      definition: (parsed.data.definition ?? { conditions: null, actions: [] }) as Prisma.InputJsonValue,
      createdById: ctx.userId,
      updatedById: ctx.userId,
    },
  });

  return NextResponse.json({ workflow }, { status: 201 });
}
