import { NextRequest } from "next/server";
import { processAutomationSchedules } from "@/lib/automation/schedule-server";

/**
 * Cron endpoint: fires the time triggers, "On a schedule" and "A task's date
 * arrives", for every ACTIVE automation on them (lib/automation/schedule.ts).
 * Run it every 5 minutes. Guard with CRON_SECRET in production (the same
 * pattern as automation-retry).
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const result = await processAutomationSchedules();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
