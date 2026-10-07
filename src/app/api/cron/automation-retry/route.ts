import { NextRequest } from "next/server";
import { failStaleRuns, processAutomationRetries } from "@/lib/automation/retry";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";

/**
 * Cron endpoint — retries FAILED/PARTIAL automation runs whose failed
 * steps are all retry-safe actions (immediate → 5m → 30m backoff).
 * Guard with CRON_SECRET in production (same pattern as webhook-retry).
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  // A run whose process stopped part way reads FAILED, not "Running" for good.
  const stale = await failStaleRuns();
  const result = await processAutomationRetries();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result, stale });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("automation-retry", handle);
