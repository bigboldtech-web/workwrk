// The period a repeating goal shows for now, by name, for the outside
// readers (docs/plans/recurring-goals.md I): the MCP server's list_my_goals
// and Ask AI's search_okrs. Their numbers (progress, status, each target's
// currentValue) already are the current period's (the KeyResult mirror,
// B8); this says which period that is.
//
// Reads only, two queries whatever the number of goals (the workspace's
// settings, and each goal's newest started period). It never opens a
// period: the goal-periods cron and every in-app read do, so a period that
// began minutes ago can read as the one before until then.

import { prisma } from "@/lib/prisma";
import { isGoalCadence, periodLabel, periodSettingsOf } from "@/lib/goals/goal-period";

export interface CurrentPeriodName {
  key: string;
  /** "October 2026", "Week of 26 Oct", "Q3 FY27", "FY27". */
  label: string;
  startsAt: Date;
  /** Exclusive: the first instant of the next period. */
  endsAt: Date;
}

/**
 * Each repeating goal's current period: the stored one holding now, else the
 * newest that has started (one in its grace, or an ended goal's last). A
 * period opens only once it has started, so the newest started is the one
 * holding now whenever one does.
 */
export async function currentPeriodNames(
  orgId: string,
  goals: ReadonlyArray<{ id: string; repeat?: string | null }>,
  now: Date = new Date(),
): Promise<Map<string, CurrentPeriodName>> {
  const out = new Map<string, CurrentPeriodName>();
  const ids = goals.filter((g) => isGoalCadence(g.repeat)).map((g) => g.id);
  if (ids.length === 0) return out;
  const [org, periods] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
    prisma.goalPeriod.findMany({
      where: { okrId: { in: ids }, organizationId: orgId, startsAt: { lte: now } },
      orderBy: [{ okrId: "asc" }, { startsAt: "desc" }],
      distinct: ["okrId"],
      select: { okrId: true, key: true, cadence: true, startsAt: true, endsAt: true },
    }),
  ]);
  const s = periodSettingsOf(org?.settings);
  for (const p of periods) {
    if (!isGoalCadence(p.cadence) || out.has(p.okrId)) continue;
    out.set(p.okrId, { key: p.key, label: periodLabel({ key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt }, s, now), startsAt: p.startsAt, endsAt: p.endsAt });
  }
  return out;
}
