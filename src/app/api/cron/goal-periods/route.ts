// /api/cron/goal-periods: opens and closes the periods of repeating goals
// (docs/plans/recurring-goals.md B3). Guarded by CRON_SECRET, accepting the
// same x-cron-secret / Bearer header as the other crons. Runs at
// `5,35 * * * *`: IST midnight is 18:30 UTC, so the run at 35 past opens an
// Indian month within five minutes (other zones are covered by the lazy
// opening on every read). THE CRONTAB ROW IS REQUIRED: this is the only
// thing that closes periods. See scripts/CRON-SETUP.md.
//
// Each run, for every workspace with a repeating goal: settle (open every
// missing period, at most 24 per goal), then close every period whose
// closesAt has passed, deepest goals first, then retry any closed period
// whose score patch has not run (each owner gets one "results" Inbox row for
// what the run closed), then write each owner's one "started" row for the
// periods that began today (docs/plans/recurring-goals.md F). Then, for
// every workspace with a target counted from a List (C7): count each source
// last counted more than 50 minutes ago, grouped by connector, oldest first,
// inside a time budget (the rest wait for the next run), and store a Right
// now count's final number at the first run after its period ends. The run
// at 20:35 UTC (02:05 in Kolkata) also repairs ItemCompletion for every
// workspace (C4): a row for a task that entered done without one, and no row
// for a task that is gone. One workspace failing does not stop the others;
// the run answers 500 when any failed (cronResult).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";
import { closeDuePeriods, settleGoalPeriods } from "@/lib/goals/goal-periods.server";
import { notifyPeriodsStarted } from "@/lib/goals/goal-period-notify.server";
import { refreshGoalSources } from "@/lib/goals/goal-source.server";
import { isRepairRun, repairItemCompletions } from "@/lib/item-completions";

/** A source is counted again once it is this old (C7). */
const CRON_REFRESH_AGE_MS = 50 * 60 * 1000;
/** The counting half of one run, across workspaces; what is left waits for the next run. */
const REFRESH_BUDGET_MS = 120_000;

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const now = new Date();
  // The workspaces with a repeating goal (one indexed query; none, nothing to do).
  const [orgs, sourcedOrgs] = await Promise.all([
    prisma.oKR.findMany({
      where: { repeat: { not: null } },
      distinct: ["organizationId"],
      select: { organizationId: true },
    }),
    prisma.oKR.findMany({
      where: { keyResults: { some: { sourceById: { not: null } } } },
      distinct: ["organizationId"],
      select: { organizationId: true },
    }),
  ]);
  let opened = 0;
  let closed = 0;
  let scorePatched = 0;
  let failed = 0;
  let started = 0;
  let counted = 0;
  let paused = 0;
  let repaired: { added: number; removed: number } | null = null;
  for (const { organizationId } of orgs) {
    // The opening and the close are tried apart: a settle that fails never
    // keeps due periods from closing (the close is the only closer).
    try {
      opened += (await settleGoalPeriods(organizationId, null, now)).opened;
    } catch (err) {
      failed += 1;
      console.error("[goal-periods] a workspace's opening failed:", err instanceof Error ? err.message : err);
    }
    try {
      const r = await closeDuePeriods(organizationId, now);
      closed += r.closed;
      scorePatched += r.scorePatched;
      failed += r.failed;
    } catch (err) {
      failed += 1;
      console.error("[goal-periods] a workspace's close failed:", err instanceof Error ? err.message : err);
    }
    // "3 goals started October 2026": one Inbox row per owner per day (F).
    try {
      started += await notifyPeriodsStarted(organizationId, now);
    } catch (err) {
      failed += 1;
      console.error("[goal-periods] a workspace's started rows failed:", err instanceof Error ? err.message : err);
    }
  }
  // The List sources (C7), after the closes, inside one time budget.
  const budgetStart = Date.now();
  for (const { organizationId } of sourcedOrgs) {
    const left = REFRESH_BUDGET_MS - (Date.now() - budgetStart);
    if (left <= 0) break;
    try {
      const r = await refreshGoalSources(organizationId, { now, minAgeMs: CRON_REFRESH_AGE_MS, freezeRightNow: true, budgetMs: left });
      counted += r.counted;
      paused += r.paused;
    } catch (err) {
      failed += 1;
      console.error("[goal-periods] a workspace's source counts failed:", err instanceof Error ? err.message : err);
    }
  }
  // The nightly ItemCompletion repair (C4), whatever RECURRING_GOALS says:
  // completions are data plumbing.
  if (isRepairRun(now)) {
    try {
      repaired = await repairItemCompletions(now);
    } catch (err) {
      failed += 1;
      console.error("[goal-periods] the item completion repair failed:", err instanceof Error ? err.message : err);
    }
  }
  // Counts only: no workspace, goal or person is named in the answer.
  const body = { ran: true, at: now.toISOString(), workspaces: orgs.length, opened, closed, scorePatched, started, counted, paused, ...(repaired ? { repaired } : {}), failed };
  if (failed > 0) return cronResult("goal-periods", body, failed);
  return NextResponse.json(body);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("goal-periods", handle);
