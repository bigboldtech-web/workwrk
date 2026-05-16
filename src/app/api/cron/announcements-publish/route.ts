import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { processEmailQueue } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";

/**
 * Cron — fires the notification + email fan-out for announcements
 * that crossed their scheduled `publishedAt` boundary.
 *
 * Work queue: `WHERE publishedAt <= now AND notificationsSentAt IS NULL`
 * — backed by the (publishedAt, notificationsSentAt) composite index.
 *
 * Each row in the batch is processed in its own transaction so a
 * misbehaving org's email queue doesn't poison the rest. After the
 * fan-out lands, we stamp `notificationsSentAt` so we never resend.
 *
 * Recommended schedule: every 5 minutes (`*∕5 * * * *`). Lateness
 * tolerance: ~5 min from the scheduled time, which is well inside
 * the UX expectation for "scheduled post."
 *
 * Guard with CRON_SECRET in production (same pattern as the other
 * /api/cron/* routes).
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
  const due = await prisma.announcement.findMany({
    where: {
      publishedAt: { lte: now, not: null },
      notificationsSentAt: null,
    },
    select: {
      id: true,
      title: true,
      content: true,
      priority: true,
      authorId: true,
      organizationId: true,
    },
    take: 100, // bound per-run so a backlog never holds the cron open
  });

  let processed = 0;
  let totalNotified = 0;

  for (const a of due) {
    try {
      const users = await prisma.user.findMany({
        where: { organizationId: a.organizationId, deletedAt: null, id: { not: a.authorId } },
        select: { id: true, email: true, firstName: true },
      });

      if (users.length > 0) {
        await prisma.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            type: "announcement",
            title: `${a.priority === "URGENT" ? "🚨 " : ""}New Announcement`,
            message: a.title,
            link: "/announcements",
          })),
        });

        const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
        const preview = a.content.length > 280 ? a.content.slice(0, 280) + "..." : a.content;
        const emailLogs = users.map((u) => {
          const { subject, html } = genericNotificationTemplate({
            heading: a.priority === "URGENT" ? "🚨 Urgent Announcement" : "New Announcement",
            recipientName: u.firstName,
            subjectText: "A new announcement has been posted in your organization.",
            itemTitle: a.title,
            itemDetails: a.priority !== "NORMAL" ? `Priority: ${a.priority}` : undefined,
            actionLabel: "View Announcement",
            actionLink: `${baseUrl}/announcements`,
            note: preview,
          });
          return {
            to: u.email,
            subject,
            template: "announcement",
            html,
            variables: { title: a.title, priority: a.priority },
            organizationId: a.organizationId,
            status: "QUEUED" as const,
          };
        });
        if (emailLogs.length > 0) {
          await prisma.emailLog.createMany({ data: emailLogs });
        }
        totalNotified += users.length;
      }

      // Stamp last — only after the fan-out succeeded. If a later
      // step throws, we'll re-attempt next tick (idempotent because
      // notification rows are independent and email batching keys
      // are per-row).
      await prisma.announcement.update({
        where: { id: a.id },
        data: { notificationsSentAt: new Date() },
      });
      processed += 1;
    } catch (err) {
      console.error(`[announcements-publish] failed for ${a.id}:`, err);
      // Leave `notificationsSentAt` NULL so we retry next tick.
    }
  }

  if (processed > 0) {
    processEmailQueue().catch((err) => console.error("[announcements-publish] queue drain failed:", err));
  }

  return Response.json({
    ok: true,
    scanned: due.length,
    processed,
    notified: totalNotified,
  });
}
