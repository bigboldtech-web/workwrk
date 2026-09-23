// One meeting: read, edit, delete.
//
// ACCESS CHANGED IN PHASE 4. All three verbs used to scope to
// organizationId alone, so any Member could read, edit or hard-delete any
// meeting in the company, including one to ones they were not in. The
// ladder now lives in src/lib/meeting-access.ts and is the same one the
// list route scopes by: creator or org admin is Full access, an attendee
// is Can edit, and everyone else gets 404 rather than 403, because a
// meeting you do not attend is not discoverable (spec-planner.md
// section 1 Access).
//
// DELETE goes through THE ONE TRASH from this release on
// (src/lib/trash.ts). It snapshots the meeting with its attendees and its
// action items, then removes the live row, so the meeting can be restored
// from /trash and its signed guest link stops resolving the moment it is
// deleted. Before Phase 4 it was prisma.meeting.delete, which was final.
//
// `Meeting.deletedAt` still exists and every read here still filters on it.
// That is deliberate and it is not the delete path: it hides any row an
// earlier build soft-deleted, so nothing that was made invisible becomes
// visible again on upgrade.

import { NextRequest } from "next/server";
import { meetingRoomName, meetingGuestCode, meetingGuestExpiry } from "@/lib/meeting-room";
import { MEETING_TYPES, isMeetingType, type MeetingTypeWord } from "@/lib/meeting-type";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { logItemActivity } from "@/lib/activity/log";
import { canDeleteMeeting, canEditMeeting, canReadMeeting, meetingRole } from "@/lib/meeting-access";
import { moveToTrash } from "@/lib/trash";

/** Load the meeting plus the facts the access ladder needs. */
async function loadForAccess(id: string, orgId: string) {
  return prisma.meeting.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: {
      id: true,
      title: true,
      type: true,
      scheduledAt: true,
      createdById: true,
      attendees: { select: { userId: true } },
    },
  });
}

// GET: meeting detail with attendees, action items and notes.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const viewerId = getUserId(session);
  const isOrgAdmin = legacyIsAdminLevel(session.user.accessLevel);

  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
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

  const facts = {
    viewerId,
    isOrgAdmin,
    createdById: meeting.createdById,
    attendeeIds: meeting.attendees.map((a) => a.userId),
  };
  if (!canReadMeeting(facts)) return jsonError("Meeting not found", 404);

  // Call-layer fields, derived and never stored: the in-app room and the
  // public guest URL (external people and AI notetaker bots). `jitsiUrl` is
  // gone with the public fallback (decision Q1): the product no longer hands
  // anybody a third-party room.
  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  const guestExpiresAt = meetingGuestExpiry(meeting.scheduledAt, meeting.duration);
  return jsonSuccess({
    ...meeting,
    // What the page may render, decided once here rather than re-guessed
    // in the client. A control the role cannot use is not rendered.
    viewerRole: meetingRole(facts),
    canEdit: canEditMeeting(facts),
    canDelete: canDeleteMeeting(facts),
    call: {
      room: meetingRoomName(meeting.id),
      // The guest code now carries its own expiry (spec-talk section 2.5):
      // the meeting's scheduled END plus 24 hours. Re-reading the meeting
      // mints a FRESH code, so a link copied the morning of a rescheduled
      // meeting still lands, and a link forwarded out of an email thread in
      // March stops opening the room in December.
      guestUrl: `${base}/meet/${meetingGuestCode(meeting.id, guestExpiresAt)}`,
      guestExpiresAt: new Date(guestExpiresAt).toISOString(),
    },
  });
}

