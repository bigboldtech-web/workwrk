// /api/cron/recurring-tasks — spawn the next copy of every due recurring task
// (spawn model). Guarded by CRON_SECRET, accepting the same x-cron-secret /
// Bearer header as the other crons. Register on aaPanel to run a few times a day
// (hourly is plenty). See scripts/CRON-SETUP.md.

import { NextResponse, type NextRequest } from "next/server";
import { spawnDueRecurringTasks } from "@/lib/recurring-tasks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  try {
    const result = await spawnDueRecurringTasks();
    return NextResponse.json({ ran: true, at: new Date().toISOString(), ...result });
  } catch (e) {
    console.error("recurring-tasks cron failed", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
