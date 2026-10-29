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
//   The end nudge        okr_check_in_due, written by the okr-reminders cron,
//                        one row per owner per period end (its words and its
//                        id are here, endNudgeWords and endNudgeId).
//
// No email for either digest. Contributors are not notified; managers read
// results on Team goals.
//
// ONLY PEOPLE WHO STILL WORK HERE (final review, privacy M1). A goal's
// ownerId is never cleared when its owner leaves, is deactivated or is
// removed from the workspace, and the Inbox shows a person's rows from every
// workspace (a Notification has no workspace), so every row here, the end
// nudge's and the stale check-in rows of okr-reminders too, goes only to
// people who are not deleted, not deactivated and hold a level in the
// goal's workspace (liveRecipients), as goal_source_paused does.
//
// ONE ROW PER OWNER PER WORKSPACE. The started row's id and the end nudge's
// id name the workspace too (a digest of the workspace and the person), so
// an owner with goals in two workspaces gets each workspace's row that day.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { inWorkspaceWhere } from "@/lib/access/acting-workspace";
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
 * The end nudge (F), one row for an owner's goals whose periods end the same
 * day: "October ends in 2 days. Add this month's numbers." ("ends
 * tomorrow", "ends today"), and under it "Sales calls: a target has no
 * check-in this month." for one goal, or the goals named as the digests name
 * them for several ("Sales calls, Hiring and 3 more each have a target with
 * no check-in this month."). Periods of different kinds ending that day (a
 * month and a quarter) read "Your periods end in 2 days."
 */
export function endNudgeWords(
  goals: ReadonlyArray<{ title: string; range: GoalPeriodRange }>,
  daysLeft: number,
  s: PeriodSettings,
  now: Date,
): { title: string; message: string } {
  const when = daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  const names = [...new Set(goals.map((g) => shortPeriodName(g.range, s, now)))];
  const units = [...new Set(goals.map((g) => UNIT[g.range.cadence]))];
  const unit = units.length === 1 ? units[0] : "period";
  const title = names.length === 1 ? `${names[0]} ends ${when}. Add this ${unit}'s numbers.` : `Your periods end ${when}. Add their numbers.`;
  const message = goals.length === 1
    ? `${goals[0].title}: a target has no check-in this ${unit}.`
    : `${goalNames(goals.map((g) => g.title))} each have a target with no check-in this ${unit}.`;
  return { title, message };
}

/* ───────────────────────── The digests ───────────────────────── */

async function settingsOf(orgId: string): Promise<PeriodSettings> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return periodSettingsOf(org?.settings);
}

/**
 * A notification id made of [A-Za-z0-9_-] only (the Inbox's id rule), at
 * most 64 long: the prefix, the day, and a digest of the workspace and the
 * person (32 hex characters), so no id is ever cut short and the same
 * person in two workspaces gets two ids.
 */
function stableId(prefix: string, dayKey: string, orgId: string, userId: string): string {
  const who = createHash("sha256").update(`${orgId}\u0000${userId}`).digest("hex").slice(0, 32);
  return `${prefix}_${dayKey.replace(/[^A-Za-z0-9-]/g, "")}_${who}`;
}

/**
 * The people among `userIds` who still work in this workspace: not deleted,
 * not deactivated, and holding a level in it (anchored here, or a membership
 * here). One read, narrowed by id. A goal's owner who left, was deactivated
 * or was removed keeps the goal's ownerId, so every goal digest and nudge
 * asks here first.
 */
export async function liveRecipients(orgId: string, userIds: Iterable<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set([...userIds].filter((u): u is string => !!u))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.user.findMany({
    where: { id: { in: ids }, deletedAt: null, status: { not: "INACTIVE" }, ...inWorkspaceWhere(orgId) },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
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
  const live = await liveRecipients(orgId, byOwner.keys());
  const to = [...byOwner].filter(([userId]) => live.has(userId));
  if (to.length === 0) return 0;
  const written = await prisma.notification.createMany({
    data: to.map(([userId, goals]) => ({
      id: stableId("gps", today, orgId, userId),
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
  const live = await liveRecipients(orgId, byOwner.keys());
  const to = [...byOwner].filter(([userId]) => live.has(userId));
  if (to.length === 0) return 0;
  const written = await prisma.notification.createMany({
    data: to.map(([userId, closed]) => {
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

/**
 * The end nudge's id: one per owner per workspace per period end (the
 * periods' last day), so the later runs inside those days add nothing, and
 * an owner with goals ending in two workspaces gets both.
 */
export function endNudgeId(orgId: string, ownerId: string, lastDayKey: string): string {
  return stableId("gpe", lastDayKey, orgId, ownerId);
}
