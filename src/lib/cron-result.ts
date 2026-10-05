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
// goes through the queue that is failing); the cron log and an uptime or
// dead-man check watch it.
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
  const to = process.env.OPS_ALERT_EMAIL?.trim();
  if (!to) return;
  const subject = `WorkwrK: the ${job} job failed`;
  const recent = await prisma.emailLog.findFirst({
    where: { template: ALERT_TEMPLATE, subject, createdAt: { gte: new Date(Date.now() - ALERT_EVERY_MS) } },
    select: { id: true },
  });
  if (recent) return;
  await queueEmail({
    to,
    subject,
    template: ALERT_TEMPLATE,
    html:
      `<p>The scheduled job <strong>${escapeHtml(job)}</strong> reported ${failed} failure${failed === 1 ? "" : "s"} at ${new Date().toISOString()}.</p>` +
      `<p>The server log has the details: <code>pm2 logs workwrk --nostream --lines 2000 | grep -F "[cron-failure] ${escapeHtml(job)}"</code>, and the error lines just before it. ` +
      `This alert is sent at most once every six hours per job.</p>`,
    variables: { job, failed },
  });
}
