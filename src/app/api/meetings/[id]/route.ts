import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { logItemActivity } from "@/lib/activity/log";

// GET: Get meeting detail with attendees, action items, notes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: orgId },
    include: {
      attendees: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true, email: true } },
        },
      },
      actionItems: {
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!meeting) return jsonError("Meeting not found", 404);

  return jsonSuccess(meeting);
}

// PUT: Edit meeting
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!meeting) return jsonError("Meeting not found", 404);

  const body = await req.json();
  const { title, type, scheduledAt, duration, agenda, notes, decisions, attendeeIds } = body;

  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      title: title ?? undefined,
      type: type ?? undefined,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      duration: duration ?? undefined,
      agenda: agenda !== undefined ? agenda : undefined,
      notes: notes !== undefined ? notes : undefined,
      decisions: decisions !== undefined ? decisions : undefined,
    },
  });

  // Per-item activity feed
  const actorId = getUserId(session);
  if (typeof title === "string" && title !== meeting.title) {
    logItemActivity({
      organizationId: orgId, entityType: "meeting", entityId: id,
      actorId, action: "renamed", meta: { from: meeting.title, to: title },
    });
  }
  if (typeof type === "string" && type !== meeting.type) {
    logItemActivity({
      organizationId: orgId, entityType: "meeting", entityId: id,
      actorId, action: "field_changed",
      meta: { field: "type", previousValue: meeting.type, value: type },
    });
  }
  if (scheduledAt && new Date(scheduledAt).getTime() !== new Date(meeting.scheduledAt).getTime()) {
    logItemActivity({
      organizationId: orgId, entityType: "meeting", entityId: id,
      actorId, action: "field_changed",
      meta: { field: "scheduledAt", previousValue: meeting.scheduledAt.toISOString(), value: new Date(scheduledAt).toISOString() },
    });
  }

  // Update attendees if provided
  if (attendeeIds) {
    await prisma.meetingAttendee.deleteMany({ where: { meetingId: id } });
    if (attendeeIds.length > 0) {
      await prisma.meetingAttendee.createMany({
        data: attendeeIds.map((uid: string) => ({ meetingId: id, userId: uid })),
      });
    }
  }

  return jsonSuccess(updated);
}

// DELETE: Delete meeting
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!meeting) return jsonError("Meeting not found", 404);

  await prisma.meeting.delete({ where: { id } });

  return jsonSuccess({ message: "Meeting deleted" });
}
