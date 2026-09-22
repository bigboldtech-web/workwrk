import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { canEditMeeting, canReadMeeting } from "@/lib/meeting-access";
import { createPersonalTask } from "@/lib/work/personal-task";
import type { Session } from "next-auth";

/**
 * The meeting these action items belong to, and whether this viewer may
 * read or change it.
 *
 * WHY THIS IS HERE. Phase 4 scoped GET/PUT/DELETE on /api/meetings/[id]
 * to the meeting-access ladder, and these four verbs were left scoped to
 * organizationId alone. That left a hole in the same object: a Member who
 * gets 404 opening a one to one could still read its action items, who
 * they were assigned to and when they were due, and could tick them off,
 * rename them and delete them, by calling this route directly. The ladder
 * is the same one the parent route uses, so the two cannot drift.
 */
async function loadMeeting(id: string, session: Session) {
  const orgId = getOrgId(session);
  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, title: true, createdById: true, attendees: { select: { userId: true } } },
  });
  if (!meeting) return null;
  const facts = {
    viewerId: getUserId(session),
    isOrgAdmin: legacyIsAdminLevel(session.user.accessLevel),
    createdById: meeting.createdById,
    attendeeIds: meeting.attendees.map((a) => a.userId),
  };
  return {
    meeting,
    canRead: canReadMeeting(facts),
    canEdit: canEditMeeting(facts),
  };
}

