import { NextRequest } from "next/server";
import { processWebhookRetries } from "@/services/webhookDispatcher";
import { cronRefusal } from "@/lib/cron-auth";

/**
 * Cron endpoint — processes the webhook retry queue.
 * Guard with CRON_SECRET in production.
 */
export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const result = await processWebhookRetries();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
