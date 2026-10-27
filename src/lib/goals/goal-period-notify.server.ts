// The Inbox rows of repeating goals (docs/plans/recurring-goals.md F).
//
//   goal_period_started  ONE row per owner per day, for the periods that
//                        began today on their own (not a goal made today) of
//                        goals with a hand-checked target: "3 goals started
//                        October 2026", to /okrs. Written by the goal-periods
//                        cron, every run; the row's id is the owner and the
//                        day, so the later runs of that day add nothing
//                        (ON CONFLICT DO NOTHING) and two runs racing write
//                        one row.
//   goal_period_closed   ONE row per owner per cron run, for the periods
//                        whose close (and score patch) that run finished:
//                        "October results: 3 hit, 1 missed", to /okrs, or to
//                        the goal's period when there is one goal.
//   The end nudge        okr_check_in_due, written by the okr-reminders cron
//                        (its words are here, endNudgeWords).
//
// No email for either digest. Contributors are not notified; managers read
// results on Team goals.

import { prisma } from "@/lib/prisma";
import {
  isGoalCadence,
  periodLabel,
  periodSettingsOf,
  startOfZonedDay,
  RESULT_LABEL,
  type GoalCadence,
  type GoalPeriodRange,
  type GoalResult,
  type PeriodSettings,
} from "@/lib/goals/goal-period";
import { isMeasuredAutomatically } from "@/lib/goals/goal-measure";
import { MONTH_NAMES } from "@/lib/settings/org-policy";
import { zonedDateKey } from "@/lib/zoned-time";

/* ───────────────────────── Words (pure) ───────────────────────── */

/** The month a monthly period stands for, by name alone ("October"), from its own label. */
function monthName(label: string): string {
  const word = label.split(" ")[0];
  return (MONTH_NAMES as readonly string[]).includes(word) ? word : label;
}

/** "the week of 26 Oct", "October 2026", "Q3 FY27", "FY27": a period inside a sentence that started it. */
export function startedPhrase(p: GoalPeriodRange, s: PeriodSettings, now: Date): string {
  const label = periodLabel(p, s, now);
  return p.cadence === "WEEKLY" ? `the w${label.slice(1)}` : label;
}

/** "October", "Week of 26 Oct", "Q3 FY27": what a results row or an end nudge calls a period. */
export function shortPeriodName(p: GoalPeriodRange, s: PeriodSettings, now: Date): string {
  const label = periodLabel(p, s, now);
  return p.cadence === "MONTHLY" ? monthName(label) : label;
}

