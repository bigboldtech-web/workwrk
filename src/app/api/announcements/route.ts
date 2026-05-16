import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { processEmailQueue } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { logActivity } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  try {
    const now = new Date();
    const announcements = await prisma.announcement.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Decorate each row with the current user's own ack state so the
    // client doesn't need a second round-trip to render the
    // "Acknowledge"/"You've acked" affordance. Cheap: one query
    // scoped to the user, bounded by `take` above.
    const acks = await prisma.announcementAcknowledgment.findMany({
      where: { userId, announcementId: { in: announcements.map((a) => a.id) } },
      select: { announcementId: true, acknowledgedAt: true },
    });
    const ackMap = new Map(acks.map((a) => [a.announcementId, a.acknowledgedAt] as const));

    const enriched = announcements.map((a) => ({
      ...a,
      ackedByMe: ackMap.has(a.id),
      ackedAt: ackMap.get(a.id) ?? null,
    }));

    return NextResponse.json(enriched, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    console.error("Announcements GET error:", err);
    return jsonError(err.message || "Failed to fetch announcements", 500);
  }
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "announcements", "create");
  if (denied) return denied;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { title, content, type, priority, pinned, expiresAt, targetAudience, publishedAt, mustAcknowledge } = body;

  if (!title?.trim() || !content?.trim()) return jsonError("Title and content required");
  if (!expiresAt) return jsonError("Expiry date is required");
  const expiryDate = new Date(`${String(expiresAt).slice(0, 10)}T23:59:59.999Z`);
  if (isNaN(expiryDate.getTime())) return jsonError("Invalid expiry date");
  if (expiryDate.getTime() <= Date.now()) return jsonError("Expiry date must be in the future");

  // Scheduled publish: a client-supplied `publishedAt` in the future
  // means the post is deferred. Past / missing values fall back to "now"
  // so the existing UX (publish immediately) stays the default.
  let publishAt = new Date();
  let isScheduled = false;
  if (publishedAt) {
    const parsed = new Date(publishedAt);
    if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      publishAt = parsed;
      isScheduled = true;
    }
  }
  if (publishAt.getTime() >= expiryDate.getTime()) {
    return jsonError("Publish time must be before the expiry date");
  }

  try {
  const announcement = await prisma.announcement.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      type: type || "INFO",
      priority: priority || "NORMAL",
      pinned: pinned === true,
      mustAcknowledge: mustAcknowledge === true,
      publishedAt: publishAt,
      // Immediate-publish posts fire notifications inline below, so
      // mark them as already-notified up-front. Scheduled posts stay
      // NULL until the cron fires.
      notificationsSentAt: isScheduled ? null : new Date(),
      expiresAt: expiryDate,
      targetAudience: targetAudience || undefined,
      authorId: userId,
      organizationId: orgId,
    },
  });

  // Audit-log every announcement creation — must-ack posts in
  // particular surface in compliance reviews.
  await logActivity({
    type: announcement.mustAcknowledge ? "announcement.create.must_ack" : "announcement.create",
    actorId: userId,
    organizationId: orgId,
    description: `Created announcement: ${announcement.title}`,
    targetType: "Announcement",
    targetId: announcement.id,
    metadata: {
      priority: announcement.priority,
      type: announcement.type,
      mustAcknowledge: announcement.mustAcknowledge,
      scheduled: isScheduled,
    },
  });

  // Scheduled posts skip the immediate notify/email blast — the
  // `announcements-publish` cron picks them up on the publishedAt
  // boundary and fires the notification fan-out then.
  if (isScheduled) {
    return jsonSuccess({ ...announcement, scheduled: true }, 201);
  }

  // Notify all org users (skip the author). Errors here must NOT roll back
  // the announcement — it's already persisted. Log and move on.
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null, id: { not: userId } },
      select: { id: true, email: true, firstName: true },
    });
    if (users.length > 0) {
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: "announcement",
          title: `${announcement.priority === "URGENT" ? "🚨 " : ""}New Announcement`,
          message: announcement.title,
          link: "/announcements",
        })),
      });

      const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
      const preview = announcement.content.length > 280
        ? announcement.content.slice(0, 280) + "..."
        : announcement.content;
      // Batch-insert email logs (one round-trip instead of N). The "reminder"
      // category bypasses per-user preferences, so no pref lookup is needed.
      const emailLogs = users.map((u) => {
        const { subject, html } = genericNotificationTemplate({
          heading: announcement.priority === "URGENT" ? "🚨 Urgent Announcement" : "New Announcement",
          recipientName: u.firstName,
          subjectText: "A new announcement has been posted in your organization.",
          itemTitle: announcement.title,
          itemDetails: announcement.priority !== "NORMAL" ? `Priority: ${announcement.priority}` : undefined,
          actionLabel: "View Announcement",
          actionLink: `${baseUrl}/announcements`,
          note: preview,
        });
        return {
          to: u.email,
          subject,
          template: "announcement",
          html,
          variables: { title: announcement.title, priority: announcement.priority },
          organizationId: orgId,
          status: "QUEUED" as const,
        };
      });
      if (emailLogs.length > 0) {
        await prisma.emailLog.createMany({ data: emailLogs });
      }
      processEmailQueue().catch((err) => console.error("[Announcement] Queue processing failed:", err));
    }
  } catch (notifyErr) {
    console.error("[Announcement] Notification/email step failed (announcement still saved):", notifyErr);
  }

  return jsonSuccess(announcement, 201);
  } catch (err: any) {
    console.error("Announcements POST error:", err);
    return jsonError(err.message || "Failed to create announcement", 500);
  }
}
