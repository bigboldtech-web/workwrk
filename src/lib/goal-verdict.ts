// The ONE "on track?" verdict for a goal (spec-goals section 3, GoalVerdict).
//
// Every surface that says whether a goal is on track asks this file: the
// /okrs rows and the Team goals person headers (GET /api/okrs), the goal
// page's summary card (GET /api/okrs/[id]/assess), the profile Goals section
// and the review-cycle self tab. Before this file there were two answers on
// one page: the list and the header chip read pure absolute progress
// (okrStatusFor: 30% done in week one read "Behind"), while the On track?
// card read pace. Now the pace rule is the rule, deterministic, and the AI
// (when it runs) only writes the narrative around the verdict this returns;
// it can never change the word.
//
// The rules, in order:
//   completed     marked complete (OKR.completedAt) or progress reached 100
//   not_measured  nothing measurable yet (no targets, no rolled-up children,
//                 nothing hand-set)
//   off_track     more than 25 points behind the share of time used
//   at_risk       more than 10 points behind pace, OR the check-in is overdue
//                 for the goal's cadence, OR past 60% of the time with no
//                 linked work moving it
//   on_track      otherwise
//
// Staleness (goalStaleness) is also one rule: a goal whose cadence is None
// is never stale (the detail page and the assessment disagreed before); a
// goal with no check-in yet is measured from the day it was created, so a
// goal made this morning is not "overdue"; a goal whose every target is
// fed by a KPI cannot be checked in by hand, so it is never stale either.
//
// Pure: no Prisma, no React.

export type GoalVerdict = "on_track" | "at_risk" | "off_track" | "completed" | "not_measured";
export type VerdictTone = "success" | "warning" | "danger" | "info" | "neutral";

export const GOAL_VERDICTS: readonly GoalVerdict[] = ["on_track", "at_risk", "off_track", "completed", "not_measured"];

const DAY_MS = 24 * 60 * 60 * 1000;
export const CADENCE_DAYS: Readonly<Record<string, number>> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 31 };

export interface GoalSignals {
  /** Rolled-up progress 0..100, or null when nothing is measured. */
  progress: number | null;
  /** computeGoalRollups' source: ROLLUP, MANUAL or NONE. */
  progressSource: string;
  /** Share of the goal's time window used, 0..100, or null with no dates. */
  pctTimeElapsed: number | null;
  daysLeft: number | null;
  isStale: boolean;
  hasLinkedWork: boolean;
  /** Marked complete by a person (OKR.completedAt). */
  markedComplete: boolean;
}

/** The deterministic verdict. */
export function assessGoal(s: GoalSignals): GoalVerdict {
  const measured = s.progressSource !== "NONE" && s.progress != null;
  if (s.markedComplete || (measured && (s.progress ?? 0) >= 100)) return "completed";
  if (!measured) return "not_measured";
  const progress = s.progress as number;
  const gap = s.pctTimeElapsed != null ? progress - s.pctTimeElapsed : null;
  if (gap != null && gap < -25) return "off_track";
  if (gap != null && gap < -10) return "at_risk";
  if (s.isStale) return "at_risk";
  if (s.pctTimeElapsed != null && s.pctTimeElapsed > 60 && !s.hasLinkedWork) return "at_risk";
  return "on_track";
}

/** Pace: how far through its window the goal is. */
export function goalTimeSignals(g: {
  startDate: Date | string | null | undefined;
  endDate: Date | string | null | undefined;
  createdAt?: Date | string | null;
}, now: Date = new Date()): { pctTimeElapsed: number | null; daysLeft: number | null } {
  const t = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).getTime());
  const end = t(g.endDate);
  const start = t(g.startDate) ?? t(g.createdAt ?? null);
  if (end == null || start == null || !Number.isFinite(end) || !Number.isFinite(start) || end <= start) {
    return { pctTimeElapsed: null, daysLeft: end != null && Number.isFinite(end) ? Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)) : null };
  }
  const pct = Math.round(Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))) * 100);
  return { pctTimeElapsed: pct, daysLeft: Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)) };
}

