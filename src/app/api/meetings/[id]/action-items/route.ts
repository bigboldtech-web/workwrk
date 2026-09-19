import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { createPersonalTask } from "@/lib/work/personal-task";

// GET: Get action items for a meeting
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: meetingId } = await params;

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, organizationId: getOrgId(session) },
  });
  if (!meeting) return jsonError("Meeting not found", 404);

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

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, organizationId: orgId },
  });
  if (!meeting) return jsonError("Meeting not found", 404);

  const body = await req.json();
  const { title, assigneeId, deadline } = body;

  if (!title) return jsonError("Title is required");
  if (!assigneeId) return jsonError("Assignee is required");

  const item = await prisma.actionItem.create({
    data: {
      title,
      meetingId,
      assigneeId,
      deadline: deadline ? new Date(deadline) : null,
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
    dueAt: deadline ? new Date(deadline) : new Date(),
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
        message: `From meeting "${meeting.title}"${deadline ? ` — due ${new Date(deadline).toLocaleDateString()}` : ""}`,
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

  const body = await req.json();
  const { itemId, title, assigneeId, deadline, status } = body;

  if (!itemId) return jsonError("itemId is required");

  const item = await prisma.actionItem.findFirst({
    where: { id: itemId },
  });
  if (!item) return jsonError("Action item not found", 404);

  const updated = await prisma.actionItem.update({
    where: { id: itemId },
    data: {
      title: title ?? undefined,
      assigneeId: assigneeId ?? undefined,
      deadline: deadline !== undefined ? (deadline ? new Date(deadline) : null) : undefined,
      status: status ?? undefined,
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

  const item = await prisma.actionItem.findFirst({ where: { id: itemId } });
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

  const body = await req.json();
  const { itemId } = body;

  if (!itemId) return jsonError("itemId is required");

  const item = await prisma.actionItem.findFirst({
    where: { id: itemId, meetingId },
    include: { meeting: { select: { title: true } } },
  });
  if (!item) return jsonError("Action item not found", 404);

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

  return jsonSuccess({ task, message: "Action item converted to task" });
}
