// The answer of a scheduled job (/api/cron/*): 200 when the run did all it set
// out to, 500 when any part of it failed, with the body saying what.
//
// WHY. The crontab rows (scripts/CRON-SETUP.md) run `curl -fsS`, which logs a
// non-2xx answer as a failure and a 2xx as a success. The jobs used to answer
// 200 with the failures inside the body, so a job could fail every night (a
// company's hard delete, an announcement's emails, every email for hours)
// and the log read as success.
//
// A failing run also logs one "[cron-failure] <job>" line (pm2's log, which
// is where the details are: the crontab's own log records only curl's exit)
// and, when OPS_ALERT_EMAIL is set, queues an email to that address: at most
// one per job in six hours, so a job failing every minute does not flood the
// inbox. The email-queue job's own failure cannot arrive that way (its alert
// would wait in the queue that is failing), so it sends none; the cron log,
// and a dead-man check on its crontab row, are what show it.
//
// Every /api/cron route is wrapped in cronJob, so a run that THROWS answers
// 500 and alerts the same way, instead of Next's bare 500 that nobody hears.
import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email";

const ALERT_EVERY_MS = 6 * 3_600_000;
const ALERT_TEMPLATE = "ops-cron-failure";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A scheduled job's handler, with any throw answered as a failed run (500, logged, alerted). */
export function cronJob<R extends Request>(job: string, handler: (req: R) => Promise<Response>): (req: R) => Promise<Response> {
  return async (req: R) => {
    try {
      return await handler(req);
    } catch (err) {
      console.error(`[cron-failure] ${job} threw:`, err instanceof Error ? err.message : err);
      return cronResult(job, { ran: false, error: "The run stopped on an error; the server log has it." }, 1);
    }
  };
}

export async function cronResult(job: string, body: object, failed: number, status = 500): Promise<Response> {
  if (failed <= 0) return Response.json(body);
  console.error(`[cron-failure] ${job}: ${failed} failed`);
  await alertOps(job, failed).catch((err) => console.error(`[cron-failure] could not queue the alert for ${job}:`, err));
  return Response.json(body, { status });
}

async function alertOps(job: string, failed: number) {
  // The email-queue job's alert would wait in the very queue that is failing
  // or held: it can never arrive, and while mail is off it kept the queue
  // non-empty, so the job answered 503 for ever and a burst of stale alerts
  // went out the day mail came on. Its failures reach the log only.
  if (job === "email-queue") return;
  await alertOpsOnce({
    subject: `WorkwrK: the ${job} job failed`,
    template: ALERT_TEMPLATE,
    everyMs: ALERT_EVERY_MS,
    html:
      `<p>The scheduled job <strong>${escapeHtml(job)}</strong> reported ${failed} failure${failed === 1 ? "" : "s"} at ${new Date().toISOString()}.</p>` +
      `<p>The server log has the details: <code>pm2 logs workwrk --nostream --lines 2000 | grep -F "[cron-failure] ${escapeHtml(job)}"</code>, and the error lines just before it. ` +
      `This alert is sent at most once every six hours per job.</p>`,
    variables: { job, failed },
  });
}

/**
 * One email to OPS_ALERT_EMAIL (nothing when it is unset), at most once per
 * `everyMs` for the same template and subject, read from the email log, as
 * a job's failure alert is. Also for a signal a job finds about ANOTHER one
 * (okr-reminders noticing that no goal period closes: the goal-periods
 * crontab row is missing, docs/plans/recurring-goals.md B3). True when it
 * queued one.
 */
export async function alertOpsOnce(a: { subject: string; template: string; everyMs: number; html: string; variables: Record<string, unknown> }): Promise<boolean> {
  const to = process.env.OPS_ALERT_EMAIL?.trim();
  if (!to) return false;
  const recent = await prisma.emailLog.findFirst({
    where: { template: a.template, subject: a.subject, createdAt: { gte: new Date(Date.now() - a.everyMs) } },
    select: { id: true },
  });
  if (recent) return false;
  await queueEmail({ to, subject: a.subject, template: a.template, html: a.html, variables: a.variables });
  return true;
}
