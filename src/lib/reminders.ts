// Reminder firing — turns a due Reminder into an in-app Notification (the
// bell) plus an optional email, then marks it FIRED. Shared by the per-user
// tick endpoint (app open) and the org-wide cron (scheduled). The PENDING →
// FIRED flip is an atomic claim, so ticker + cron racing can never double-fire
// the same reminder.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { personalReminderTemplate } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/app-url";
import { WORK_HOME_HREF } from "./nav/route-hub";

function fmtDue(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type DueReminder = {
  id: string; userId: string; title: string; body: string | null; notifyEmail: boolean;
  entityType?: string | null; entityId?: string | null;
  /** Its company: the email is tagged with it, so it goes with the company
   *  when it is deleted for good (/api/cron/org-hard-delete). */
  organizationId?: string | null;
};

/** Fire one due reminder exactly once. Returns false when another worker
 *  (ticker vs cron) already claimed it — nothing was sent in that case. */
export async function fireReminder(r: DueReminder): Promise<boolean> {
  // Claim first: only the worker that flips PENDING → FIRED sends anything.
  const claim = await prisma.reminder.updateMany({
    where: { id: r.id, status: "PENDING" },
    data: { status: "FIRED", firedAt: new Date() },
  });
  if (claim.count !== 1) return false;

  // Task reminders deep-link to the task and surface its title + due time;
  // personal reminders keep their own title and open the Work landing.
  let title = "Reminder";
  let message = r.title;
  let link: string = WORK_HOME_HREF;
  if (r.entityType === "BOARD_ITEM" && r.entityId) {
    const item = await prisma.item.findUnique({
      where: { id: r.entityId },
      select: { title: true, dueAt: true, archivedAt: true },
    });
    // Only deep-link to a LIVE task. A missing (hard-deleted) or archived
    // (trashed) item would dead-end on /item/[id] as "Task not found", so
    // the reminder degrades to a personal one that opens the Work landing
    // instead of a broken link. NB: the link is set INSIDE this guard, it used to be
    // set unconditionally above the lookup, which is exactly what stranded
    // fired reminders on deleted tasks.
    if (item && !item.archivedAt) {
      link = `/item/${r.entityId}`;
      title = item.title || r.title;
      message = item.dueAt ? `Reminder: due ${fmtDue(item.dueAt)}` : `Reminder: ${r.title}`;
    }
  }
  await prisma.notification.create({
    data: { userId: r.userId, type: "reminder", title, message, link },
  });
  if (r.notifyEmail) {
    const user = await prisma.user.findUnique({ where: { id: r.userId }, select: { email: true, organizationId: true } });
    if (user?.email) {
      // The branded template (white card, blue button to the page the
      // bell row opens), never bare HTML. The link is absolute: an email
      // client has no host to resolve a relative path against.
      const { subject, html } = personalReminderTemplate({
        title: r.title,
        body: r.body,
        link: absoluteUrl(link),
        openLabel: link === WORK_HOME_HREF ? "Open WorkwrK" : "Open the task",
      });
      await sendEmail({
        to: user.email,
        subject,
        html,
        template: "reminder",
        // A task's reminder belongs to the task's workspace. A personal one
        // belongs to the person: it goes with their workspace now (as the
        // hard delete moves it there), so a workspace they made it in and
        // that has since closed does not swallow it.
        organizationId: (r.entityType ? r.organizationId : user.organizationId) ?? undefined,
      }).catch((e) => console.error("reminder email failed", e));
    }
  }
  return true;
}
