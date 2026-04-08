import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";

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
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
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

  // Notify all org users (skip the author)
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null, id: { not: userId } },
    select: { id: true },
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
  }

  return jsonSuccess(announcement, 201);
  } catch (err: any) {
    console.error("Announcements POST error:", err);
    return jsonError(err.message || "Failed to create announcement", 500);
  }
}
