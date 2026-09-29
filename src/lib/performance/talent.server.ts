// The talent grid on the server (spec-teams-performance /talent): who the
// viewer may see and place, the bounded period list, and Fill from scores.
//
// Scope (the `talent` APP_RULES row): the People team, Owner and Admin see
// the org; anyone with reports sees their chain (solid plus dotted); nobody
// else sees anything. NEVER THEMSELF (DECIDED: a person does not see their
// own 9-box placement), whoever they are.
//
// Server only.

import { prisma } from "@/lib/prisma";
import { cycleViewerCtx, orgScoring, type CycleViewerCtx } from "./review-cycle.server";
import { performanceLevel } from "./review-cycle";
import { fiscalQuarterOf } from "@/lib/fiscal-quarter";
import { talentPeriodList } from "./talent";

export interface TalentCtx extends CycleViewerCtx {
  /** null = the org (self excluded); otherwise the chain. */
  ids: string[] | null;
  allowed: boolean;
}

export async function talentCtx(): Promise<TalentCtx | null> {
  const c = await cycleViewerCtx();
  if (!c || c.isGuest) return null;
  if (c.peopleTeamOrAdmin) return { ...c, ids: null, allowed: true };
  const ids = [...c.chain];
  return { ...c, ids, allowed: ids.length > 0 };
}

/** The user where clause for the people in scope (active, never the viewer). */
export function scopeUserWhere(ctx: TalentCtx) {
  return {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(ctx.ids === null ? { id: { not: ctx.userId } } : { id: { in: ctx.ids.filter((id) => id !== ctx.userId) } }),
  };
}

/** The current fiscal quarter's label and the four of its year. */
export async function fiscalQuarters(organizationId: string, now = new Date()): Promise<{ current: string; year: string[] }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  const fiscalStart = ((org?.settings ?? {}) as Record<string, unknown>).fiscalYearStart;
  const cur = fiscalQuarterOf(now, fiscalStart);
  return { current: `Q${cur.quarter} ${cur.yearLabel}`, year: [1, 2, 3, 4].map((q) => `Q${q} ${cur.yearLabel}`) };
}

export async function talentPeriods(ctx: TalentCtx): Promise<{ periods: Array<{ key: string; count: number }>; current: string }> {
  const q = await fiscalQuarters(ctx.organizationId);
  const [used, cycles] = await Promise.all([
    prisma.talentAssessment.groupBy({
      by: ["period"],
      where: { organizationId: ctx.organizationId, userId: ctx.ids === null ? { not: ctx.userId } : { in: ctx.ids } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.reviewCycle.findMany({ where: { organizationId: ctx.organizationId, status: "COMPLETED" }, select: { name: true, endDate: true }, orderBy: { endDate: "desc" }, take: 20 }),
  ]);
  const periods = talentPeriodList({
    currentQuarter: q.current,
    yearQuarters: q.year,
    used: used.map((u) => ({ period: u.period, lastUsed: u._max.updatedAt?.getTime() ?? 0, count: u._count._all })),
    cycleNames: cycles.map((c) => ({ name: c.name, endedAt: c.endDate.getTime() })),
  });
  return { periods, current: q.current };
}

/**
 * Fill from scores: one placement per person in scope who has a
 * performance score and no placement for the period. Performance comes
 * from the score through Settings > Performance bands; potential is Medium
 * until someone decides. Never overwrites a placement, never the viewer.
 * `dryRun` counts without writing (the confirm names the number).
 */
export async function fillFromScores(ctx: TalentCtx, period: string, opts: { dryRun?: boolean } = {}): Promise<{ placed: number; skipped: number }> {
  const [people, placed, scoring] = await Promise.all([
    prisma.user.findMany({ where: scopeUserWhere(ctx), select: { id: true } }),
    prisma.talentAssessment.findMany({ where: { organizationId: ctx.organizationId, period }, select: { userId: true } }),
    orgScoring(ctx.organizationId),
  ]);
  const have = new Set(placed.map((p) => p.userId));
  const open = people.map((p) => p.id).filter((id) => !have.has(id));
  if (!open.length) return { placed: 0, skipped: 0 };
  const scores = await prisma.performanceScore.findMany({
    where: { organizationId: ctx.organizationId, userId: { in: open } },
    orderBy: { period: "desc" },
    distinct: ["userId"],
    select: { userId: true, score: true },
  });
  const rows = scores
    .map((s) => ({ userId: s.userId, performance: performanceLevel(s.score, scoring.bands) }))
    .filter((r): r is { userId: string; performance: 1 | 2 | 3 } => r.performance != null);
  const skipped = open.length - rows.length;
  if (opts.dryRun || !rows.length) return { placed: rows.length, skipped };
  const res = await prisma.talentAssessment.createMany({
    data: rows.map((r) => ({
      userId: r.userId,
      period,
      performance: r.performance,
      potential: 2,
      boxPosition: `${r.performance}-2`,
      action: null,
      notes: "Auto-placed from performance score",
      source: "SCORES",
      assessedBy: ctx.userId,
      organizationId: ctx.organizationId,
    })),
    skipDuplicates: true,
  });
  return { placed: res.count, skipped };
}
