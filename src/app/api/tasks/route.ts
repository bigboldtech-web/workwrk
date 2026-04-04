import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

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
  const view = url.searchParams.get("view"); // "team" for manager team view
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const kraId = url.searchParams.get("kraId");

  const where: Record<string, unknown> = { organizationId: orgId };

  if (view === "team" && ["COMPANY_ADMIN", "SUPER_ADMIN", "HR", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD"].includes(accessLevel)) {
    // Manager team view — show direct reports' tasks
    const directReports = await prisma.user.findMany({
      where: { managerId: currentUserId, organizationId: orgId },
      select: { id: true },
    });
    const reportIds = directReports.map((r) => r.id);
    reportIds.push(currentUserId); // include own tasks too
    where.assigneeId = { in: reportIds };
  } else if (userId) {
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

  const { title, description, date, startTime, endTime, hoursSpent, category, assigneeId, kraId } = body;

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
      hoursSpent: hoursSpent != null ? Number(hoursSpent) : null,
      category: category || null,
      assigneeId: assigneeId || currentUserId,
      kraId: kraId || null,
      organizationId: orgId,
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      kra: { select: { id: true, name: true } },
    },
  });

  logActivity({
    type: "task_created",
    actorId: currentUserId,
    organizationId: orgId,
    description: `Created task "${task.title}"`,
    targetId: task.id,
    targetType: "task",
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

  // Log completion
  if (updates.status === "COMPLETED" && task.status !== "COMPLETED") {
    logActivity({
      type: "task_completed",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Completed task "${updated.title}"`,
      targetId: id,
      targetType: "task",
    });
  }

  return jsonSuccess(updated);
}

// DELETE: Delete a task (or all future recurring tasks)
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id, deleteAll } = await req.json();

  if (!id) return jsonError("Task ID is required");

  const task = await prisma.task.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!task) return jsonError("Task not found", 404);

  // Delete all future recurring tasks in the same group
  if (deleteAll && task.recurringGroupId) {
    const result = await prisma.task.deleteMany({
      where: {
        recurringGroupId: task.recurringGroupId,
        organizationId: orgId,
        date: { gte: task.date },
      },
    });
    return jsonSuccess({ message: `Deleted ${result.count} tasks` });
  }

  // Delete single task
  await prisma.task.delete({ where: { id } });

  return jsonSuccess({ message: "Task deleted" });
}
