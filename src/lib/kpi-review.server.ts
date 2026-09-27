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

export async function kpiActorCtx(): Promise<PeopleCtx | null> {
  return peopleCtx();
}

/** May `ctx` record on behalf of, approve or send back `subjectId`'s numbers? */
export function mayActOnKpisOf(ctx: PeopleCtx, subjectId: string): boolean {
  if (ctx.isAgent && !ctx.chain.has(subjectId)) return false;
  const rel = relationTo(ctx, subjectId);
  return rel === "admin" || rel === "people-team" || rel === "org-wide" || rel === "chain" || rel === "chain-view";
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
