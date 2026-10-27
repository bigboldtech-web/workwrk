import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { shouldEmail } from "@/lib/notify-prefs";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";
import { isMeasuredAutomatically } from "@/lib/goals/goal-measure";
import { daysLeft, isGoalCadence, lastDayKey, periodAt, periodSettingsOf, type GoalPeriodRange, type PeriodSettings } from "@/lib/goals/goal-period";
import { endNudgeId, endNudgeWords } from "@/lib/goals/goal-period-notify.server";
import { periodCheckInDays, periodLengthDays } from "@/lib/goal-verdict";

type EndingGoal = { okrId: string; title: string; range: GoalPeriodRange };

/**
 * Cron: surfaces "you haven't checked in" nudges for goal owners.
 *
 * For every target whose goal has gone past its cadence window without a
 * check-in, we drop a Notification row (topbar bell, which polls
 * /api/notifications) AND escalate with an email to the goal owner, so a
 * stale goal isn't buried behind a bell the owner never opens.
 *
 * Opt-out: a goal with checkInCadence = "NONE" is skipped entirely, no bell,
 * no email. That is the per-goal reminder off switch exposed in the goal
 * modal ("Remind the owner to check in: Off"). checkInCadence is a String
 * column, so NONE is just another value, no schema change.
 *
 * REPEATING GOALS (docs/plans/recurring-goals.md F), whatever the
 * RECURRING_GOALS switch says (the reading half):
 *  - staleness counts from the later of the current period's trackedFrom
 *    and the target's last check-in INTO that period, so a monthly goal's
 *    clock starts again on the 1st;
 *  - the rhythm is capped by the period's length (periodCheckInDays): a
 *    weekly goal's weekly reminder comes due on its fifth day, the Friday,
 *    since a clock that restarts every Monday never reaches seven days;
 *  - the END NUDGE: once per period end, on the first run inside the last 3
 *    days of a monthly, quarterly or yearly period (this cron runs on
 *    weekdays only, so a fixed "two days before" would skip a month ending
 *    on a Sunday: the Friday run sends it), the owner gets ONE row and one
 *    email for all their goals ending that day with a hand-checked target
 *    that has no check-in this period: "October ends in 2 days. Add this
 *    month's numbers." It is those goals' reminder for the run (their
 *    stale-target rows wait), and it is sent once (its row's id is the
 *    owner and the last day). No end nudge for weekly goals: two days
 *    before is most of the week.
 *
 * For every goal (F): targets measured automatically (a KPI, and from step
 * 4 a List or a table) are skipped, since they take no check-ins; the row
 * links to the goal, not /okrs; its words carry no em dash.
 *
 * Idempotency + anti-spam:
 *  - Each KR carries `lastReminderAt`; we refuse to fire again until a
 *    full cadence interval has passed, so the bell doesn't spam someone.
 *  - The email respects the owner's /settings/notifications email prefs
 *    (shouldEmail, "due_reminders") and fires at most once per goal per
 *    run, even when several of the goal's KRs are stale at once.
 *
 * Schedule: weekdays at 9 AM (scripts/CRON-SETUP.md). Guarded with
 * CRON_SECRET (same pattern as the email-queue cron).
 */

const CADENCE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
};

/** "a week", "two weeks", "a month": how long ago the last update was, in words. */
const STALE_WORDS: Record<string, string> = {
  WEEKLY: "a week",
  BIWEEKLY: "two weeks",
  MONTHLY: "a month",
};

