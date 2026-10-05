import { NextRequest } from "next/server";
import { processWebhookRetries } from "@/services/webhookDispatcher";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";

/**
 * Cron endpoint — processes the webhook retry queue.
 * Guard with CRON_SECRET in production.
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const result = await processWebhookRetries();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("webhook-retry", handle);
