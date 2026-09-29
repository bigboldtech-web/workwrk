import "server-only";

// Who may act on a person's KPI numbers, and the Inbox rows the KPI review
// loop writes (spec-goals /team/kpi-reviews, "The KPI review loop").
//
// "Can edit on the person" for KPIs is the manager chain (solid or dotted,
// any tier: the queue has always listed dotted reports and approvals have
// always been dotted-aware), the People team, Owner and Admin, and the
// legacy org-wide levels that could record for anyone yesterday
// (canTouchUserAlignment). Never yourself: a person never approves or
// records-as-manager their own number.
//
// Inbox types (src/lib/inbox-kinds.ts): kpi_submitted to the person's
// direct manager and dotted-line managers (the first people whose queue it
// lands in; the whole chain above them sees it on the page and in the
// sidebar count, without an Inbox row each), kpi_approved,
// kpi_changes_requested and kpi_recorded_for_you to the person.

import { prisma } from "@/lib/prisma";
import { peopleCtx, relationTo, type PeopleCtx } from "@/lib/people/person-access.server";
import { kpiPeriodLabel } from "@/lib/kpi-period";
import { teamScopeFor } from "@/lib/people/team-scope.server";

export async function kpiActorCtx(): Promise<PeopleCtx | null> {
  return peopleCtx();
}

/** May `ctx` record on behalf of, approve or send back `subjectId`'s numbers? */
export function mayActOnKpisOf(ctx: PeopleCtx, subjectId: string): boolean {
  if (ctx.isAgent && !ctx.chain.has(subjectId)) return false;
  const rel = relationTo(ctx, subjectId);
  return rel === "admin" || rel === "people-team" || rel === "org-wide" || rel === "chain" || rel === "chain-view";
}

/**
 * The KPI numbers awaiting `ctx` on /team/kpi-reviews: SUBMITTED rows, any
 * month, for exactly the people that page lists (teamScopeFor: the chain,
 * or the org for Admin and the People team, filtered by mayActOnKpisOf),
 * and only on KPIs the person still carries through an ACTIVE KRA, since
 * the page can only show those. The sidebar badge, My team's attention
 * card and the page's "Also awaiting you" line all read this one list, so
 * the three never disagree.
 */
export async function listAwaitingKpiNumbers(ctx: PeopleCtx): Promise<Array<{ userId: string; kpiId: string; period: string }>> {
  const scope = await teamScopeFor(ctx);
  const ids = scope.ids.filter((id) => id !== ctx.userId && mayActOnKpisOf(ctx, id));
  if (ids.length === 0) return [];
  const rows = await prisma.kPIRecord.findMany({
    where: { userId: { in: ids }, status: "SUBMITTED", kpi: { organizationId: ctx.organizationId } },
    select: { userId: true, kpiId: true, period: true },
  });
  if (rows.length === 0) return [];
  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId: { in: [...new Set(rows.map((r) => r.userId))] }, status: "ACTIVE" },
    select: { userId: true, kra: { select: { kpis: { select: { id: true } } } } },
  });
  const carried = new Set<string>();
  for (const a of assignments) for (const k of a.kra.kpis) carried.add(`${a.userId}:${k.id}`);
  return rows.filter((r) => carried.has(`${r.userId}:${r.kpiId}`));
}

export interface RecentKpiDecision {
  id: string;
  userId: string;
  personName: string;
  kpiName: string;
  unit: string | null;
  period: string;
  status: "APPROVED" | "REJECTED";
  actualValue: number | null;
  byYou: boolean;
  updatedAt: string;
}

/**
 * The last 30 days of decisions on the people this page lists (the old
 * approval tab's "Recently acted" list, kept when the two pages merged).
 * A manager sees every decision in their chain; Admin and the People team,
 * whose page covers the whole org, see the decisions they made themselves.
 */
