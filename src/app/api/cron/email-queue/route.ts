import { NextRequest } from "next/server";
import { processEmailQueue } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";

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
 * (FOR UPDATE SKIP LOCKED and a status re-check in one UPDATE) under a lease
 * it renews before each send, and records a result only while it still holds
 * the row, so runs that overlap, this cron's or the ones every sendEmail
 * starts, send an email twice only if one send outlasts the lease, which the
 * transport's timeouts rule out.
 *
 * Its own failure cannot reach anyone by email: the alert would go through
 * the queue that is failing, so cronResult sends none for this job, and
 * /api/health does not check email. The cron log shows each failed run, and a
 * dead-man check on its crontab row (scripts/CRON-SETUP.md) is what tells
 * someone.
 *
 * Guarded by the shared cron door (src/lib/cron-auth.ts): fail-closed.
 *
 * Answers 500 when a send failed this run (it is retried later, with a
 * longer wait each time, up to EMAIL_MAX_ATTEMPTS) or mail is failing between
 * tries (below), and 503 when production has no mail transport, so the queue
 * is held (src/lib/cron-result.ts).
 */
/** How long a send may keep failing, with nothing else sent, before mail counts as failing. */
const FAILING_AFTER_MS = 30 * 60_000;

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const result = await processEmailQueue();
  const body = { ran: true, at: new Date().toISOString(), ...result };
  if (result.held) return cronResult("email-queue", { ...body, error: "Mail is off on this server (EMAIL_ENABLED is not \"true\"), so queued emails are held." }, result.held, 503);
  if (result.retrying + result.failed > 0) return cronResult("email-queue", body, result.retrying + result.failed);
  // MAIL THAT IS FAILING BETWEEN TRIES. Most sends, and their retries, run
  // in the request that queued them, not here, and a failed row then waits
  // minutes or hours for its next try, so this job's own run usually sends
  // nothing and fails nothing while every email is failing. Mail counts as
  // failing when a row that has already failed is waiting to try again, it
  // was queued more than 30 minutes ago, and nothing at all was sent in those
  // 30 minutes (so one bad address among mail that goes out never counts).
  // Then this job answers 500, so a dead-man check on its crontab row goes
  // red (scripts/CRON-SETUP.md).
  const since = new Date(Date.now() - FAILING_AFTER_MS);
  const [stuck, sentLately] = await Promise.all([
    prisma.emailLog.count({ where: { status: "QUEUED", attempts: { gte: 1 }, createdAt: { lt: since } } }),
    prisma.emailLog.count({ where: { createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) }, status: "SENT", sentAt: { gt: since } } }),
  ]);
  if (stuck > 0 && sentLately === 0) {
    return cronResult("email-queue", { ...body, error: `Mail is failing: ${stuck} queued ${stuck === 1 ? "email has failed and is" : "emails have failed and are"} waiting to try again, and nothing was sent in 30 minutes.`, failingWaiting: stuck }, stuck);
  }
  return cronResult("email-queue", body, 0);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("email-queue", handle);
