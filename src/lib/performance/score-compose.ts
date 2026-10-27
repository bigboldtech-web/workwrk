// The performance score's composite, from the inputs it has (pure). Split out
// of src/services/performanceScoreService.ts so the close patch of a
// repeating goal's period (src/lib/goals/goal-period-score.server.ts,
// docs/plans/recurring-goals.md G2) re-composes a stored month's total from
// that month's STORED breakdown with the same rule, without importing the
// service (which reads the goal parts from that module).

export interface ScoreWeights {
  kpi: number;
  manager: number;
  peer: number;
  self: number;
  sopCompliance: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  kpi: 40,
  manager: 25,
  peer: 10,
  self: 5,
  sopCompliance: 20,
};

/** The score weights Settings stores (organization.settings.scoreWeights), each falling back to its default. */
export function scoreWeightsOf(orgSettings: unknown): ScoreWeights {
  const settings = (orgSettings as Record<string, unknown> | null) || {};
  const sw = settings.scoreWeights as Record<string, number> | undefined;
  if (!sw) return DEFAULT_WEIGHTS;
  return {
    kpi: sw.kpi ?? DEFAULT_WEIGHTS.kpi,
    manager: sw.manager ?? DEFAULT_WEIGHTS.manager,
    peer: sw.peer ?? DEFAULT_WEIGHTS.peer,
    self: sw.self ?? DEFAULT_WEIGHTS.self,
    sopCompliance: sw.sopCompliance ?? DEFAULT_WEIGHTS.sopCompliance,
  };
}

/**
 * The composite from the inputs that exist, or null when none does. Pure.
 *
 * Null is not 0: a member with no KPI numbers, no reviews, no peer
 * feedback, no SOP results, no goals and no tasks has nothing to score, and
 * a stored 0 reads "At risk" on their record, in Talent's Fill from scores
 * and on every dashboard, a verdict with nothing behind it (a welcome kudos
 * to a new hire was enough to trigger that recalculation). The kudos bonus
 * is a bonus on a measured score, not a measure of its own, so kudos alone
 * is still no score.
 */
export function composeScore(
  inputs: {
    kpiScore: number | null;
    managerRating: number | null;
    peerRating: number | null;
    selfRating: number | null;
    sopCompliance: number | null;
    okrScore: number | null;
    taskScore: number | null;
    kudosBonus: number;
  },
  weights: ScoreWeights
): number | null {
  const { kpiScore, managerRating, peerRating, selfRating, sopCompliance, okrScore, taskScore, kudosBonus } = inputs;
  const components: { value: number; weight: number }[] = [];
  if (kpiScore != null) components.push({ value: kpiScore, weight: weights.kpi });
  if (managerRating != null) components.push({ value: managerRating, weight: weights.manager });
  if (peerRating != null) components.push({ value: peerRating, weight: weights.peer });
  if (selfRating != null) components.push({ value: selfRating, weight: weights.self });
  if (sopCompliance != null) components.push({ value: sopCompliance, weight: weights.sopCompliance });
  // OKR and task scores contribute as bonuses (up to 5 points each)
  if (okrScore != null) components.push({ value: okrScore, weight: 10 });
  if (taskScore != null) components.push({ value: taskScore, weight: 5 });

  if (components.length === 0) return null;
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  // Every weight set to 0 in Settings leaves nothing weighted: no score,
  // rather than a NaN written to the row.
  if (totalWeight <= 0) return null;
  const composite = Math.round(
    components.reduce((sum, c) => sum + (c.value * c.weight) / totalWeight, 0)
  );
  return Math.min(Math.max(composite + kudosBonus, 0), 100);
}
