import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifySlack } from "@/services/slackNotifier";

/**
 * POST /api/tasks/run-sla-check
 *
 * Cron-style endpoint. Finds every open task whose SLA has elapsed,
 * escalates it one level up the reporting chain, marks it as escalated,
 * and drops an in-app Notification on both the original assignee and
 * the escalation target. Optionally fires a Slack webhook if the org
 * has a Slack integration configured.
 *
 * Idempotent — already-escalated tasks are skipped.
 *
 * Designed to be hit by:
 *   • A Vercel Cron / GitHub Action on a fixed interval (every 15 min)
 *   • A manual admin trigger from /settings → Ops
 *   • The admin "escalate overdue" button anywhere
 *
 * Auth: gated by `CRON_SECRET` env var in production. In dev, any POST
 * works.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const now = new Date();
  const HOUR = 60 * 60 * 1000;

  // Pull every open task that has an SLA set, isn't already escalated,
  // and is past its SLA horizon. Keep the join light.
  const candidates = await prisma.task.findMany({
    where: {
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      escalatedAt: null,
      slaHours: { not: null },
    },
    select: {
      id: true,
      title: true,
      date: true,
      slaHours: true,
      priority: true,
      organizationId: true,
      assignee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          managerId: true,
        },
      },
    },
    take: 500,
  });

  const toEscalate = candidates.filter((t) => {
    if (!t.slaHours) return false;
    const deadline = new Date(t.date.getTime() + t.slaHours * HOUR);
    return deadline < now;
  });

  // Escalations are independent across tasks — run them in parallel so
  // one slow Slack call doesn't hold up 500 subsequent tasks.
  const results = await Promise.all(
    toEscalate.map(async (t) => {
      const targetId = t.assignee.managerId;

      const notifyPayload = [
        {
          userId: t.assignee.id,
          title: "Your task just escalated",
          message: `"${t.title}" is past its ${t.slaHours}h SLA. ${
            targetId ? "Escalated to your manager." : "Visible to admins."
          }`,
          type: "TASK_ESCALATED",
          link: `/tasks?id=${t.id}`,
        },
      ];
      if (targetId) {
        notifyPayload.push({
          userId: targetId,
          title: "A direct report's task escalated",
          message: `"${t.title}" breached its ${t.slaHours}h SLA — it's now on your plate.`,
          type: "TASK_ESCALATED",
          link: `/tasks?id=${t.id}`,
        });
      }

      await Promise.all([
        prisma.task.update({
          where: { id: t.id },
          data: {
            escalatedAt: now,
            escalatedToId: targetId,
            priority: t.priority === "URGENT" ? "URGENT" : "HIGH",
          },
        }),
        prisma.notification.createMany({ data: notifyPayload }),
        notifySlack({
          organizationId: t.organizationId,
          text: `🔺 *Task escalated*: _${t.title}_ · SLA ${t.slaHours}h breached · assignee ${t.assignee.firstName} ${t.assignee.lastName}${
            targetId ? " · now routed up the chain" : ""
          }`,
        }).catch(() => {
          // Non-fatal — Slack failures never break the SLA job.
        }),
      ]);

      return { id: t.id, escalatedTo: targetId };
    }),
  );
  const escalatedCount = results.length;

  return Response.json({
    ran: true,
    at: now.toISOString(),
    scanned: candidates.length,
    escalated: escalatedCount,
    results,
  });
}

// Lightweight GET for manual "dry run" — just reports what *would* escalate
// without actually doing anything.
export async function GET(_req: NextRequest) {
  const now = new Date();
  const HOUR = 60 * 60 * 1000;
  const candidates = await prisma.task.findMany({
    where: {
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      escalatedAt: null,
      slaHours: { not: null },
    },
    select: {
      id: true,
      title: true,
      date: true,
      slaHours: true,
      organizationId: true,
      assignee: {
        select: { firstName: true, lastName: true, managerId: true },
      },
    },
    take: 100,
  });
  const overdue = candidates.filter((t) => {
    if (!t.slaHours) return false;
    return new Date(t.date.getTime() + t.slaHours * HOUR) < now;
  });
  return Response.json({
    now: now.toISOString(),
    wouldEscalate: overdue.length,
    tasks: overdue.map((t) => ({
      id: t.id,
      title: t.title,
      slaHours: t.slaHours,
      assignee: `${t.assignee.firstName} ${t.assignee.lastName}`,
      hasManager: !!t.assignee.managerId,
    })),
  });
}
