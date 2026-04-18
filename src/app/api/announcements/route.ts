import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { queueEmail, processEmailQueue } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

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

    return NextResponse.json(announcements, {
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
  const { title, content, type, priority, pinned, expiresAt, targetAudience } = body;

  if (!title?.trim() || !content?.trim()) return jsonError("Title and content required");

  try {
  const announcement = await prisma.announcement.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      type: type || "INFO",
      priority: priority || "NORMAL",
      pinned: pinned === true,
      publishedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      targetAudience: targetAudience || undefined,
      authorId: userId,
      organizationId: orgId,
    },
  });

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
      for (const u of users) {
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
        await queueEmail({
          to: u.email, subject, html,
          template: "announcement",
          variables: { title: announcement.title, priority: announcement.priority },
          organizationId: orgId, userId: u.id, category: "reminder",
        });
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
