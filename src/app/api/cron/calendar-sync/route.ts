import { NextRequest } from "next/server";
import { syncAllSubscriptions } from "@/services/googleCalendarSync";
import { isGoogleEnabled } from "@/services/googleCalendar";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";

/**
 * Cron — pulls deltas from every enabled inbound Google Calendar
 * subscription. Runs every 5 min in production; the sync is incremental
 * (`syncToken`-based) so repeat calls are cheap.
 *
 * Guarded by CRON_SECRET. If Google env vars aren't set we no-op so
 * dev environments without credentials can still schedule this cron.
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  if (!isGoogleEnabled()) {
    return Response.json({ ran: true, skipped: "google_not_configured" });
  }

  const result = await syncAllSubscriptions();
  // Every subscription failed: Google refuses the app itself (a rotated
  // client secret, a suspended project), which is the server's to fix. One
  // person's revoked token among syncs that worked is theirs.
  const body = { ran: true, at: new Date().toISOString(), ...result };
  return cronResult("calendar-sync", body, result.subscriptions > 0 && result.failed === result.subscriptions ? result.failed : 0);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("calendar-sync", handle);