// PUT: edit meeting.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const actorId = getUserId(session);

  const meeting = await loadForAccess(id, orgId);
  if (!meeting) return jsonError("Meeting not found", 404);

  const facts = {
    viewerId: actorId,
    isOrgAdmin: legacyIsAdminLevel(session.user.accessLevel),
    createdById: meeting.createdById,
    attendeeIds: meeting.attendees.map((a) => a.userId),
  };
  // 404, not 403: a meeting a person does not attend does not exist for
  // them, and a 403 would confirm that it does.
  if (!canEditMeeting(facts)) return jsonError("Meeting not found", 404);

  // A missing or malformed body answers the contract, not a bare 500 with an
  // empty response (audit C-1, the same fix the punch route carries).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return jsonError("Nothing to update: send at least one field");
  }
  const { title, type, scheduledAt, duration, agenda, notes, decisions, attendeeIds } = body as {
    title?: unknown; type?: unknown; scheduledAt?: unknown; duration?: unknown;
    agenda?: unknown; notes?: unknown; decisions?: unknown; attendeeIds?: unknown;
  };
  // The same enum guard POST carries, for the same reason: a word outside
  // enum MeetingType answered a 500 from the database.
  if (type !== undefined && !isMeetingType(type)) {
    return jsonError(`type must be one of: ${MEETING_TYPES.join(", ")}`);
  }
  let when: Date | undefined;
  if (scheduledAt !== undefined) {
    const d = new Date(String(scheduledAt));
    if (Number.isNaN(d.getTime())) return jsonError("scheduledAt must be a date");
    when = d;
  }
  let durationMinutes: number | undefined;
  if (duration !== undefined) {
    const n = Number(duration);
    if (!Number.isFinite(n) || n <= 0 || n > 24 * 60) return jsonError("duration must be 1 to 1440 minutes");
    durationMinutes = Math.round(n);
  }
  // THE TEXT COLUMNS ARE CHECKED LIKE EVERY OTHER FIELD. `title`, `agenda`
  // and `notes` used to be cast straight through with `as string | null`,
  // which is a lie the type system cannot catch: a number or an object then
  // reached a String? column and Prisma threw, so PUT answered a bare 500
  // with an EMPTY BODY on the route whose own header promises audit C-1 is
  // fixed here. The body parse was guarded; the fields inside it were not.
  // A caller now gets the contract back, and the save path on the meeting
  // page gets an error it can actually show the person.
  for (const [name, value] of [["title", title], ["agenda", agenda], ["notes", notes]] as const) {
    if (value === undefined) continue;
    // null clears agenda and notes. Title has no empty state: a blank one is
    // ignored below rather than wiping the only name the meeting has.
    if (value === null && name !== "title") continue;
    if (typeof value !== "string") return jsonError(`${name} must be text`);
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
      type: (type as MeetingTypeWord | undefined) ?? undefined,
      scheduledAt: when,
      duration: durationMinutes,
      agenda: agenda !== undefined ? (agenda as string | null) : undefined,
      notes: notes !== undefined ? (notes as string | null) : undefined,
      // `decisions` is a String? column holding a JSON list, so an object
      // arriving from a client is serialised here rather than stringified by
      // accident into "[object Object]" further down.
      decisions: decisions === undefined
        ? undefined
        : decisions === null
          ? null
          : typeof decisions === "string" ? decisions : JSON.stringify(decisions),
    },
  });

  // Per-item activity feed
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
  if (when && when.getTime() !== new Date(meeting.scheduledAt).getTime()) {
    logItemActivity({
      organizationId: orgId, entityType: "meeting", entityId: id,
      actorId, action: "field_changed",
      meta: { field: "scheduledAt", previousValue: meeting.scheduledAt.toISOString(), value: when.toISOString() },
    });
  }

  // Update attendees if provided.
  //
  // TWO GUARDS, both of which a plain `deleteMany` without them got wrong:
  //
  //  1. THE SET IS ORG SCOPED. `attendeeIds` was written straight through,
  //     so a body naming a user in ANOTHER organization added them as an
  //     attendee of this one, and a body naming an id that does not exist
  //     answered a bare 500 from the foreign key. Ids are resolved against
  //     this org first; anything else is dropped silently, the way every
  //     other write in this unit drops a foreign itemId.
  //
  //  2. THE SET IS NEVER EMPTIED. The creator is kept, and so is the person
  //     making the edit. `createdById` is null on every meeting written
  //     before Phase 4, so the creator rule alone let one attendee send
  //     `attendeeIds: []` and leave the row with no creator and no
  //     attendees, which canReadMeeting answers "none" for everybody below
  //     Admin: the meeting, its notes, its decisions and its action items
  //     become unreachable for the person who just did it and for every
  //     colleague who was in it, with no undo.
  if (Array.isArray(attendeeIds)) {
    const asked = attendeeIds.filter((x: unknown): x is string => typeof x === "string");
    const inOrg = asked.length
      ? await prisma.user.findMany({
          where: { id: { in: asked }, organizationId: orgId },
          select: { id: true },
        })
      : [];
    const next = new Set<string>(inOrg.map((u) => u.id));
    if (meeting.createdById) next.add(meeting.createdById);
    next.add(actorId);
    await prisma.meetingAttendee.deleteMany({ where: { meetingId: id, userId: { notIn: [...next] } } });
    await prisma.meetingAttendee.createMany({
      data: [...next].map((uid) => ({ meetingId: id, userId: uid })),
      skipDuplicates: true,
    });
  }

  return jsonSuccess(updated);
}

// DELETE: into the one Trash, so the meeting can be restored.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const actorId = getUserId(session);

  const meeting = await loadForAccess(id, orgId);
  if (!meeting) return jsonError("Meeting not found", 404);

  const facts = {
    viewerId: actorId,
    isOrgAdmin: legacyIsAdminLevel(session.user.accessLevel),
    createdById: meeting.createdById,
    attendeeIds: meeting.attendees.map((a) => a.userId),
  };
  if (!canDeleteMeeting(facts)) {
    // An attendee can read and edit but may not take the meeting away from
    // everyone else, so this one IS a 403: they can see it, they just
    // cannot do this.
    if (canReadMeeting(facts)) {
      return jsonError("Only the person who scheduled this meeting can delete it.", 403);
    }
    return jsonError("Meeting not found", 404);
  }

  const moved = await moveToTrash("meeting", id, {
    organizationId: orgId,
    userId: actorId,
    userName: [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || null,
  });
  if (!moved) return jsonError("Meeting not found", 404);

  logItemActivity({
    organizationId: orgId, entityType: "meeting", entityId: id,
    actorId, action: "deleted", meta: { title: meeting.title },
  });

  return jsonSuccess({ message: "Meeting moved to Trash" });
}
