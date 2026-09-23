import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { getUserTagIds } from "@/lib/user-tags";
import {
  parseAnnouncementAudience,
  resolveAnnouncementAudienceNames,
  resolveAnnouncementAudienceUserIds,
  viewerInAnnouncementAudience,
  viewerSpaceIds,
} from "@/lib/announcement-audience";
import {
  canDeleteAnnouncement,
  canEditAnnouncement,
  canOpenAnnouncements,
  canReadAnyAnnouncement,
  canSeeAckRoster,
} from "@/lib/announcement-access";
import { announcementViewer } from "@/lib/announcement-server";
import { isAnnouncementPriority, isAnnouncementType, isScheduled } from "@/lib/announcement-view";
import { parseExpiry } from "../route";

/**
 * ONE announcement, for /announcements/[id] (spec-talk.md section 2.4 Data).
 *
 * The route is new because the page is new: before Phase 4 every notification
 * and every email about an announcement linked at the LIST, so the person had
 * to find the post again in a feed, and an expired post was simply gone. A
 * direct link resolves for anyone in the audience, which is what "expiry hides
 * it from All, not from a direct link" means.
 *
 * WHO MAY READ IT is the list's question asked about one row, so it reads
 * through the same rules: the author, an oversight reader (Owner, Admin, the
 * People team), or somebody the audience targets. Anybody else gets 404 rather
 * than 403: an announcement you are not in should not confirm that it exists.
 * The one thing a link does NOT resolve early is a scheduled post: until its
 * publish instant only the people who administer it reach it (see the GET).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await announcementViewer(session as never);
  if (!canOpenAnnouncements(viewer)) return jsonError("Announcement not found", 404);

  const announcement = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!announcement) return jsonError("Announcement not found", 404);

  const facts = { authorId: announcement.authorId, organizationId: announcement.organizationId };
  const isAuthor = announcement.authorId === userId;
  const audience = parseAnnouncementAudience(announcement.targetAudience);

  let allowed = canReadAnyAnnouncement(viewer) || isAuthor;
  if (!allowed) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, departmentId: true, officeId: true },
    });
    const [tagIds, spaceIds] = await Promise.all([
      audience.type === "TAGS" ? getUserTagIds(orgId, userId) : Promise.resolve<string[]>([]),
      audience.type === "SPACE" ? viewerSpaceIds(orgId, userId) : Promise.resolve<string[]>([]),
    ]);
    allowed = Boolean(me) && viewerInAnnouncementAudience(audience, me!, tagIds, spaceIds);
  }
  if (!allowed) return jsonError("Announcement not found", 404);

  const editor = canEditAnnouncement(facts, viewer);

  // A SCHEDULED post is not readable before its publish instant, and the
  // direct link has to say so as plainly as the list does. The list already
  // learned this (a post timed for next Monday was readable by its whole
  // audience the second it was saved); the link is the easier way in, because
  // search returns every announcement in the workspace by title and body and
  // hands any signed-in person the id of a post that has not gone out.
  //
  // The people who ADMINISTER the post still open it early: the author, an
  // Owner or an Admin, the same holders as Edit, Delete and the roster.
  // Proofreading a post before it publishes, and fixing one an Admin was
  // asked to fix, both have to stay reachable. Its audience, and the People
  // team reading over the top of it, read it when it publishes.
  //
  // The gate gets publishedAt ONLY. An EXPIRED post stays readable here on
  // purpose: expiry hides a post from All, not from its own URL.
  if (!editor && isScheduled({ publishedAt: announcement.publishedAt?.toISOString() ?? null }, Date.now())) {
    return jsonError("Announcement not found", 404);
  }

  const [mine, author, audienceNames] = await Promise.all([
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
    resolveAnnouncementAudienceNames(orgId, audience),
  ]);

  // Editors get the two numbers the Acknowledgments tab is built on, and they
  // are counted over THE AUDIENCE, not over the whole organization. A post
  // aimed at one department used to report the entire company as Pending.
  //
  // BOTH numbers are counted over the SAME people, which is the audience as
  // it stands now, minus the author, exactly the set the roster in
  // [id]/acknowledge/route.ts is built from. Counting every ack row instead
  // put two numbers that disagree on one screen: an author who acknowledges
  // their own post, an Owner reading over the top of one, or somebody who has
  // since changed department, all kept a row that `expected` had already
  // dropped, so the tab read "1 of 9" above a roster reading Acknowledged (0)
  // and Pending (9). No clamp is needed: the count is restricted to
  // `expectedIds` and (announcementId, userId) is unique, so it can never run
  // past them.
  let counts: { acknowledged: number; pending: number } | null = null;
  if (canSeeAckRoster(facts, viewer)) {
    const audienceIds = await resolveAnnouncementAudienceUserIds(orgId, audience);
    const expectedIds = audienceIds.filter((u) => u !== announcement.authorId);
    const acknowledged = expectedIds.length > 0
      ? await prisma.announcementAcknowledgment.count({
          where: { announcementId: id, userId: { in: expectedIds } },
        })
      : 0;
    counts = { acknowledged, pending: expectedIds.length - acknowledged };
  }

  return jsonSuccess({
    announcement: {
      ...announcement,
      audience,
      audienceNames,
      author,
      ackedByMe: Boolean(mine),
      ackedAt: mine?.acknowledgedAt ?? null,
      canEdit: editor,
      counts,
    },
  });
}

/**
 * Edit, pin, unpin and extend expiry.
 *
 * TWO LIVE DEFECTS CLOSED HERE. The old handler checked `isManager(session)`
 * and then called `prisma.announcement.update({ where: { id } })` without
 * reading organizationId at all, so a manager in one workspace could edit an
 * announcement in another by id, and it wrote no audit row for the edit. It
 * is org-scoped, author-or-admin, and audited now.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await announcementViewer(session as never);

  const existing = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, authorId: true, organizationId: true, pinned: true },
  });
  // Cross-tenant and missing read the same: 404, never a 403 that confirms
  // the row exists somewhere.
  if (!existing) return jsonError("Announcement not found", 404);
  if (!canEditAnnouncement(existing, viewer)) {
    return jsonError("Only the author, an Owner or an Admin can change this announcement", 403);
  }

  // A missing or malformed body is a 400, not an unhandled throw and a bare
  // 500 with an empty response.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

  const data: Prisma.AnnouncementUpdateInput = {};
  if (typeof body.title === "string") {
    if (!body.title.trim()) return jsonError("Title is required");
    data.title = body.title.trim();
  }
  if (typeof body.content === "string") {
    if (!body.content.trim()) return jsonError("Content is required");
    data.content = body.content.trim();
  }
  if (body.type !== undefined) {
    if (!isAnnouncementType(body.type)) return jsonError("Unknown announcement type");
    data.type = body.type;
  }
  if (body.priority !== undefined) {
    if (!isAnnouncementPriority(body.priority)) return jsonError("Unknown priority");
    data.priority = body.priority;
  }
  if (body.pinned !== undefined) data.pinned = body.pinned === true;
  if (body.mustAcknowledge !== undefined) data.mustAcknowledge = body.mustAcknowledge === true;
  if (body.expiresAt !== undefined) {
    // null is "No expiry" and is a real answer now, not a validation error.
    const parsed = parseExpiry(body.expiresAt as string | null);
    if (parsed === "invalid") return jsonError("Invalid expiry date");
    if (parsed && parsed.getTime() <= Date.now()) return jsonError("Expiry date must be in the future");
    data.expiresAt = parsed;
  }
  if (Object.keys(data).length === 0) return jsonError("Nothing to change");

  const updated = await prisma.announcement.update({ where: { id }, data });

  await logActivity({
    type: "announcement.update",
    actorId: userId,
    organizationId: orgId,
    description: `Updated announcement: ${updated.title}`,
    targetType: "Announcement",
    targetId: id,
    metadata: { fields: Object.keys(data) },
  });

  return jsonSuccess(updated);
}

/** Delete. The author, an Owner or an Admin, org-scoped, audited. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await announcementViewer(session as never);

  const target = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, authorId: true, organizationId: true },
  });
  if (!target) return jsonError("Announcement not found", 404);
  if (!canDeleteAnnouncement(target, viewer)) {
    return jsonError("Only the author, an Owner or an Admin can delete this announcement", 403);
  }

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
