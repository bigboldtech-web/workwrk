import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { reminderTemplate } from "@/lib/email-templates";
import { jsonSuccess, jsonError } from "@/lib/api-helpers";

// POST: Trigger overdue reminders (manual trigger endpoint for now, cron later)
// Secured by API key
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized", 401);
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const now = new Date();
  let remindersSent = 0;

  // Overdue SOP assignments
  const overdueSops = await prisma.sOPAssignment.findMany({
    where: {
      status: { notIn: ["COMPLETED"] },
      dueDate: { lt: now },
    },
    include: {
      user: { select: { id: true, email: true } },
      sop: { select: { title: true, organizationId: true } },
    },
    take: 50,
  });

  for (const assignment of overdueSops) {
    const daysOverdue = Math.ceil((now.getTime() - new Date(assignment.dueDate!).getTime()) / (1000 * 60 * 60 * 24));
    const { subject, html } = reminderTemplate({
      itemType: "SOP",
      itemTitle: assignment.sop.title,
      dueInfo: `overdue by ${daysOverdue} day${daysOverdue > 1 ? "s" : ""}`,
      itemLink: `${baseUrl}/sops/my-sops`,
    });

    await sendEmail({
      to: assignment.user.email,
      subject,
      html,
      template: "reminder",
      variables: { itemType: "SOP", itemTitle: assignment.sop.title, daysOverdue },
      organizationId: assignment.sop.organizationId,
      userId: assignment.user.id,
      category: "reminder",
    });
    remindersSent++;
  }

  return jsonSuccess({ remindersSent });
}
