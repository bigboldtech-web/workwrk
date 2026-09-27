import { NextRequest } from "next/server";
import { processAutomationSchedules } from "@/lib/automation/schedule-server";
import { noteScheduleTick } from "@/lib/automation/cron-tick-server";

/**
 * Cron endpoint: fires the time triggers, "On a schedule" and "A task's date
 * arrives", for every ACTIVE automation on them (lib/automation/schedule.ts).
 * Run it every 5 minutes with the x-cron-secret header.
 *
 * FAIL CLOSED: in production a missing CRON_SECRET refuses every call (503)
 * instead of letting any unauthenticated POST fire every time automation in
 * every workspace and burn the monthly action quota. Locally, with no secret
 * set, it stays open so the harness can tick it.
 *
 * Every tick, even one that found nothing to run, stamps the time (
 * noteScheduleTick), which is how the builder knows the two time triggers
 * are live rather than published-and-never-firing.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret && process.env.NODE_ENV === "production") {
    return Response.json({ error: "CRON_SECRET is not set, so the cron endpoints are closed" }, { status: 503 });
  }
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const result = await processAutomationSchedules();
  await noteScheduleTick();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
