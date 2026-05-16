import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

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
    select: { id: true, mustAcknowledge: true, organizationId: true },
  });
  if (!announcement || announcement.organizationId !== orgId) {
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
 * Admin-only — list who has and hasn't acked.
 *
 * Returns the full org user roster (minus the author) with an
 * `acknowledgedAt` field populated when the row exists. Pure
 * read-only — no side effects.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id: announcementId } = await params;
  const orgId = getOrgId(session);

  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { id: true, organizationId: true, authorId: true, mustAcknowledge: true },
  });
  if (!announcement || announcement.organizationId !== orgId) {
    return jsonError("Announcement not found", 404);
  }

  const [users, acks] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        id: { not: announcement.authorId },
      },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.announcementAcknowledgment.findMany({
      where: { announcementId },
      select: { userId: true, acknowledgedAt: true },
    }),
  ]);

  const ackMap = new Map(acks.map((a) => [a.userId, a.acknowledgedAt]));

  return jsonSuccess({
    mustAcknowledge: announcement.mustAcknowledge,
    roster: users.map((u) => ({
      ...u,
      acknowledgedAt: ackMap.get(u.id) ?? null,
    })),
    acknowledgedCount: acks.length,
    totalCount: users.length,
  });
}
