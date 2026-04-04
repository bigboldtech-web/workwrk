import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

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

  // Auto-create a task in Work Calendar for the assigned person
  await prisma.task.create({
    data: {
      title: `[Action Item] ${title}`,
      description: `From meeting: ${meeting.title}`,
      date: deadline ? new Date(deadline) : new Date(),
      assigneeId,
      organizationId: orgId,
      status: "PLANNED",
    },
  });

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

  // Create a calendar task from this action item
  const task = await prisma.task.create({
    data: {
      title: item.title,
      description: `From meeting: ${item.meeting.title}`,
      assigneeId: item.assigneeId,
      organizationId: orgId,
      date: item.deadline || new Date(),
      status: "PLANNED",
    },
  });

  return jsonSuccess({ task, message: "Action item converted to task" });
}
