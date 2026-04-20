import { NextRequest } from "next/server";
import { processEmailQueue } from "@/lib/email";

/**
 * Cron endpoint — drains the EmailLog queue.
 *
 * Callers throughout the app queue emails synchronously (writing to the
 * EmailLog table) and kick off `processEmailQueue()` fire-and-forget for
 * low-latency delivery. On serverless runtimes the function can be killed
 * as soon as the response returns, so that fire-and-forget may not complete.
 * This cron is the safety net that guarantees every QUEUED email is sent.
 *
 * Runs frequently (every minute) because SMTP dispatch is the bottleneck,
 * not this endpoint. `processEmailQueue` atomically claims a batch via
 * `UPDATE ... RETURNING`, so concurrent cron invocations can't double-send.
 *
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
  const result = await processEmailQueue();
  return Response.json({ ran: true, at: new Date().toISOString(), ...result });
}
