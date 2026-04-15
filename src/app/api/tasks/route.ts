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
  const userIds = url.searchParams.get("userIds"); // comma-separated list
  const view = url.searchParams.get("view"); // "team" for manager team view (recursive)
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const kraId = url.searchParams.get("kraId");

  const where: Record<string, unknown> = { organizationId: orgId };
  const isManagerLevel = ["COMPANY_ADMIN", "SUPER_ADMIN", "HR", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD"].includes(accessLevel);

  if (userIds) {
    // Multi-select filter — accept any user IDs (frontend passes team members)
    const ids = userIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) where.assigneeId = { in: ids };
  } else if (view === "team" && isManagerLevel) {
    // Recursive team view — self + all direct/indirect reports
    const allUsers = await prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, managerId: true },
    });
    const childrenMap = new Map<string, string[]>();
    for (const u of allUsers) {
      if (u.managerId) {
        if (!childrenMap.has(u.managerId)) childrenMap.set(u.managerId, []);
        childrenMap.get(u.managerId)!.push(u.id);
      }
    }
    const teamIds = new Set<string>([currentUserId]);
    const queue: string[] = [currentUserId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const c of childrenMap.get(id) || []) {
        if (!teamIds.has(c)) { teamIds.add(c); queue.push(c); }
      }
    }
    where.assigneeId = { in: Array.from(teamIds) };
  } else if (userId) {
    where.assigneeId = userId;
  } else if (!isManagerLevel) {
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
  if (deleteAll) {
    const where: any = {
      organizationId: orgId,
      date: { gte: task.date },
      assigneeId: task.assigneeId,
    };

    if (task.recurringGroupId) {
      where.recurringGroupId = task.recurringGroupId;
    } else {
      // Fallback: match by title for old tasks without groupId
      where.title = task.title;
    }

    const result = await prisma.task.deleteMany({ where });
    return jsonSuccess({ message: `Deleted ${result.count} tasks` });
  }

  // Delete single task
  await prisma.task.delete({ where: { id } });

  return jsonSuccess({ message: "Task deleted" });
}
