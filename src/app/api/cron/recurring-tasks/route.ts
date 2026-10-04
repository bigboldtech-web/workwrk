// /api/cron/recurring-tasks — spawn the next copy of every due recurring task
// (spawn model). Guarded by CRON_SECRET, accepting the same x-cron-secret /
// Bearer header as the other crons. Register on aaPanel to run a few times a day
// (hourly is plenty). See scripts/CRON-SETUP.md.

import { NextResponse, type NextRequest } from "next/server";
import { spawnDueRecurringTasks } from "@/lib/recurring-tasks";
import { cronRefusal } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  try {
    const result = await spawnDueRecurringTasks();
    return NextResponse.json({ ran: true, at: new Date().toISOString(), ...result });
  } catch (e) {
    console.error("recurring-tasks cron failed", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
