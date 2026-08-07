// GET /api/automation/usage
//
// Usage metering for the hub's Usage page, all scoped to the current
// calendar month: actions used vs the org's monthly limit, a zero-filled
// daily series for the line chart, and top workflows / actions / users
// by executed-action count.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAutomationContext } from "@/lib/automation/hub-access";
import { getUsageState, monthStart } from "@/lib/automation/usage";

const TOP_N = 5;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET() {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;

  const from = monthStart();
  const usageWhere = { organizationId: ctx.orgId, usageDate: { gte: from } };

  const [state, dailyRows, workflowRows, actionRows, userRows] = await Promise.all([
    getUsageState(ctx.orgId),
    prisma.automationUsage.findMany({
      where: usageWhere,
      select: { usageDate: true, usageCount: true },
    }),
    prisma.automationUsage.groupBy({
      by: ["workflowId"],
      where: { ...usageWhere, workflowId: { not: null } },
      _sum: { usageCount: true },
      orderBy: { _sum: { usageCount: "desc" } },
      take: TOP_N,
    }),
    prisma.automationUsage.groupBy({
      by: ["actionKey"],
      where: usageWhere,
      _sum: { usageCount: true },
      orderBy: { _sum: { usageCount: "desc" } },
      take: TOP_N,
    }),
    prisma.automationUsage.groupBy({
      by: ["userId"],
      where: { ...usageWhere, userId: { not: null } },
      _sum: { usageCount: true },
      orderBy: { _sum: { usageCount: "desc" } },
      take: TOP_N,
    }),
  ]);

  // Zero-filled daily series from the 1st through today.
  const daily: Array<{ date: string; count: number }> = [];
  const byDay = new Map<string, number>();
  for (const row of dailyRows) {
    const key = dayKey(row.usageDate);
    byDay.set(key, (byDay.get(key) ?? 0) + row.usageCount);
  }
  const cursor = new Date(from);
  const today = new Date();
  while (cursor.getTime() <= today.getTime()) {
    const key = dayKey(cursor);
    daily.push({ date: key, count: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Resolve display names for the top workflows/users (org-scoped).
  const workflowIds = workflowRows.map((r) => r.workflowId).filter((v): v is string => !!v);
  const userIds = userRows.map((r) => r.userId).filter((v): v is string => !!v);
  const [workflows, users] = await Promise.all([
    workflowIds.length
      ? prisma.automationWorkflow.findMany({
          where: { id: { in: workflowIds }, organizationId: ctx.orgId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: ctx.orgId },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);
  const workflowName = new Map(workflows.map((w) => [w.id, w.name]));
  const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  return NextResponse.json({
    month: {
      from: from.toISOString(),
      used: state.used,
      limit: state.limit,
      remaining: state.remaining,
      blocked: state.blocked,
    },
    daily,
    topWorkflows: workflowRows.map((r) => ({
      workflowId: r.workflowId,
      name: r.workflowId ? (workflowName.get(r.workflowId) ?? "Deleted workflow") : "Unknown",
      count: r._sum.usageCount ?? 0,
    })),
    topActions: actionRows.map((r) => ({
      actionKey: r.actionKey,
      count: r._sum.usageCount ?? 0,
    })),
    topUsers: userRows.map((r) => ({
      userId: r.userId,
      name: r.userId ? (userName.get(r.userId) ?? "Former member") : "Unknown",
      count: r._sum.usageCount ?? 0,
    })),
  });
}