/** Is the goal's check-in overdue for its cadence? */
export function goalStaleness(g: {
  cadence: string | null | undefined;
  lastCheckInAt: Date | string | null | undefined;
  createdAt: Date | string | null | undefined;
  completed: boolean;
  /** Every target is fed by a KPI: nothing to check in by hand. */
  allDerived?: boolean;
}, now: Date = new Date()): { isStale: boolean; daysSinceCheckin: number | null } {
  const last = g.lastCheckInAt != null ? new Date(g.lastCheckInAt).getTime() : null;
  const daysSinceCheckin = last != null && Number.isFinite(last) ? Math.floor((now.getTime() - last) / DAY_MS) : null;
  const days = CADENCE_DAYS[(g.cadence ?? "").toUpperCase()];
  if (g.completed || !days || g.allDerived) return { isStale: false, daysSinceCheckin };
  const from = last ?? (g.createdAt != null ? new Date(g.createdAt).getTime() : null);
  if (from == null || !Number.isFinite(from)) return { isStale: false, daysSinceCheckin };
  return { isStale: now.getTime() - from > days * DAY_MS, daysSinceCheckin };
}

/** Everything a caller holds about a goal, to one verdict. */
export function goalVerdictFor(g: {
  progress: number;
  progressSource: string;
  startDate: Date | string | null | undefined;
  endDate: Date | string | null | undefined;
  createdAt: Date | string | null | undefined;
  completedAt?: Date | string | null;
  checkInCadence: string | null | undefined;
  lastCheckInAt: Date | string | null | undefined;
  allDerived?: boolean;
  hasLinkedWork: boolean;
}, now: Date = new Date()): { verdict: GoalVerdict; signals: GoalSignals; daysSinceCheckin: number | null } {
  const measured = g.progressSource !== "NONE";
  const markedComplete = g.completedAt != null;
  const completed = markedComplete || (measured && g.progress >= 100);
  const time = goalTimeSignals(g, now);
  const stale = goalStaleness({ cadence: g.checkInCadence, lastCheckInAt: g.lastCheckInAt, createdAt: g.createdAt, completed, allDerived: g.allDerived }, now);
  const signals: GoalSignals = {
    progress: measured ? g.progress : null,
    progressSource: g.progressSource,
    pctTimeElapsed: time.pctTimeElapsed,
    daysLeft: time.daysLeft,
    isStale: stale.isStale,
    hasLinkedWork: g.hasLinkedWork,
    markedComplete,
  };
  return { verdict: assessGoal(signals), signals, daysSinceCheckin: stale.daysSinceCheckin };
}

const CHIP: Record<GoalVerdict, { tone: VerdictTone; label: string }> = {
  on_track: { tone: "success", label: "On track" },
  at_risk: { tone: "warning", label: "At risk" },
  off_track: { tone: "danger", label: "Off track" },
  completed: { tone: "info", label: "Completed" },
  not_measured: { tone: "neutral", label: "Not measured" },
};

export function verdictChip(v: GoalVerdict): { tone: VerdictTone; label: string } {
  return CHIP[v] ?? CHIP.not_measured;
}

/** Attention order: the worst first (a person header shows the worst open goal). */
const RANK: Record<GoalVerdict, number> = { off_track: 0, at_risk: 1, on_track: 2, not_measured: 3, completed: 4 };
export function verdictRank(v: GoalVerdict): number {
  return RANK[v] ?? 5;
}

/**
 * A person's rolled-up verdict over their goals: the worst open one,
 * "completed" only when all are completed, null when they have none.
 */
export function rollupVerdict(vs: readonly GoalVerdict[]): GoalVerdict | null {
  if (vs.length === 0) return null;
  const open = vs.filter((v) => v !== "completed");
  if (open.length === 0) return "completed";
  return [...open].sort((a, b) => verdictRank(a) - verdictRank(b))[0];
}

