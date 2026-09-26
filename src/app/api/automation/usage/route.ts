// GET /api/automation/usage?month=YYYY-MM
//
// How much of a month's automation allowance the workspace used (spec-ai-
// automation /automation/usage). The month defaults to the current one; a
// month before the workspace ever ran anything returns zeros, never a 404,
// so the Previous month button never dead-ends. Returns
//   { month, used, limit, blocked, paused, isCurrent, daily,
//     topAutomations, topActions, topPeople? }
// `topPeople` (per-person automation activity) is OMITTED for everyone but
// Owners and Admins: the conservative reading (no access rule covers it), and
// the gate is here on the server so a stale client cannot leak it.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutomation } from "@/lib/automation/gate";
import { getAction } from "@/lib/automation/registry-actions";
import { monthKey, monthRange, readAutomationSettings } from "@/lib/automation/settings";

const TOP_N = 5;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;

  const now = new Date();
  const requested = req.nextUrl.searchParams.get("month");
  const month = requested ?? monthKey(now);
  const range = monthRange(month);
  if (!range) return NextResponse.json({ error: "Invalid month. Use YYYY-MM." }, { status: 400 });
  const isCurrent = month === monthKey(now);
  const usageWhere = { organizationId: ctx.orgId, usageDate: { gte: range.start, lt: range.end } };

  const [org, usedAgg, dailyRows, workflowRows, actionRows, userRows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } }),
    prisma.automationUsage.aggregate({ where: usageWhere, _sum: { usageCount: true } }),
    prisma.automationUsage.findMany({ where: usageWhere, select: { usageDate: true, usageCount: true } }),
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
    ctx.isAdmin
      ? prisma.automationUsage.groupBy({
          by: ["userId"],
          where: { ...usageWhere, userId: { not: null } },
          _sum: { usageCount: true },
          orderBy: { _sum: { usageCount: "desc" } },
          take: TOP_N,
        })
      : Promise.resolve([]),
  ]);

  const settings = readAutomationSettings(org?.settings);
  const used = usedAgg._sum.usageCount ?? 0;

  // Zero-filled daily series: the whole month for a past month, the 1st
  // through today for the current one.
  const byDay = new Map<string, number>();
  for (const row of dailyRows) {
    const key = dayKey(row.usageDate);
    byDay.set(key, (byDay.get(key) ?? 0) + row.usageCount);
  }
  const daily: Array<{ date: string; count: number }> = [];
  const last = isCurrent ? now : new Date(range.end.getTime() - 1);
  for (const c = new Date(range.start); c.getTime() <= last.getTime() && c.getTime() < range.end.getTime(); c.setDate(c.getDate() + 1)) {
    const key = dayKey(c);
    daily.push({ date: key, count: byDay.get(key) ?? 0 });
  }

  const workflowIds = workflowRows.map((r) => r.workflowId).filter((v): v is string => !!v);
  const userIds = userRows.map((r) => r.userId).filter((v): v is string => !!v);
  const [workflows, users] = await Promise.all([
    workflowIds.length
      ? prisma.automationWorkflow.findMany({ where: { id: { in: workflowIds }, organizationId: ctx.orgId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds }, organizationId: ctx.orgId }, select: { id: true, firstName: true, lastName: true, avatar: true } })
      : Promise.resolve([]),
  ]);
  const workflowName = new Map(workflows.map((w) => [w.id, w.name]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json(
    {
      month,
      isCurrent,
      used,
      limit: settings.limit,
      // The meter blocks new runs only in the month it is counting.
      blocked: isCurrent && used >= settings.limit,
      paused: settings.paused,
      daily,
      topAutomations: workflowRows.map((r) => ({
        id: r.workflowId,
        name: r.workflowId ? (workflowName.get(r.workflowId) ?? "An automation that was removed") : "Unknown",
        count: r._sum.usageCount ?? 0,
      })),
      topActions: actionRows.map((r) => ({
        key: r.actionKey,
        label: getAction(r.actionKey)?.name ?? "An action that no longer exists",
        count: r._sum.usageCount ?? 0,
      })),
      ...(ctx.isAdmin
        ? {
            topPeople: userRows.map((r) => {
              const u = r.userId ? userById.get(r.userId) : undefined;
              return {
                userId: r.userId,
                name: u ? `${u.firstName} ${u.lastName}`.trim() : "Former member",
                avatarUrl: u?.avatar ?? null,
                count: r._sum.usageCount ?? 0,
              };
            }),
          }
        : {}),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
