import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFormSettings } from "@/lib/forms/settings";
import { dailySummaryInstalled, dailySummaryMessage } from "@/lib/forms/daily-summary";
import { addressHref } from "@/lib/nav/object-href";
import { usersWhoCanReadResponses } from "@/lib/access/node-access";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";

/**
 * Cron endpoint: the form builder's "Send a daily summary instead" (spec-tables-
 * forms section 2 /forms/[id], Settings tab, Notifications card). Once a day,
 * for every form whose settings ask for it, the people on its notify list get
 * ONE notification counting the responses of the last 24 hours, instead of one
 * per response. A form with no responses in the window sends nothing.
 *
 * The row is in scripts/CRON-SETUP.md ("Form responses daily summary"), and
 * installing it also sets FORM_DAILY_SUMMARY_CRON=on (lib/forms/daily-summary
 * dailySummaryInstalled). Until that flag is on, the builder does not render
 * the switch and the submit route keeps notifying per response, so a form set
 * to the summary is never quiet. This route sends nothing while the flag is
 * off, so a stray run cannot double up with the per-response notifications.
 * Fail-closed on CRON_SECRET (503 when it is unset).
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

async function handle(req: NextRequest) {
  // Fail-closed: it writes notifications into people's inboxes, so with no
  // CRON_SECRET configured it answers 503 and sends nothing, rather than
  // running for anybody who can reach the URL.
  const refused = cronRefusal(req);
  if (refused) return refused;

  if (!dailySummaryInstalled()) return Response.json({ ok: true, skipped: "FORM_DAILY_SUMMARY_CRON is not on", formsSent: 0, notified: 0 });

  const since = new Date(Date.now() - WINDOW_MS);
  const forms = await prisma.formDefinition.findMany({
    where: { settings: { path: ["dailySummary"], equals: true } },
    select: { id: true, name: true, organizationId: true, settings: true },
  });

  let notified = 0;
  let formsSent = 0;
  for (const form of forms) {
    const settings = readFormSettings(form.settings);
    if (!settings.dailySummary || settings.notifyUserIds.length === 0) continue;
    const count = await prisma.formSubmission.count({ where: { formId: form.id, submittedAt: { gte: since } } });
    if (count === 0) continue;
    const inOrg = await prisma.user.findMany({
      where: { id: { in: settings.notifyUserIds }, organizationId: form.organizationId },
      select: { id: true },
    });
    // Only people who may read the responses (the same rule their own
    // Responses tab applies), and the Work door, placed under each reader.
    const readers = await usersWhoCanReadResponses(form.organizationId, form.id, inOrg.map((r) => r.id));
    const recipients = inOrg.filter((r) => readers.has(r.id));
    if (recipients.length === 0) continue;
    const { title, message } = dailySummaryMessage(form.name, count);
    const link = `${addressHref("form", form.id, { scope: "work" })}?tab=responses`;
    await prisma.notification.createMany({
      data: recipients.map((r) => ({ userId: r.id, type: "form.daily_summary", title, message, link })),
    });
    notified += recipients.length;
    formsSent += 1;
  }
  return Response.json({ forms: formsSent, notified, since: since.toISOString() });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("form-daily-summary", handle);