// GET: Get action items for a meeting
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: meetingId } = await params;

  // 404, not 403: a meeting a person does not attend does not exist for
  // them, and a 403 would confirm that it does.
  const loaded = await loadMeeting(meetingId, session);
  if (!loaded || !loaded.canRead) return jsonError("Meeting not found", 404);

  const items = await prisma.actionItem.findMany({
    where: { meetingId },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return jsonSuccess(items);
}

// POST: Add action item
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: meetingId } = await params;
  const orgId = getOrgId(session);

  const loaded = await loadMeeting(meetingId, session);
  if (!loaded || !loaded.canEdit) return jsonError("Meeting not found", 404);
  const meeting = loaded.meeting;

  // A missing or malformed body answers the contract, not a bare 500 with an
  // empty response (audit C-1, the same fix the punch route carries).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Title is required");
  const { title, assigneeId, deadline } = body as {
    title?: unknown; assigneeId?: unknown; deadline?: unknown;
  };

  if (!title || typeof title !== "string") return jsonError("Title is required");
  if (!assigneeId || typeof assigneeId !== "string") return jsonError("Assignee is required");
  let due: Date | null = null;
  if (deadline) {
    const d = new Date(String(deadline));
    if (Number.isNaN(d.getTime())) return jsonError("deadline must be a date");
    due = d;
  }

  const item = await prisma.actionItem.create({
    data: {
      title,
      meetingId,
      assigneeId,
      deadline: due,
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Auto-create a task on the assigned person's own list.
  //
  // Phase 2 W4. This wrote the legacy `Task` table, whose UI is deleted in this
  // release, so the auto-created task was invisible the moment it was made.
  // Items on a Personal list are what /my-work and /my-work/personal read.
  // A failure here must not lose the ActionItem written just above, so it is
  // caught: the action item is the record of record, the task is the
  // convenience copy.
  await createPersonalTask({
    organizationId: orgId,
    assigneeId,
    title: `[Action Item] ${title}`,
    description: `From meeting: ${meeting.title}`,
    dueAt: due ?? new Date(),
    legacy: { source: "MEETING", sourceRef: meetingId },
    actorId: getUserId(session),
  }).catch(() => null);

  // Create notification for the assignee
  if (assigneeId !== getUserId(session)) {
    await prisma.notification.create({
      data: {
        userId: assigneeId,
        type: "action_item",
        title: `New action item: ${title}`,
        message: `From meeting "${meeting.title}"${due ? `, due ${due.toISOString().slice(0, 10)}` : ""}`,
        link: `/meetings/${meetingId}`,
      },
    });
  }

  return jsonSuccess(item, 201);
}

// PUT: Update action item (status, assignee, deadline)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  // A missing or malformed body answers the contract, not a bare 500.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("itemId is required");
  const { itemId, title, assigneeId, deadline, status } = body as {
    itemId?: unknown; title?: unknown; assigneeId?: unknown;
    deadline?: unknown; status?: unknown;
  };

  if (!itemId || typeof itemId !== "string") return jsonError("itemId is required");

  // Org scope. Until Phase 4 this looked the action item up by id alone,
  // so a signed-in person in any workspace could edit an action item in
  // any other workspace by guessing its id. The meeting is the row that
  // carries organizationId, so the scope goes through it.
  const { id: meetingIdForPut } = await params;
  const loadedForPut = await loadMeeting(meetingIdForPut, session);
  if (!loadedForPut || !loadedForPut.canEdit) return jsonError("Action item not found", 404);
  const item = await prisma.actionItem.findFirst({
    where: { id: itemId, meetingId: meetingIdForPut },
  });
  if (!item) return jsonError("Action item not found", 404);

  const updated = await prisma.actionItem.update({
    where: { id: itemId },
    data: {
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
      assigneeId: typeof assigneeId === "string" ? assigneeId : undefined,
      deadline: deadline !== undefined ? (deadline ? new Date(String(deadline)) : null) : undefined,
      status: typeof status === "string" ? (status as never) : undefined,
      completedAt: status === "COMPLETED" ? new Date() : status && status !== "COMPLETED" ? null : undefined,
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return jsonSuccess(updated);
}

// DELETE: Remove action item
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId");

  if (!itemId) return jsonError("itemId query param is required");

  // Same org scope as PUT, and for the same reason.
  const { id: meetingIdForDelete } = await params;
  const loadedForDelete = await loadMeeting(meetingIdForDelete, session);
  if (!loadedForDelete || !loadedForDelete.canEdit) return jsonError("Action item not found", 404);
  const item = await prisma.actionItem.findFirst({
    where: { id: itemId, meetingId: meetingIdForDelete },
  });
  if (!item) return jsonError("Action item not found", 404);

  await prisma.actionItem.delete({ where: { id: itemId } });

  return jsonSuccess({ message: "Action item deleted" });
}

// PATCH: Convert action item to task
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: meetingId } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // A missing or malformed body answers the contract, not a bare 500.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("itemId is required");
  const { itemId } = body as { itemId?: unknown };

  if (!itemId || typeof itemId !== "string") return jsonError("itemId is required");

  const loadedForConvert = await loadMeeting(meetingId, session);
  if (!loadedForConvert || !loadedForConvert.canEdit) return jsonError("Action item not found", 404);
  const item = await prisma.actionItem.findFirst({
    where: { id: itemId, meetingId },
    include: { meeting: { select: { title: true } } },
  });
  if (!item) return jsonError("Action item not found", 404);

  // Converting twice used to write two tasks (comms detail issue: "no
  // idempotency: clicking twice creates two tasks"). ActionItem.itemId
  // records the Item the first conversion made, so the second click hands
  // the same one back. A link to a row that has since been deleted falls
  // through and converts again rather than 404ing.
  if (item.itemId) {
    const existing = await prisma.item.findFirst({
      where: { id: item.itemId, organizationId: orgId },
      select: { id: true, title: true },
    });
    if (existing) {
      return jsonSuccess({ task: existing, alreadyConverted: true, message: "Already a task" });
    }
  }

  // Convert this action item into a real task on the assignee's own list.
  //
  // Phase 2 W4, as above. The UI toasts "Task created: <title>"
  // (src/app/(dashboard)/meetings/[id]/page.tsx), so a failure must be an
  // error the caller sees rather than a success over a row that was never
  // written: this one is deliberately NOT caught.
  const task = await createPersonalTask({
    organizationId: orgId,
    assigneeId: item.assigneeId,
    title: item.title,
    description: `From meeting: ${item.meeting.title}`,
    dueAt: item.deadline || new Date(),
    legacy: { source: "MEETING", sourceRef: meetingId },
    actorId: userId,
  });

  // Remember which Item this became, so the next click reopens it instead
  // of writing a second one. Best effort: the task IS written by now, and
  // losing the link would only cost a duplicate on a second click, which
  // is strictly better than reporting a failure over a task that exists.
  await prisma.actionItem
    .update({ where: { id: item.id }, data: { itemId: task.id } })
    .catch(() => null);

  return jsonSuccess({ task, message: "Action item converted to task" });
}
