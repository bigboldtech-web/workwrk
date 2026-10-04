import { NextRequest } from "next/server";
import { syncAllSubscriptions } from "@/services/googleCalendarSync";
import { isGoogleEnabled } from "@/services/googleCalendar";
import { cronRefusal } from "@/lib/cron-auth";

/**
 * Cron — pulls deltas from every enabled inbound Google Calendar
 * subscription. Runs every 5 min in production; the sync is incremental
 * (`syncToken`-based) so repeat calls are cheap.
 *
 * Guarded by CRON_SECRET. If Google env vars aren't set we no-op so
 * dev environments without credentials can still schedule this cron.
 */
export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  if (!isGoogleEnabled()) {
    return Response.json({ ran: true, skipped: "google_not_configured" });
  }

  const result = await syncAllSubscriptions();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
