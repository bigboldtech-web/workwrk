import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { canSeeAckRoster } from "@/lib/announcement-access";
import { announcementViewer } from "@/lib/announcement-server";
import { parseAnnouncementAudience, resolveAnnouncementAudienceUserIds } from "@/lib/announcement-audience";

/**
 * Acknowledge a must-ack announcement.
 *
 * - Idempotent: upsert on (announcementId, userId) so double-clicks
 *   don't error and the existing ack timestamp is preserved.
 * - Scope-checked: the announcement must belong to the caller's org.
 *   We refuse cross-org acks even if the IDs collide.
 * - Captures the requesting IP (best-effort from forwarded headers)
 *   for the audit-trail surface, matching PolicyAcknowledgment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: announcementId } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: {
      id: true, mustAcknowledge: true, organizationId: true,
      // For the publish check below. It was not selected, so it could not be
      // checked, which is how the gap got here.
      publishedAt: true, createdAt: true,
    },
  });
  if (!announcement || announcement.organizationId !== orgId) {
    return jsonError("Announcement not found", 404);
  }
  // A SCHEDULED POST CANNOT BE ACKNOWLEDGED BEFORE IT PUBLISHES.
  //
  // This route checked the org and `mustAcknowledge` and nothing else. The
  // detail route now refuses to serve a scheduled post to its audience, so
  // the UI path here is closed, but the endpoint was still reachable
  // directly: a POST before the publish instant wrote a real ack row, and
  // the author would later read an acknowledgement for a post nobody had
  // been shown. The row is also the thing the reminder and the roster count,
  // so one forged ack silently removes that person from both.
  //
  // 404 rather than 403, matching the line above: to someone outside the
  // audience of an unpublished post, it does not exist yet.
  const publishedMs = (announcement.publishedAt ?? announcement.createdAt).getTime();
  if (publishedMs > Date.now()) {
    return jsonError("Announcement not found", 404);
  }
  if (!announcement.mustAcknowledge) {
    return jsonError("This announcement does not require acknowledgment", 400);
  }

  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

  const result = await prisma.announcementAcknowledgment.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId, ipAddress: ip },
    update: {}, // never overwrite the original ack timestamp
  });

  // First-time acks (and only first-time — upsert no-ops on dupe so
  // we'd double-log otherwise) get an audit-log entry for compliance
  // pulls. Detect new vs existing by whether acknowledgedAt is within
  // the last 5 seconds of "now".
  const isNewAck = Date.now() - new Date(result.acknowledgedAt).getTime() < 5000;
  if (isNewAck) {
    logActivity({
      type: "announcement.acknowledge",
      actorId: userId,
      organizationId: orgId,
      description: `Acknowledged announcement`,
      targetId: announcementId,
      targetType: "Announcement",
      ipAddress: ip,
    });
  }

  return jsonSuccess({ acknowledged: true });
}

/**
 * Who has and who has not acknowledged, for the Acknowledgments tab.
 *
 * THE ROSTER IS THE AUDIENCE, not the organization (comms #9). The old
 * version returned every non-deleted user in the workspace minus the author
 * and never resolved `targetAudience`, so a post aimed at one department
 * reported the whole company as Pending and the dialog it fed literally
 * labelled itself "Organization-wide". A targeted post now reports the people
 * it was actually sent to, which is the only number that means anything.
 *
 * WHO MAY SEE IT is the same rule as Edit: the author, Owners and Admins. A
 * legacy manager level is no longer enough.
 *
 * Pure read, no side effects.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: announcementId } = await params;
  const orgId = getOrgId(session);
  const viewer = await announcementViewer(session as never);

  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, organizationId: orgId },
    select: { id: true, organizationId: true, authorId: true, mustAcknowledge: true, targetAudience: true },
  });
  if (!announcement) return jsonError("Announcement not found", 404);
  if (!canSeeAckRoster(announcement, viewer)) {
    return jsonError("Only the author, an Owner or an Admin can see the roster", 403);
  }

  const audienceIds = await resolveAnnouncementAudienceUserIds(
    orgId,
    parseAnnouncementAudience(announcement.targetAudience),
  );
  const expectedIds = audienceIds.filter((u) => u !== announcement.authorId);

  const [users, acks] = await Promise.all([
    expectedIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: expectedIds }, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true, avatar: true, department: { select: { name: true } } },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      : Promise.resolve([]),
    prisma.announcementAcknowledgment.findMany({
      where: { announcementId },
      select: { userId: true, acknowledgedAt: true },
    }),
  ]);

  const ackMap = new Map(acks.map((a) => [a.userId, a.acknowledgedAt]));
  const roster = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    avatar: u.avatar,
    department: u.department?.name ?? null,
    acknowledgedAt: ackMap.get(u.id) ?? null,
  }));

  return jsonSuccess({
    mustAcknowledge: announcement.mustAcknowledge,
    roster,
    acknowledgedCount: roster.filter((r) => r.acknowledgedAt).length,
    totalCount: roster.length,
  });
}