type Owner = { email: string | null; firstName: string | null } | null;

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const at = new Date();
  const now = at.getTime();
  let nudgesCreated = 0;
  let endNudges = 0;
  let krsScanned = 0;
  let skippedNone = 0;
  let skippedAutomatic = 0;
  let emailsSent = 0;
  let emailsFailed = 0;

  // Owner lookups are cached per run: OKR.ownerId is a bare column (no
  // Prisma relation), so we resolve email + name once per owner, not per KR.
  const ownerCache = new Map<string, Owner>();
  async function loadOwner(id: string): Promise<Owner> {
    if (ownerCache.has(id)) return ownerCache.get(id) ?? null;
    const u = await prisma.user.findUnique({
      where: { id },
      select: { email: true, firstName: true },
    });
    ownerCache.set(id, u ?? null);
    return u ?? null;
  }
  // At most one email per goal per run (a goal can have many KRs go stale
  // together: the owner gets one nudge, not one per KR), and one per end
  // nudge row (an owner with ten goals ending gets one).
  const emailed = new Set<string>();
  async function emailOnce(
    key: string,
    to: { ownerId: string; organizationId: string },
    words: { heading: string; subjectText: string; itemTitle: string; itemDetails: string; path: string; variables: Record<string, unknown> },
  ) {
    if (emailed.has(key)) return;
    emailed.add(key);
    try {
      const owner = await loadOwner(to.ownerId);
      if (owner?.email && (await shouldEmail(to.ownerId, "due_reminders"))) {
        const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
        const { subject, html } = genericNotificationTemplate({
          heading: words.heading,
          recipientName: owner.firstName ?? undefined,
          subjectText: words.subjectText,
          itemTitle: words.itemTitle,
          itemDetails: words.itemDetails,
          actionLabel: "Check in now",
          actionLink: `${baseUrl}${words.path}`,
        });
        await sendEmail({
          to: owner.email,
          subject,
          html,
          template: "okr-check-in-stale",
          variables: words.variables,
          organizationId: to.organizationId,
          userId: to.ownerId,
          category: "reminder",
        });
        emailsSent++;
      }
    } catch (err) {
      emailsFailed++;
      console.error("[OKR reminders] Email escalation failed:", err);
    }
  }

  // Every active KR + its goal's cadence + most recent check-in. We only
  // care about goals that have an owner: Company goals without an explicit
  // owner get a nudge in the team manager dashboard later. A running
  // repeating goal never stores COMPLETED (B8), so it is here all period.
  const krs = await prisma.keyResult.findMany({
    where: {
      okr: {
        ownerId: { not: null },
        status: { not: "COMPLETED" },
      },
    },
    select: {
      id: true,
      lastReminderAt: true,
      kpiId: true,
      source: true,
      okr: {
        select: {
          id: true, title: true, ownerId: true,
          checkInCadence: true, organizationId: true, repeat: true,
        },
      },
      checkIns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  krsScanned = krs.length;

  // Repeating goals: the period running now, each target's last check-in
  // into it, and the workspace's period settings (the end nudge's days).
  const repeatingIds = [...new Set(krs.filter((k) => k.okr.repeat).map((k) => k.okr.id))];
  const running = repeatingIds.length
    ? await prisma.goalPeriod.findMany({
        where: { okrId: { in: repeatingIds }, status: "OPEN", startsAt: { lte: at }, endsAt: { gt: at } },
        select: { id: true, okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true },
      })
    : [];
  const byGoal = new Map<string, typeof running>();
  for (const r of running) {
    const list = byGoal.get(r.okrId);
    if (list) list.push(r);
    else byGoal.set(r.okrId, [r]);
  }
  const runningOf = new Map<string, (typeof running)[number]>();
  for (const [id, list] of byGoal) {
    const p = periodAt(list, at);
    if (p) runningOf.set(id, p);
  }
  const lastIn = new Map<string, Date | null>();
  if (running.length) {
    const grouped = await prisma.kRCheckIn.groupBy({
      by: ["keyResultId", "periodId"],
      where: { periodId: { in: running.map((p) => p.id) } },
      _max: { createdAt: true },
    });
    for (const g of grouped) lastIn.set(`${g.keyResultId}|${g.periodId}`, g._max.createdAt);
  }
  const orgIds = [...new Set(krs.filter((k) => k.okr.repeat).map((k) => k.okr.organizationId))];
  const settingsOf = new Map<string, PeriodSettings>(
    orgIds.length
      ? (await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, settings: true } })).map((o) => [o.id, periodSettingsOf(o.settings)] as const)
      : [],
  );

  // The end nudges, first: one row (and one email) per owner per period
  // end, naming every goal of theirs ending that day with a hand-checked
  // target not checked in this period. It is those goals' reminder for this
  // run.
  const nudgedGoals = new Set<string>();
  const handByGoal = new Map<string, typeof krs>();
  for (const kr of krs) {
    if (!kr.okr.repeat || isMeasuredAutomatically(kr)) continue;
    const list = handByGoal.get(kr.okr.id);
    if (list) list.push(kr);
    else handByGoal.set(kr.okr.id, [kr]);
  }
  const ending = new Map<string, { ownerId: string; organizationId: string; lastDay: string; left: number; s: PeriodSettings; goals: EndingGoal[] }>();
  for (const [okrId, hand] of handByGoal) {
    const goal = hand[0].okr;
    const p = runningOf.get(okrId);
    const s = settingsOf.get(goal.organizationId);
    if (!goal.ownerId || !p || !s || goal.checkInCadence === "NONE") continue;
    if (!isGoalCadence(p.cadence) || p.cadence === "WEEKLY") continue;
    const range = { key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt };
    const left = daysLeft(range, at, s);
    // Inside the last 3 days: 2, 1 or 0 days after today.
    if (left > 2) continue;
    if (hand.every((kr) => lastIn.get(`${kr.id}|${p.id}`))) continue;
    const lastDay = lastDayKey(range, s);
    const key = `${goal.ownerId}|${lastDay}`;
    const group = ending.get(key) ?? { ownerId: goal.ownerId, organizationId: goal.organizationId, lastDay, left, s, goals: [] };
    group.goals.push({ okrId, title: goal.title, range });
    ending.set(key, group);
  }
  for (const [key, group] of ending) {
    for (const g of group.goals) nudgedGoals.add(g.okrId);
    const words = endNudgeWords(group.goals, group.left, group.s, at);
    const path = group.goals.length === 1 ? `/okrs/${group.goals[0].okrId}` : "/okrs";
    const made = await prisma.notification.createMany({
      data: [{ id: endNudgeId(group.ownerId, group.lastDay), userId: group.ownerId, type: "okr_check_in_due", title: words.title, message: words.message, link: path }],
      skipDuplicates: true,
    });
    if (made.count === 0) continue;
    endNudges++;
    await emailOnce(`end:${key}`, group, {
      heading: words.title,
      subjectText: words.title,
      itemTitle: group.goals.length === 1 ? group.goals[0].title : words.message,
      itemDetails: words.message,
      path,
      variables: { goalIds: group.goals.map((g) => g.okrId), lastDay: group.lastDay },
    });
  }

  for (const kr of krs) {
    if (!kr.okr.ownerId) continue;
    const repeating = !!kr.okr.repeat;

    // Per-goal opt-out: NONE means "don't remind me about this goal": no
    // bell, no email. (The DB query can't easily de-dupe this by goal, so
    // we skip here; scanning is cheap.)
    if (kr.okr.checkInCadence === "NONE") { skippedNone++; continue; }
    // A target measured automatically takes no check-in (C2, F).
    if (isMeasuredAutomatically(kr)) { skippedAutomatic++; continue; }
    // The end nudge was this goal's reminder for the run.
    if (nudgedGoals.has(kr.okr.id)) continue;

    let cadenceMs = (CADENCE_DAYS[kr.okr.checkInCadence] ?? 7) * 86_400_000;
    // When the target's clock started: its last check-in, or for a
    // repeating goal the later of the period's trackedFrom and its last
    // check-in into that period, on a rhythm the period's length caps (a
    // weekly goal's weekly reminder comes due on its Friday, never "in seven
    // days" that the next Monday's fresh period would reset).
    let from: number | null;
    if (repeating) {
      const p = runningOf.get(kr.okr.id);
      if (!p) continue;
      cadenceMs = periodCheckInDays(CADENCE_DAYS[kr.okr.checkInCadence] ?? 7, periodLengthDays(p)) * 86_400_000;
      const last = lastIn.get(`${kr.id}|${p.id}`);
      from = Math.max(p.trackedFrom.getTime(), last ? last.getTime() : 0);
    } else {
      const lastCheckIn = kr.checkIns[0]?.createdAt;
      from = lastCheckIn ? new Date(lastCheckIn).getTime() : null;
    }
    const sinceCheckIn = from == null ? Infinity : now - from;

    // Not due yet.
    if (sinceCheckIn < cadenceMs) continue;

    // Already nudged this cycle: wait a full cadence before nudging again.
    const sinceReminder = kr.lastReminderAt ? now - new Date(kr.lastReminderAt).getTime() : Infinity;
    if (sinceReminder < cadenceMs) continue;

    await prisma.$transaction([
      prisma.notification.create({
        data: {
          userId: kr.okr.ownerId,
          type: "okr_check_in_due",
          title: "Check in on your OKR",
          message: `"${kr.okr.title}": your last update was more than ${STALE_WORDS[kr.okr.checkInCadence] ?? "a week"} ago.`,
          link: `/okrs/${kr.okr.id}`,
        },
      }),
      prisma.keyResult.update({
        where: { id: kr.id },
        data: { lastReminderAt: new Date() },
      }),
    ]);
    nudgesCreated++;

    // Email escalation: one per goal per run, prefs-gated. Reuses the
    // existing email sender + generic template; shouldEmail honors the
    // owner's /settings/notifications "due_reminders" toggle (and the
    // master email switch), so an opted-out owner never gets mailed.
    const daysStale = sinceCheckIn === Infinity ? null : Math.floor(sinceCheckIn / 86_400_000);
    await emailOnce(`goal:${kr.okr.id}`, { ownerId: kr.okr.ownerId, organizationId: kr.okr.organizationId }, {
      heading: "Check-in overdue",
      subjectText: `Your goal is past its ${kr.okr.checkInCadence.toLowerCase()} check-in.`,
      itemTitle: kr.okr.title,
      itemDetails: daysStale === null ? "No check-ins yet" : `Last update ${daysStale} day${daysStale === 1 ? "" : "s"} ago`,
      path: `/okrs/${kr.okr.id}`,
      variables: { goalId: kr.okr.id, title: kr.okr.title, cadence: kr.okr.checkInCadence },
    });
  }

  return cronResult("okr-reminders", {
    ran: true,
    at: at.toISOString(),
    krsScanned,
    skippedNone,
    skippedAutomatic,
    nudgesCreated,
    endNudges,
    emailsSent,
    emailsFailed,
  }, emailsFailed);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("okr-reminders", handle);
