import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  reminderTemplate,
  evaluationReminderTemplate,
  overdueManagerTemplate,
} from "@/lib/email-templates";

// Triggered by cron: 1st of month (monthly-evaluation, kpi-recording) + every Monday (overdue, policy-ack)
// Authorization: Bearer CRON_SECRET
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type } = await req.json().catch(() => ({ type: "all" }));
  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  const results: string[] = [];
  const now = new Date();

  // ──────────────────────────────────────
  // 1. MONTHLY EVALUATION REMINDERS (1st of month)
  // Send to every manager who has direct reports
  // ──────────────────────────────────────
  if (type === "all" || type === "monthly-evaluation") {
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const lastMonth = monthNames[now.getMonth() === 0 ? 11 : now.getMonth() - 1];
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const managers = await prisma.user.findMany({
      where: { deletedAt: null, directReports: { some: { deletedAt: null } } },
      select: {
        id: true, email: true, firstName: true, organizationId: true,
        directReports: { where: { deletedAt: null }, select: { firstName: true, lastName: true } },
      },
    });

    for (const mgr of managers) {
      if (mgr.directReports.length === 0) continue;
      const { subject, html } = evaluationReminderTemplate({
        managerName: mgr.firstName,
        teamMembers: mgr.directReports.map((r) => `${r.firstName} ${r.lastName}`),
        month: `${lastMonth} ${year}`,
        evaluationLink: `${baseUrl}/kra-kpi`,
      });
      try {
        await sendEmail({ to: mgr.email, subject, html, template: "evaluation-reminder",
          variables: { month: `${lastMonth} ${year}`, teamCount: mgr.directReports.length },
          organizationId: mgr.organizationId, category: "reminder" });
      } catch (err: any) { console.error(`[Reminder] Evaluation to ${mgr.email}:`, err.message); }
    }
    results.push(`Monthly evaluation: ${managers.length} managers`);
  }

  // ──────────────────────────────────────
  // 2. OVERDUE SOPs → user + manager summary
  // ──────────────────────────────────────
  if (type === "all" || type === "overdue-sops") {
    const overdueSops = await prisma.sOPAssignment.findMany({
      where: { status: { not: "COMPLETED" }, dueDate: { lt: now } },
      include: {
        sop: { select: { title: true, organizationId: true } },
        user: { select: { id: true, email: true, firstName: true, lastName: true,
          manager: { select: { id: true, email: true, firstName: true } } } },
      },
      take: 200,
    });

    // Notify users
    for (const a of overdueSops) {
      const days = Math.floor((now.getTime() - new Date(a.dueDate!).getTime()) / 86400000);
      const { subject, html } = reminderTemplate({
        itemType: "SOP", itemTitle: a.sop.title,
        dueInfo: `overdue by ${days} day${days > 1 ? "s" : ""}`,
        itemLink: `${baseUrl}/sops/my-sops`,
      });
      try {
        await sendEmail({ to: a.user.email, subject, html, template: "overdue-sop",
          variables: { itemTitle: a.sop.title, daysOverdue: days },
          organizationId: a.sop.organizationId, userId: a.user.id, category: "sop" });
      } catch {}
    }

    // Manager summary
    const mgrMap = new Map<string, { mgr: any; items: any[] }>();
    for (const a of overdueSops) {
      if (!a.user.manager) continue;
      const mId = a.user.manager.id;
      if (!mgrMap.has(mId)) mgrMap.set(mId, { mgr: a.user.manager, items: [] });
      mgrMap.get(mId)!.items.push({
        type: "SOP", title: a.sop.title,
        personName: `${a.user.firstName} ${a.user.lastName}`,
        daysOverdue: Math.floor((now.getTime() - new Date(a.dueDate!).getTime()) / 86400000),
      });
    }
    for (const [, e] of mgrMap) {
      const { subject, html } = overdueManagerTemplate({
        managerName: e.mgr.firstName, items: e.items, dashboardLink: `${baseUrl}/dashboard`,
      });
      try {
        await sendEmail({ to: e.mgr.email, subject, html, template: "overdue-manager",
          variables: { count: e.items.length }, category: "reminder" });
      } catch {}
    }
    results.push(`Overdue SOPs: ${overdueSops.length} users, ${mgrMap.size} managers`);
  }

  // ──────────────────────────────────────
  // 3. OVERDUE TASKS → manager summary
  // ──────────────────────────────────────
  if (type === "all" || type === "overdue-tasks") {
    const overdueTasks = await prisma.task.findMany({
      where: { status: { not: "COMPLETED" }, date: { lt: now } },
      include: {
        assignee: { select: { id: true, email: true, firstName: true, lastName: true,
          manager: { select: { id: true, email: true, firstName: true } } } },
      },
      take: 200,
    });

    const mgrMap = new Map<string, { mgr: any; items: any[] }>();
    for (const t of overdueTasks) {
      if (!t.assignee.manager) continue;
      const mId = t.assignee.manager.id;
      if (!mgrMap.has(mId)) mgrMap.set(mId, { mgr: t.assignee.manager, items: [] });
      mgrMap.get(mId)!.items.push({
        type: "Task", title: t.title,
        personName: `${t.assignee.firstName} ${t.assignee.lastName}`,
        daysOverdue: Math.floor((now.getTime() - new Date(t.date).getTime()) / 86400000),
      });
    }
    for (const [, e] of mgrMap) {
      const { subject, html } = overdueManagerTemplate({
        managerName: e.mgr.firstName, items: e.items, dashboardLink: `${baseUrl}/tasks`,
      });
      try {
        await sendEmail({ to: e.mgr.email, subject, html, template: "overdue-tasks-manager",
          variables: { count: e.items.length }, category: "reminder" });
      } catch {}
    }
    results.push(`Overdue tasks: ${overdueTasks.length} tasks, ${mgrMap.size} managers`);
  }

  // ──────────────────────────────────────
  // 4. KPI RECORDING REMINDERS (monthly)
  // ──────────────────────────────────────
  if (type === "all" || type === "kpi-recording") {
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const assignments = await prisma.kRAAssignment.findMany({
      where: { status: "ACTIVE" },
      select: { userId: true, user: { select: { id: true, email: true, firstName: true, organizationId: true } } },
    });
    const uniqueUsers = new Map<string, any>();
    for (const a of assignments) uniqueUsers.set(a.userId, a.user);

    let sent = 0;
    for (const [userId, user] of uniqueUsers) {
      const existing = await prisma.kPIRecord.count({ where: { userId, period: currentPeriod } });
      if (existing === 0) {
        const { subject, html } = reminderTemplate({
          itemType: "KPI Recording", itemTitle: `Monthly update for ${currentPeriod}`,
          dueInfo: "due this month", itemLink: `${baseUrl}/kra-kpi`,
        });
        try {
          await sendEmail({ to: user.email, subject: "Time to record your KPIs", html,
            template: "kpi-recording", variables: { period: currentPeriod },
            organizationId: user.organizationId, userId, category: "kra" });
          sent++;
        } catch {}
      }
    }
    results.push(`KPI recording reminders: ${sent} of ${uniqueUsers.size} users`);
  }

  // ──────────────────────────────────────
  // 5. POLICY ACKNOWLEDGMENT REMINDERS (weekly)
  // ──────────────────────────────────────
  if (type === "all" || type === "policy-ack") {
    const policies = await prisma.policy.findMany({
      where: { status: "PUBLISHED", requiresAck: true },
      select: { id: true, title: true, organizationId: true },
    });
    let reminded = 0;
    for (const p of policies) {
      const allUsers = await prisma.user.findMany({
        where: { organizationId: p.organizationId, deletedAt: null },
        select: { id: true, email: true },
      });
      const acked = new Set((await prisma.policyAcknowledgment.findMany({
        where: { policyId: p.id }, select: { userId: true },
      })).map((a) => a.userId));

      for (const u of allUsers.filter((u) => !acked.has(u.id))) {
        const { subject, html } = reminderTemplate({
          itemType: "Policy", itemTitle: p.title,
          dueInfo: "pending acknowledgment", itemLink: `${baseUrl}/policies`,
        });
        try {
          await sendEmail({ to: u.email, subject: `Please acknowledge: ${p.title}`, html,
            template: "policy-ack", variables: { title: p.title },
            organizationId: p.organizationId, userId: u.id, category: "reminder" });
          reminded++;
        } catch {}
      }
    }
    results.push(`Policy ack reminders: ${reminded} users`);
  }

  return NextResponse.json({ success: true, results });
}
