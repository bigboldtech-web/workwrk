import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const now = new Date();

  // Simple query — fetch all announcements for this org
  const announcements = await prisma.announcement.findMany({
    where: { organizationId: orgId },
    include: {
      dismissals: { where: { userId }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Filter: show active (not expired, not dismissed unless pinned)
  const active = announcements.filter((a) => {
    // Check expiry
    if (a.expiresAt && new Date(a.expiresAt) < now) return false;
    // Pinned always show
    if (a.pinned) return true;
    // Hide dismissed
    if (a.dismissals.length > 0) return false;
    return true;
  });

  return jsonSuccess(active.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    type: a.type,
    priority: a.priority,
    pinned: a.pinned,
    publishedAt: a.publishedAt,
    expiresAt: a.expiresAt,
    createdAt: a.createdAt,
    dismissed: a.dismissals.length > 0,
  })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { title, content, type, priority, pinned, expiresAt, targetAudience } = body;

  if (!title?.trim() || !content?.trim()) return jsonError("Title and content required");

  const announcement = await prisma.announcement.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      type: type || "INFO",
      priority: priority || "NORMAL",
      pinned: pinned === true,
      publishedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      targetAudience: targetAudience || null,
      authorId: userId,
      organizationId: orgId,
    },
  });

  return jsonSuccess(announcement, 201);
}
