// The ONE verdict of many goals, for every surface that shows it (the list,
// the goal page, the profile and the assess route), so a repeating goal
// reads the same word everywhere (docs/plans/recurring-goals.md E4).
//
// Each caller hands the goals it holds and the org rollup it read; this
// reads, in two queries whatever the number of goals, each target's newest
// check-in (a one-time goal's staleness) and each repeating goal's newest
// check-in INTO its current period, and paces a repeating goal over its
// current open period from trackedFrom. One-time goals read exactly as
// before.

import { prisma } from "@/lib/prisma";
import { goalRollupFor, type GoalRollupContext } from "@/lib/alignment";
import { verdictForGoal, type VerdictPeriod } from "@/lib/goal-verdict";
import { isMeasuredAutomatically } from "@/lib/goals/goal-measure";
import { periodAt } from "@/lib/goals/goal-period";

export interface VerdictGoalInput {
  id: string;
  progress: number;
  status: string;
  startDate: Date | string | null;
  endDate: Date | string | null;
  createdAt: Date | string;
  completedAt?: Date | string | null;
  checkInCadence: string | null;
  repeat?: string | null;
  keyResults: ReadonlyArray<{ id: string; kpiId: string | null; source?: unknown }>;
}

export type GoalVerdictResult = ReturnType<typeof verdictForGoal>;

export async function goalVerdicts(
  ctx: GoalRollupContext,
  goals: readonly VerdictGoalInput[],
  linked: { has(id: string): boolean },
  now: Date = new Date(),
): Promise<{ verdicts: Map<string, GoalVerdictResult>; lastByKr: Map<string, Date | null> }> {
  const krIds = goals.flatMap((g) => g.keyResults.map((k) => k.id));
  // The period running now of each repeating goal (pace and staleness, E4).
  const running = new Map<string, { id: string; trackedFrom: Date; endsAt: Date }>();
  for (const g of goals) {
    if (!g.repeat) continue;
    const p = periodAt(ctx.periods.get(g.id) ?? [], now);
    if (p && p.status === "OPEN") running.set(g.id, { id: p.id, trackedFrom: p.trackedFrom, endsAt: p.endsAt });
  }
  const periodIds = [...running.values()].map((p) => p.id);
  const [byKr, byPeriod] = await Promise.all([
    krIds.length
      ? prisma.kRCheckIn.groupBy({ by: ["keyResultId"], where: { keyResultId: { in: krIds } }, _max: { createdAt: true } })
      : Promise.resolve([] as Array<{ keyResultId: string; _max: { createdAt: Date | null } }>),
    periodIds.length
      ? prisma.kRCheckIn.groupBy({ by: ["periodId"], where: { periodId: { in: periodIds } }, _max: { createdAt: true } })
      : Promise.resolve([] as Array<{ periodId: string | null; _max: { createdAt: Date | null } }>),
  ]);
  const lastByKr = new Map(byKr.map((r) => [r.keyResultId, r._max.createdAt]));
  const lastByPeriod = new Map(byPeriod.map((r) => [r.periodId, r._max.createdAt]));
  const verdicts = new Map<string, GoalVerdictResult>();
  for (const g of goals) {
    const rollup = goalRollupFor(ctx, g);
    const p = running.get(g.id);
    const period: VerdictPeriod | null = p ? { trackedFrom: p.trackedFrom, endsAt: p.endsAt, lastCheckInAt: lastByPeriod.get(p.id) ?? null } : null;
    verdicts.set(g.id, verdictForGoal({
      goal: g,
      rollup: { progress: rollup.progress, source: rollup.source },
      targets: g.keyResults.map((k) => ({ lastCheckInAt: lastByKr.get(k.id) ?? null, derived: isMeasuredAutomatically(k) })),
      hasLinkedWork: linked.has(g.id),
      period,
    }, now));
  }
  return { verdicts, lastByKr };
}
