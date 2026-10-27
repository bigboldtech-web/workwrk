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
// whose score patch has not run. One workspace failing does not stop the
// others; the run answers 500 when any failed (cronResult).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";
import { closeDuePeriods, settleGoalPeriods } from "@/lib/goals/goal-periods.server";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const now = new Date();
  // The workspaces with a repeating goal (one indexed query; none, nothing to do).
  const orgs = await prisma.oKR.findMany({
    where: { repeat: { not: null } },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  let opened = 0;
  let closed = 0;
  let scorePatched = 0;
  let failed = 0;
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
  }
  // Counts only: no workspace, goal or person is named in the answer.
  const body = { ran: true, at: now.toISOString(), workspaces: orgs.length, opened, closed, scorePatched, failed };
  if (failed > 0) return cronResult("goal-periods", body, failed);
  return NextResponse.json(body);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("goal-periods", handle);
