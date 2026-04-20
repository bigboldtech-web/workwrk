import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { getTeamUserIds } from "@/lib/team";

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
    const teamIds = await getTeamUserIds(orgId, currentUserId);
    where.assigneeId = { in: teamIds };
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

  // Notify assignee if task was delegated to someone else
  if (task.assigneeId !== currentUserId) {
    const dateStr = new Date(task.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    await prisma.notification.create({
      data: {
        userId: task.assigneeId,
        type: "task_assigned",
        title: "Task Assigned",
        message: `${task.title}${task.date ? ` (due ${dateStr})` : ""}`,
        link: "/tasks",
      },
    }).catch((err) => console.error("[Task] Notification failed:", err));

    // Email the assignee
    try {
      const [assignee, actor] = await Promise.all([
        prisma.user.findUnique({ where: { id: task.assigneeId }, select: { email: true, firstName: true } }),
        prisma.user.findUnique({ where: { id: currentUserId }, select: { firstName: true, lastName: true } }),
      ]);
      if (assignee?.email) {
        const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
        const { subject, html } = genericNotificationTemplate({
          heading: "Task Assigned",
          recipientName: assignee.firstName,
          subjectText: `${actor?.firstName || "Someone"} ${actor?.lastName || ""} assigned you a task.`,
          itemTitle: task.title,
          itemDetails: task.date ? `Due ${dateStr}` : undefined,
          actionLabel: "View Task",
          actionLink: `${baseUrl}/tasks`,
          note: task.description || undefined,
        });
        await sendEmail({
          to: assignee.email, subject, html,
          template: "task-assigned",
          variables: { title: task.title, dueDate: dateStr },
          organizationId: orgId, userId: task.assigneeId, category: "reminder",
        });
      }
    } catch (err) { console.error("[Task] Email failed:", err); }
  }

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

  // Notify on reassignment
  if (updates.assigneeId && updates.assigneeId !== task.assigneeId && updates.assigneeId !== getUserId(session)) {
    const dateStr = new Date(updated.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    await prisma.notification.create({
      data: {
        userId: updates.assigneeId,
        type: "task_assigned",
        title: "Task Reassigned to You",
        message: `${updated.title}${updated.date ? ` (due ${dateStr})` : ""}`,
        link: "/tasks",
      },
    }).catch((err) => console.error("[Task] Notification failed:", err));
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
