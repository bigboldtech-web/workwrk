import { NextRequest } from "next/server";
import { syncAllSubscriptions } from "@/services/googleCalendarSync";
import { isGoogleEnabled } from "@/services/googleCalendar";

/**
 * Cron — pulls deltas from every enabled inbound Google Calendar
 * subscription. Runs every 5 min in production; the sync is incremental
 * (`syncToken`-based) so repeat calls are cheap.
 *
 * Guarded by CRON_SECRET. If Google env vars aren't set we no-op so
 * dev environments without credentials can still schedule this cron.
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
  if (!isGoogleEnabled()) {
    return Response.json({ ran: true, skipped: "google_not_configured" });
  }

  const result = await syncAllSubscriptions();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
