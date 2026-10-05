// /api/cron/recurring-tasks — spawn the next copy of every due recurring task
// (spawn model). Guarded by CRON_SECRET, accepting the same x-cron-secret /
// Bearer header as the other crons. Register on aaPanel to run a few times a day
// (hourly is plenty). See scripts/CRON-SETUP.md.

import { NextResponse, type NextRequest } from "next/server";
import { spawnDueRecurringTasks } from "@/lib/recurring-tasks";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  // A throw answers 500 and alerts through cronJob below.
  const result = await spawnDueRecurringTasks();
  return NextResponse.json({ ran: true, at: new Date().toISOString(), ...result });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("recurring-tasks", handle);
