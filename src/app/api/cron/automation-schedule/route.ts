import { NextRequest } from "next/server";
import { processAutomationSchedules } from "@/lib/automation/schedule-server";
import { noteScheduleTick } from "@/lib/automation/cron-tick-server";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";

/**
 * Cron endpoint: fires the time triggers, "On a schedule" and "A task's date
 * arrives", for every ACTIVE automation on them (lib/automation/schedule.ts).
 * Run it every 5 minutes with the x-cron-secret header.
 *
 * FAIL CLOSED: a missing CRON_SECRET refuses every call (503), everywhere,
 * instead of letting any unauthenticated POST fire every time automation in
 * every workspace and burn the monthly action quota (src/lib/cron-auth.ts).
 * Locally, set CRON_SECRET for the dev server and send it to tick this.
 *
 * Every tick, even one that found nothing to run, stamps the time (
 * noteScheduleTick), which is how the builder knows the two time triggers
 * are live rather than published-and-never-firing.
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const result = await processAutomationSchedules();
  await noteScheduleTick();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("automation-schedule", handle);
