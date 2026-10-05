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
  // A failed round is one where every subscription that could sync failed
  // for a reason that is the server's to fix (Google refusing the app itself:
  // a rotated client secret, a suspended project). A person who revoked
  // access, or whose connection lost its token, is theirs to reconnect, and
  // never counts: one such person, alone or among syncs that worked, must
  // not page anyone every five minutes.
  const body = { ran: true, at: new Date().toISOString(), ...result };
  const couldSync = result.subscriptions - result.personal;
  const serverFailures = result.failed - result.personal;
  return cronResult("calendar-sync", body, couldSync > 0 && serverFailures === couldSync ? serverFailures : 0);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("calendar-sync", handle);
