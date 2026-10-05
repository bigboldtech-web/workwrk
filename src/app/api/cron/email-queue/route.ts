import { NextRequest } from "next/server";
import { processEmailQueue } from "@/lib/email";
import { cronRefusal } from "@/lib/cron-auth";
import { cronResult } from "@/lib/cron-result";

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
 * not this endpoint. `processEmailQueue` claims each row for one run only
 * (FOR UPDATE SKIP LOCKED and a status re-check in one UPDATE), so runs that
 * overlap, this cron's or the ones every sendEmail starts, never send an
 * email twice.
 *
 * Guarded by the shared cron door (src/lib/cron-auth.ts): fail-closed.
 *
 * Answers 500 when a send failed this run (it is retried later, with a
 * longer wait each time, up to EMAIL_MAX_ATTEMPTS) and 503 when production has
 * no mail transport, so the queue is held (src/lib/cron-result.ts).
 */
export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const result = await processEmailQueue();
  const body = { ran: true, at: new Date().toISOString(), ...result };
  if (result.held) return cronResult("email-queue", { ...body, error: "Mail is off on this server (EMAIL_ENABLED is not \"true\"), so queued emails are held." }, result.held, 503);
  return cronResult("email-queue", body, result.retrying + result.failed);
}
