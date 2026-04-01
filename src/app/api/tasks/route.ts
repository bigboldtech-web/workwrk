import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: List tasks (calendar view)
// Query params: userId, startDate, endDate, kraId
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const accessLevel = (session.user as any).accessLevel;
  const currentUserId = getUserId(session);
  const url = new URL(req.url);

  const userId = url.searchParams.get("userId");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const kraId = url.searchParams.get("kraId");

  const where: Record<string, unknown> = { organizationId: orgId };

  // If not a manager/admin, only show own tasks
  if (userId) {
    where.assigneeId = userId;
  } else if (!["COMPANY_ADMIN", "SUPER_ADMIN", "HR", "C_LEVEL", "VP", "DIRECTOR", "MANAGER"].includes(accessLevel)) {
    where.assigneeId = currentUserId;
  }

  if (startDate) where.date = { ...(where.date as object || {}), gte: new Date(startDate) };
  if (endDate) where.date = { ...(where.date as object || {}), lte: new Date(endDate) };
  if (kraId) where.kraId = kraId;

  const tasks = await prisma.task.findMany({
    where,
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      kra: { select: { id: true, name: true } },
    },
    orderBy: { date: "asc" },
  });

  return jsonSuccess(tasks);
}

// POST: Create a task
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const body = await req.json();

  const { title, description, date, startTime, endTime, assigneeId, kraId } = body;

  if (!title?.trim() || !date) {
    return jsonError("Title and date are required");
  }

  const task = await prisma.task.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      date: new Date(date),
      startTime: startTime || null,
      endTime: endTime || null,
      assigneeId: assigneeId || currentUserId,
      kraId: kraId || null,
      organizationId: orgId,
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      kra: { select: { id: true, name: true } },
    },
  });

  return jsonSuccess(task, 201);
}

// PATCH: Update a task
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return jsonError("Task ID is required");

  const task = await prisma.task.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!task) return jsonError("Task not found", 404);

  if (updates.date) updates.date = new Date(updates.date);

  const updated = await prisma.task.update({
    where: { id },
    data: updates,
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      kra: { select: { id: true, name: true } },
    },
  });

  return jsonSuccess(updated);
}

// DELETE: Delete a task
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await req.json();

  if (!id) return jsonError("Task ID is required");

  const task = await prisma.task.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!task) return jsonError("Task not found", 404);

  await prisma.task.delete({ where: { id } });

  return jsonSuccess({ message: "Task deleted" });
}
