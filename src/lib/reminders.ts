// Reminder firing — turns a due Reminder into an in-app Notification (the
// bell) plus an optional email, then marks it FIRED. Shared by the per-user
// tick endpoint (app open) and the org-wide cron (scheduled).

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

type DueReminder = { id: string; userId: string; title: string; body: string | null; notifyEmail: boolean };

export async function fireReminder(r: DueReminder) {
  await prisma.notification.create({
    data: { userId: r.userId, type: "reminder", title: "Reminder", message: r.title, link: "/today" },
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
  await prisma.reminder.update({ where: { id: r.id }, data: { status: "FIRED", firedAt: new Date() } });
}
