import { NextRequest } from "next/server";
import { runDueReports } from "@/lib/reports/report-server";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob, cronResult } from "@/lib/cron-result";

/**
 * Cron endpoint: send the scheduled email reports that are due (gap 16).
 *
 * Each due schedule's emails are computed per recipient under that
 * recipient's own access, then queued into the EmailLog queue that
 * /api/cron/email-queue drains, in ONE transaction that also moves the
 * schedule to its next instant (src/lib/reports/report-server.ts). That is
 * what makes it idempotent per (schedule, due instant): a retried or
 * overlapping run finds the instant already claimed and queues nothing.
 *
 * FAIL-CLOSED, like /api/cron/form-daily-summary and unlike the email queue:
 * it mails people, so with no CRON_SECRET configured it answers 503 and sends
 * nothing rather than running for anybody who can reach the URL. The row is in
 * scripts/CRON-SETUP.md ("Scheduled email reports"), NOT INSTALLED until the
 * founder adds it; installing it also sets REPORT_SCHEDULE_CRON=on.
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const result = await runDueReports(new Date(), { limit: 25, budgetMs: 240_000 });
  return cronResult("report-schedules", result, "failed" in result ? result.failed : 0);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("report-schedules", handle);
