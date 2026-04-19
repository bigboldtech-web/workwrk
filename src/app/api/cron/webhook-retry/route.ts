import { NextRequest } from "next/server";
import { processWebhookRetries } from "@/services/webhookDispatcher";

/**
 * Cron endpoint — processes the webhook retry queue.
 * Guard with CRON_SECRET in production.
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
  const result = await processWebhookRetries();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