/** The titles of a few goals, then how many more: "Sales calls, Hiring and 3 more". */
export function goalNames(titles: readonly string[], max = 3): string {
  const shown = titles.slice(0, max);
  const rest = titles.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 goals started October 2026" (one name), "4 goals started new periods" (several). */
export function startedTitle(phrases: readonly string[]): string {
  const names = [...new Set(phrases)];
  const count = plural(phrases.length, "goal", "goals");
  return names.length === 1 ? `${count} started ${names[0]}` : `${count} started new periods`;
}

const RESULT_ORDER: GoalResult[] = ["HIT", "PARTLY_HIT", "MISSED", "NOT_MEASURED"];

/** "3 hit, 1 partly hit, 1 missed": the results, in that order, the ones with none left out. */
export function resultCounts(results: readonly (string | null)[]): string {
  const n = new Map<GoalResult, number>();
  for (const r of results) {
    const k = (r && (RESULT_ORDER as string[]).includes(r) ? r : "NOT_MEASURED") as GoalResult;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return RESULT_ORDER.filter((k) => n.get(k)).map((k) => `${n.get(k)} ${RESULT_LABEL[k].toLowerCase()}`).join(", ");
}

/** "October results: 3 hit, 1 missed" (one name), "Goal results: ..." (several). */
export function resultsTitle(names: readonly string[], results: readonly (string | null)[]): string {
  const unique = [...new Set(names)];
  return `${unique.length === 1 ? unique[0] : "Goal"} results: ${resultCounts(results)}`;
}

const UNIT: Record<GoalCadence, string> = { WEEKLY: "week", MONTHLY: "month", QUARTERLY: "quarter", YEARLY: "year" };

/**
 * The end nudge (F): "October ends in 2 days. Add this month's numbers.",
 * "ends tomorrow", "ends today"; and the line under it, the goal's name.
 */
export function endNudgeWords(p: GoalPeriodRange, daysLeft: number, goalTitle: string, s: PeriodSettings, now: Date): { title: string; message: string } {
  const name = shortPeriodName(p, s, now);
  const when = daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  const unit = UNIT[p.cadence];
  return { title: `${name} ends ${when}. Add this ${unit}'s numbers.`, message: `${goalTitle}: no check-in yet this ${unit}.` };
}

/* ───────────────────────── The digests ───────────────────────── */

async function settingsOf(orgId: string): Promise<PeriodSettings> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return periodSettingsOf(org?.settings);
}

/** A notification id made of [A-Za-z0-9_-] only (the Inbox's id rule), at most 64 long. */
function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${parts.map((p) => p.replace(/[^A-Za-z0-9-]/g, "")).join("_")}`.slice(0, 64);
}

/**
 * goal_period_started: one row per owner for today (the workspace's day),
 * naming the periods that began today on their own. Returns the rows written
 * (0 when an earlier run today already wrote them).
 */
export async function notifyPeriodsStarted(orgId: string, now: Date = new Date()): Promise<number> {
  const s = await settingsOf(orgId);
  const today = zonedDateKey(now, s.timezone);
  const periods = await prisma.goalPeriod.findMany({
    where: { organizationId: orgId, status: "OPEN", startsAt: { gte: startOfZonedDay(today, s.timezone), lte: now } },
    select: {
      id: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true,
      okr: { select: { id: true, title: true, ownerId: true, completedAt: true, keyResults: { select: { kpiId: true, source: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });
  const byOwner = new Map<string, Array<{ title: string; phrase: string }>>();
  for (const p of periods) {
    const g = p.okr;
    // A period that began on its own: not the first period of a goal made
    // (or converted) after it began, which its maker already knows about.
    if (!g?.ownerId || g.completedAt || !isGoalCadence(p.cadence) || p.trackedFrom.getTime() !== p.startsAt.getTime()) continue;
    if (!g.keyResults.some((k) => !isMeasuredAutomatically(k))) continue;
    const range = { key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt };
    const list = byOwner.get(g.ownerId);
    const item = { title: g.title, phrase: startedPhrase(range, s, now) };
    if (list) list.push(item);
    else byOwner.set(g.ownerId, [item]);
  }
  if (byOwner.size === 0) return 0;
  const written = await prisma.notification.createMany({
    data: [...byOwner].map(([userId, goals]) => ({
      id: stableId("gps", today, userId),
      userId,
      type: "goal_period_started",
      title: startedTitle(goals.map((g) => g.phrase)),
      message: goalNames(goals.map((g) => g.title)),
      link: "/okrs",
    })),
    skipDuplicates: true,
  });
  return written.count;
}

/**
 * goal_period_closed: one row per owner for the periods this run closed and
 * patched. With one goal the row opens that goal at the period; with more,
 * the goals list.
 */
export async function notifyPeriodResults(orgId: string, periodIds: readonly string[], now: Date = new Date()): Promise<number> {
  if (periodIds.length === 0) return 0;
  const s = await settingsOf(orgId);
  const periods = await prisma.goalPeriod.findMany({
    where: { id: { in: [...periodIds] }, organizationId: orgId, status: "CLOSED" },
    select: { id: true, key: true, cadence: true, startsAt: true, endsAt: true, result: true, okr: { select: { id: true, title: true, ownerId: true } } },
    orderBy: { startsAt: "asc" },
  });
  const byOwner = new Map<string, Array<{ okrId: string; key: string; title: string; name: string; result: string | null }>>();
  for (const p of periods) {
    const g = p.okr;
    if (!g?.ownerId || !isGoalCadence(p.cadence)) continue;
    const range = { key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt };
    const item = { okrId: g.id, key: p.key, title: g.title, name: shortPeriodName(range, s, now), result: p.result };
    const list = byOwner.get(g.ownerId);
    if (list) list.push(item);
    else byOwner.set(g.ownerId, [item]);
  }
  if (byOwner.size === 0) return 0;
  const written = await prisma.notification.createMany({
    data: [...byOwner].map(([userId, closed]) => {
      const goals = new Set(closed.map((c) => c.okrId));
      const one = goals.size === 1 ? closed[closed.length - 1] : null;
      return {
        userId,
        type: "goal_period_closed",
        title: resultsTitle(closed.map((c) => c.name), closed.map((c) => c.result)),
        message: goalNames([...new Set(closed.map((c) => c.title))]),
        link: one ? `/okrs/${one.okrId}?period=${one.key}` : "/okrs",
      };
    }),
  });
  return written.count;
}

/** The end nudge's id: one per period, so the later runs inside its last days add nothing. */
export function endNudgeId(periodId: string): string {
  return stableId("gpe", periodId);
}
