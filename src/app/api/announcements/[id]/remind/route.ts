import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { canSeeAckRoster } from "@/lib/announcement-access";
import { announcementViewer } from "@/lib/announcement-server";
import { parseAnnouncementAudience, resolveAnnouncementAudienceUserIds } from "@/lib/announcement-audience";
import { REMIND_COOLOFF_MS, remindCooloff } from "@/lib/announcement-view";

/**
 * Remind the people who have not acknowledged yet (spec-talk.md section 2.4).
 *
 * WHY IT EXISTS. A must-acknowledge announcement used to be a one-shot: the
 * author could see who had not read it and had no way to ask them again
 * except by posting a second announcement, which everybody who HAD read the
 * first one also received. The Acknowledgments tab now has one secondary
 * button that writes a notification to the pending people only.
 *
 * THE COOL-OFF IS THE POINT. Once per 24 hours, enforced here and not only in
 * the button's disabled state, because a disabled button is a suggestion and
 * a second tab is not bound by it. The last reminder is read back from the
 * audit log rather than from a new column, so there is no schema change, the
 * record is the same row compliance already reads, and a workspace whose log
 * is empty simply allows the first reminder.
 *
 * GET returns the cool-off so the tab can render the real label
 * ("Reminded 3h ago") before anybody presses anything.
 */

const ACTIVITY_TYPE = "announcement.remind";

async function lastRemindedAt(orgId: string, announcementId: string): Promise<string | null> {
  try {
    const row = await prisma.activityLog.findFirst({
      where: { organizationId: orgId, type: ACTIVITY_TYPE, targetType: "Announcement", targetId: announcementId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return row?.createdAt.toISOString() ?? null;
  } catch {
    // An unreadable log must not block a reminder that people are waiting on.
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const viewer = await announcementViewer(session as never);

  const announcement = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, authorId: true, organizationId: true },
  });
  if (!announcement) return jsonError("Announcement not found", 404);
  if (!canSeeAckRoster(announcement, viewer)) return jsonError("Forbidden", 403);

  const last = await lastRemindedAt(orgId, id);
  return jsonSuccess({ lastRemindedAt: last, ...remindCooloff(last, Date.now()) });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await announcementViewer(session as never);

  const announcement = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, authorId: true, organizationId: true, mustAcknowledge: true, targetAudience: true },
  });
  if (!announcement) return jsonError("Announcement not found", 404);
  if (!canSeeAckRoster(announcement, viewer)) {
    return jsonError("Only the author, an Owner or an Admin can send a reminder", 403);
  }
  if (!announcement.mustAcknowledge) {
    return jsonError("This announcement does not ask for an acknowledgment", 400);
  }

  const last = await lastRemindedAt(orgId, id);
  const cool = remindCooloff(last, Date.now());
  if (cool.blocked) {
    return jsonError(`${cool.label}. You can remind again once a day.`, 429);
  }

  const audienceIds = await resolveAnnouncementAudienceUserIds(
    orgId,
    parseAnnouncementAudience(announcement.targetAudience),
  );
  const acked = new Set(
    (await prisma.announcementAcknowledgment.findMany({
      where: { announcementId: id },
      select: { userId: true },
    })).map((a) => a.userId),
  );
  const pending = audienceIds.filter((u) => u !== announcement.authorId && !acked.has(u));

  if (pending.length === 0) {
    return jsonSuccess({ reminded: 0, lastRemindedAt: last, message: "Everybody has acknowledged this" });
  }

  // A reminder is always its own row: it must not be swallowed by an earlier
  // unread notification about the same post, which is the whole reason the
  // author is pressing the button.
  await prisma.notification.createMany({
    data: pending.map((uid) => ({
      userId: uid,
      type: "announcement_ack",
      title: "Reminder to acknowledge",
      message: announcement.title,
      link: `/announcements/${id}`,
    })),
  });

  await logActivity({
    type: ACTIVITY_TYPE,
    actorId: userId,
    organizationId: orgId,
    description: `Reminded ${pending.length} people about: ${announcement.title}`,
    targetType: "Announcement",
    targetId: id,
    metadata: { pending: pending.length },
  });

  const now = new Date().toISOString();
  return jsonSuccess({
    reminded: pending.length,
    lastRemindedAt: now,
    nextAllowedAt: new Date(Date.now() + REMIND_COOLOFF_MS).toISOString(),
  });
}
