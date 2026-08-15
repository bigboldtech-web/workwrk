// Reminder firing — turns a due Reminder into an in-app Notification (the
// bell) plus an optional email, then marks it FIRED. Shared by the per-user
// tick endpoint (app open) and the org-wide cron (scheduled). The PENDING →
// FIRED flip is an atomic claim, so ticker + cron racing can never double-fire
// the same reminder.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

function fmtDue(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type DueReminder = {
  id: string; userId: string; title: string; body: string | null; notifyEmail: boolean;
  entityType?: string | null; entityId?: string | null;
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
  // personal reminders keep their own title and open /today.
  let title = "Reminder";
  let message = r.title;
  let link = "/today";
  if (r.entityType === "BOARD_ITEM" && r.entityId) {
    const item = await prisma.item.findUnique({
      where: { id: r.entityId },
      select: { title: true, dueAt: true, archivedAt: true },
    });
    // Only deep-link to a LIVE task. A missing (hard-deleted) or archived
    // (trashed) item would dead-end on /item/[id] as "Task not found", so
    // the reminder degrades to a personal one that opens /today instead of
    // a broken link. NB: the link is set INSIDE this guard — it used to be
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
    const user = await prisma.user.findUnique({ where: { id: r.userId }, select: { email: true } });
    if (user?.email) {
      await sendEmail({
        to: user.email,
        subject: `Reminder: ${r.title}`,
        html: `<p style="font-size:15px">${esc(r.title)}</p>${r.body ? `<p style="color:#555">${esc(r.body)}</p>` : ""}`,
        template: "reminder",
      }).catch((e) => console.error("reminder email failed", e));
    }
  }
  return true;
}
