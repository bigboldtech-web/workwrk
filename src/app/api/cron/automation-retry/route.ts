import { NextRequest } from "next/server";
import { processAutomationRetries } from "@/lib/automation/retry";
import { cronRefusal } from "@/lib/cron-auth";

/**
 * Cron endpoint — retries FAILED/PARTIAL automation runs whose failed
 * steps are all retry-safe actions (immediate → 5m → 30m backoff).
 * Guard with CRON_SECRET in production (same pattern as webhook-retry).
 */
export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const result = await processAutomationRetries();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
