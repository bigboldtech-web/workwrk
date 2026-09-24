import { NextRequest } from "next/server";
import { runDueReports } from "@/lib/reports/report-server";

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
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
  const provided = header?.replace(/^Bearer\s+/i, "");
  if (provided !== cronSecret) return Response.json({ error: "Forbidden" }, { status: 403 });

  const result = await runDueReports(new Date(), { limit: 25, budgetMs: 240_000 });
  return Response.json(result);
}