/** The plain narrative for a verdict when no AI writes one (no em dashes). */
export function verdictNarrative(v: GoalVerdict, s: {
  progress: number | null; pctTimeElapsed: number | null; daysLeft: number | null;
  isStale: boolean; daysSinceCheckin: number | null; hasLinkedWork: boolean;
  totalHours: number; tasksOpen: number; tasksDone: number;
}): { headline: string; reasons: string[]; recommendation: string } {
  const reasons: string[] = [];
  if (s.progress != null && s.pctTimeElapsed != null) reasons.push(`${s.progress}% done with ${s.pctTimeElapsed}% of the time used.`);
  else if (s.progress != null) reasons.push(`${s.progress}% done.`);
  else reasons.push("No target has a number yet.");
  if (s.isStale) reasons.push(s.daysSinceCheckin != null ? `Last check-in was ${s.daysSinceCheckin} days ago.` : "No check-in yet.");
  if (s.hasLinkedWork) reasons.push(`${s.totalHours}h logged, ${s.tasksDone} done and ${s.tasksOpen} open on linked work.`);
  else reasons.push("No linked work is moving this goal.");
  const headline =
    v === "completed" ? "This goal is complete."
      : v === "on_track" ? "On track for the due date."
        : v === "off_track" ? "Well behind pace. It needs attention."
          : v === "not_measured" ? "Not measured yet. Add a target to track it."
            : "Slipping. A few risk signals.";
  const recommendation =
    v === "completed" ? "Nothing to do. Start the next goal when you are ready."
      : v === "not_measured" ? "Add a target with a start and a goal number."
        : v === "on_track" ? "Keep the check-in rhythm and the current pace."
          : !s.hasLinkedWork ? "Link the List, Space or KRA doing the work so effort is tracked."
            : s.isStale ? "Check in so each target shows where it stands."
              : "Re-plan the lagging targets or add capacity.";
  return { headline, reasons: reasons.slice(0, 3), recommendation };
}

/**
 * The adapter both the list and the goal page call, from the rows they
 * already hold: the goal, its rolled-up progress, one entry per target (its
 * newest check-in and whether a KPI feeds it) and whether any work is linked.
 * The list gathers the targets' newest check-ins in one batched query and
 * the page reads them per goal; both hand the same shape here, so the two
 * can only disagree if their inputs do.
 */
export function verdictForGoal(input: {
  goal: {
    startDate: Date | string | null | undefined;
    endDate: Date | string | null | undefined;
    createdAt: Date | string | null | undefined;
    completedAt?: Date | string | null;
    checkInCadence: string | null | undefined;
  };
  rollup: { progress: number; source: string };
  targets: ReadonlyArray<{ lastCheckInAt: Date | string | null | undefined; derived: boolean }>;
  hasLinkedWork: boolean;
}, now: Date = new Date()): { verdict: GoalVerdict; signals: GoalSignals; daysSinceCheckin: number | null } {
  let last: number | null = null;
  for (const t of input.targets) {
    if (t.lastCheckInAt == null) continue;
    const ms = new Date(t.lastCheckInAt).getTime();
    if (Number.isFinite(ms) && (last == null || ms > last)) last = ms;
  }
  // Nothing to check in by hand (no targets, or every target fed by a
  // KPI): the goal is never "overdue for a check-in".
  const allDerived = input.targets.every((t) => t.derived);
  return goalVerdictFor({
    progress: input.rollup.progress,
    progressSource: input.rollup.source,
    startDate: input.goal.startDate,
    endDate: input.goal.endDate,
    createdAt: input.goal.createdAt,
    completedAt: input.goal.completedAt ?? null,
    checkInCadence: input.goal.checkInCadence,
    lastCheckInAt: last == null ? null : new Date(last),
    allDerived,
    hasLinkedWork: input.hasLinkedWork,
  }, now);
}