export async function listRecentKpiDecisions(ctx: PeopleCtx, days = 30): Promise<RecentKpiDecision[]> {
  const scope = await teamScopeFor(ctx);
  const ids = scope.ids.filter((id) => id !== ctx.userId && mayActOnKpisOf(ctx, id));
  if (ids.length === 0) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.kPIRecord.findMany({
    where: {
      userId: { in: ids },
      status: { in: ["APPROVED", "REJECTED"] },
      updatedAt: { gte: since },
      kpi: { organizationId: ctx.organizationId },
      ...(scope.orgWide ? { reviewedById: ctx.userId } : {}),
    },
    select: {
      id: true, userId: true, period: true, status: true, actualValue: true, reviewedById: true, updatedAt: true,
      kpi: { select: { name: true, unit: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    personName: nameOf(r.user),
    kpiName: r.kpi.name,
    unit: r.kpi.unit,
    period: r.period,
    status: r.status as "APPROVED" | "REJECTED",
    actualValue: r.actualValue,
    byYou: r.reviewedById === ctx.userId,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * The badge count for the signed-in viewer (the boot pass and My team).
 * Falls back to 0 rather than a wrong number when there is no session for
 * `userId` (a cron or a test).
 */
export async function countAwaitingKpiNumbers(userId: string): Promise<number> {
  const ctx = await peopleCtx();
  if (!ctx || ctx.userId !== userId) return 0;
  return (await listAwaitingKpiNumbers(ctx)).length;
}

function nameOf(u: { firstName: string | null; lastName: string | null; email?: string | null } | null | undefined): string {
  if (!u) return "Someone";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "Someone";
}

/** An employee submitted numbers: tell the people whose queue they land in. */
export async function notifyKpiSubmitted(args: { userId: string; organizationId: string; period: string; count: number }): Promise<void> {
  if (args.count <= 0) return;
  const [me, dotted] = await Promise.all([
    prisma.user.findFirst({ where: { id: args.userId, organizationId: args.organizationId }, select: { firstName: true, lastName: true, email: true, managerId: true } }),
    prisma.userDottedLine.findMany({ where: { userId: args.userId }, select: { managerId: true } }),
  ]);
  if (!me) return;
  const to = [...new Set([me.managerId, ...dotted.map((d) => d.managerId)].filter((x): x is string => !!x && x !== args.userId))];
  if (to.length === 0) return;
  const month = kpiPeriodLabel(args.period);
  await prisma.notification.createMany({
    data: to.map((managerId) => ({
      userId: managerId,
      type: "kpi_submitted",
      title: `${nameOf(me)} recorded their KPIs for ${month}`,
      message: `${args.count} ${args.count === 1 ? "number is" : "numbers are"} waiting for you.`,
      link: `/team/kpi-reviews?person=${args.userId}&period=${args.period}`,
    })),
  }).catch(() => undefined);
}

/** A manager decided on a submitted number. */
export async function notifyKpiDecision(args: { userId: string; actorId: string; kpiName: string; period: string; decision: "approve" | "request_changes"; notes?: string | null }): Promise<void> {
  const actor = await prisma.user.findUnique({ where: { id: args.actorId }, select: { firstName: true, lastName: true, email: true } });
  const month = kpiPeriodLabel(args.period);
  if (args.decision === "approve") {
    await prisma.notification.create({
      data: {
        userId: args.userId,
        type: "kpi_approved",
        title: `Your ${month} number for ${args.kpiName} was approved`,
        message: `${nameOf(actor)} approved it.`,
        link: "/people/me?tab=kras",
      },
    }).catch(() => undefined);
    return;
  }
  await prisma.notification.create({
    data: {
      userId: args.userId,
      type: "kpi_changes_requested",
      title: `${nameOf(actor)} asked for a change on ${args.kpiName}`,
      message: args.notes ? args.notes.slice(0, 500) : `Your ${month} number needs a change.`,
      link: "/people/me?tab=kras",
    },
  }).catch(() => undefined);
}

/** A manager recorded numbers on someone's behalf. */
export async function notifyKpiRecordedForYou(args: { userId: string; actorId: string; period: string; count: number }): Promise<void> {
  if (args.count <= 0 || args.userId === args.actorId) return;
  const actor = await prisma.user.findUnique({ where: { id: args.actorId }, select: { firstName: true, lastName: true, email: true } });
  await prisma.notification.create({
    data: {
      userId: args.userId,
      type: "kpi_recorded_for_you",
      title: `${nameOf(actor)} recorded your ${kpiPeriodLabel(args.period)} numbers`,
      message: `${args.count} ${args.count === 1 ? "number was" : "numbers were"} recorded for you.`,
      link: "/people/me?tab=kras",
    },
  }).catch(() => undefined);
}
