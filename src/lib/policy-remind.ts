// The one reminder writer behind POST /api/policies/[id]/assignments/remind
// (everyone pending), POST .../assignments/[assignmentId]/remind (one
// person) and the "Remind before due" pass of the send-reminders cron: an
// Inbox row of the registered `policy.assigned` kind plus one email, never
// on a completed assignment. Server-only (prisma, email).

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { policyAssignedTemplate } from "@/lib/email-templates";
import { parseProcessSettings } from "@/lib/process-settings";
import { absoluteUrl } from "@/lib/app-url";

const REMINDER_TITLE = "Reminder: policy to acknowledge";

export interface RemindTarget {
  assignmentId: string;
  userId: string;
  email: string;
  dueDate: Date | null;
}

export async function remindPolicyAssignees(opts: { orgId: string; policyId: string; policyTitle: string; targets: RemindTarget[] }): Promise<number> {
  const { orgId, policyId, policyTitle, targets } = opts;
  if (targets.length === 0) return 0;
  await prisma.notification.createMany({
    data: targets.map((t) => ({
      userId: t.userId,
      type: "policy.assigned",
      title: REMINDER_TITLE,
      message: `"${policyTitle}" is waiting for your acknowledgement${t.dueDate ? `, due ${t.dueDate.toISOString().slice(0, 10)}` : ""}.`,
      link: `/policies/${policyId}`,
    })),
  });
  for (const t of targets) {
    if (!t.email) continue;
    const { subject, html } = policyAssignedTemplate({
      policyTitle,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : undefined,
      policyLink: absoluteUrl(`/policies/${policyId}`),
    });
    try {
      await sendEmail({ to: t.email, subject: `Reminder: ${subject}`, html, template: "policy-assigned", variables: { policyTitle }, organizationId: orgId, userId: t.userId, category: "policy" });
    } catch (e) {
      console.error("[policy remind] email failed", e);
    }
  }
  return targets.length;
}

/**
 * The reader of Organize › Defaults "Remind before due" (`process.ack.remindDays`,
 * 0 = off), run once a day by POST /api/email/send-reminders with the body
 * kind policy-ack-due (scripts/CRON-SETUP.md). For every org with the setting on: every open assignment on a
 * PUBLISHED policy whose due date falls within the next N days gets ONE
 * reminder. Idempotent without a schema change: an assignment is skipped when
 * a reminder row for that person and policy already exists since the
 * assignment was created (a manual reminder from the ledger counts too, so
 * nobody is nudged twice for one deadline).
 */
export async function remindPolicyAssignmentsDue(now = new Date()): Promise<{ orgs: number; reminded: number }> {
  const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } });
  let orgCount = 0, reminded = 0;
  for (const org of orgs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const days = parseProcessSettings((org.settings as Record<string, any> | null)?.process).value.ackRemindDays;
    if (!days || days <= 0) continue;
    orgCount++;
    const until = new Date(now.getTime() + days * 86_400_000);
    const rows = await prisma.policyAssignment.findMany({
      where: { status: { not: "COMPLETED" }, dueDate: { gte: now, lte: until }, policy: { organizationId: org.id, status: "PUBLISHED", requiresAck: true } },
      select: { id: true, userId: true, dueDate: true, createdAt: true, policy: { select: { id: true, title: true } } },
    });
    if (rows.length === 0) continue;
    const already = await prisma.notification.findMany({
      where: { title: REMINDER_TITLE, userId: { in: rows.map((r) => r.userId) }, link: { in: rows.map((r) => `/policies/${r.policy.id}`) } },
      select: { userId: true, link: true, createdAt: true },
    });
    const sent = new Map<string, Date>();
    for (const n of already) { const k = `${n.userId}:${n.link}`; const prev = sent.get(k); if (!prev || n.createdAt > prev) sent.set(k, n.createdAt); }
    const due = rows.filter((r) => { const at = sent.get(`${r.userId}:/policies/${r.policy.id}`); return !at || at < r.createdAt; });
    if (due.length === 0) continue;
    const users = await prisma.user.findMany({ where: { id: { in: due.map((r) => r.userId) }, deletedAt: null }, select: { id: true, email: true } });
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const byPolicy = new Map<string, { title: string; targets: RemindTarget[] }>();
    for (const r of due) {
      if (!emailById.has(r.userId)) continue;
      const g = byPolicy.get(r.policy.id) ?? byPolicy.set(r.policy.id, { title: r.policy.title, targets: [] }).get(r.policy.id)!;
      g.targets.push({ assignmentId: r.id, userId: r.userId, email: emailById.get(r.userId) ?? "", dueDate: r.dueDate });
    }
    for (const [policyId, g] of byPolicy) reminded += await remindPolicyAssignees({ orgId: org.id, policyId, policyTitle: g.title, targets: g.targets });
  }
  return { orgs: orgCount, reminded };
}
