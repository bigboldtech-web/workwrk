import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { getUserTagIds } from "@/lib/user-tags";
import { parseAnnouncementAudience, viewerInAnnouncementAudience } from "@/lib/announcement-audience";

/**
 * ONE announcement, for /announcements/[id] (spec-talk section 2.4 Data).
 *
 * The route is new because the page is new: before Phase 4 every
 * notification and every email about an announcement linked at the LIST, so
 * the person had to find the post again in a feed, and an expired post was
 * simply gone. A direct link resolves for anyone in the audience, which is
 * what "expiry hides it from All, not from a direct link" means.
 *
 * WHO MAY READ IT is the same question the list answers, asked about one
 * row, so it reads through the same helper: the author, a manager (the
 * oversight read the list already grants), or somebody the audience targets.
 * Anybody else gets 404 rather than 403: an announcement you are not in
 * should not confirm that it exists.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const announcement = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!announcement) return jsonError("Announcement not found", 404);

  const manager = isManager(session);
  const isAuthor = announcement.authorId === userId;
  let allowed = manager || isAuthor;
  if (!allowed) {
    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, departmentId: true, officeId: true },
    });
    const tagIds = await getUserTagIds(orgId, userId);
    allowed = Boolean(viewer) && viewerInAnnouncementAudience(
      parseAnnouncementAudience(announcement.targetAudience),
      viewer!,
      tagIds,
    );
  }
  if (!allowed) return jsonError("Announcement not found", 404);

  const [mine, author] = await Promise.all([
    prisma.announcementAcknowledgment.findFirst({
      where: { announcementId: id, userId },
      select: { acknowledgedAt: true },
    }),
    announcement.authorId
      ? prisma.user.findUnique({
          where: { id: announcement.authorId },
          select: { id: true, firstName: true, lastName: true, avatar: true },
        })
      : Promise.resolve(null),
  ]);

  // Editors get the two numbers the Acknowledgments tab is built on. Every
  // reader gets their own ack state and nothing about anybody else's.
  let counts: { acknowledged: number; pending: number } | null = null;
  if (manager || isAuthor) {
    const [acknowledged, people] = await Promise.all([
      prisma.announcementAcknowledgment.count({ where: { announcementId: id } }),
      prisma.user.count({ where: { organizationId: orgId, deletedAt: null, id: { not: announcement.authorId } } }),
    ]);
    counts = { acknowledged, pending: Math.max(0, people - acknowledged) };
  }

  return jsonSuccess({
    announcement: {
      ...announcement,
      author,
      ackedByMe: Boolean(mine),
      ackedAt: mine?.acknowledgedAt ?? null,
      canEdit: manager || isAuthor,
      counts,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  // A missing or malformed body is a 400, not an unhandled throw and a bare
  // 500 with an empty response (the same audit finding the punch route was
  // fixed for).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.type !== undefined) data.type = body.type;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.pinned !== undefined) data.pinned = body.pinned;
  if (body.mustAcknowledge !== undefined) data.mustAcknowledge = body.mustAcknowledge === true;
  if (body.expiresAt !== undefined) {
    if (!body.expiresAt) return jsonError("Expiry date is required");
    const expiryDate = new Date(`${String(body.expiresAt).slice(0, 10)}T23:59:59.999Z`);
    if (isNaN(expiryDate.getTime())) return jsonError("Invalid expiry date");
    if (expiryDate.getTime() <= Date.now()) return jsonError("Expiry date must be in the future");
    data.expiresAt = expiryDate;
  }
  const updated = await prisma.announcement.update({ where: { id }, data: data as never });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  // Fetch the row before delete so we can name it in the audit log.
  // Org-scoped so a stale/cross-tenant ID never deletes someone
  // else's data even if the manager somehow obtained it.
  const target = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true },
  });
  if (!target) return jsonError("Announcement not found", 404);
  await prisma.announcement.delete({ where: { id } });
  await logActivity({
    type: "announcement.delete",
    actorId: userId,
    organizationId: orgId,
    description: `Deleted announcement: ${target.title}`,
    targetType: "Announcement",
    targetId: id,
    severity: "warning",
  });
  return jsonSuccess({ message: "Deleted" });
}
