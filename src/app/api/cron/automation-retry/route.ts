import { NextRequest } from "next/server";
import { processAutomationRetries } from "@/lib/automation/retry";

/**
 * Cron endpoint — retries FAILED/PARTIAL automation runs whose failed
 * steps are all retry-safe actions (immediate → 5m → 30m backoff).
 * Guard with CRON_SECRET in production (same pattern as webhook-retry).
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
  const result = await processAutomationRetries();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
