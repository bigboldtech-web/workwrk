import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { getTeamUserIds } from "@/lib/team";
import { pushTaskToGoogle, deleteTaskFromGoogle } from "@/services/googleCalendarPush";
import { GOOGLE_CAL_SOURCE } from "@/services/googleCalendar";
import { tagFilterIds } from "@/lib/tag-filter";

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
  } else {
    // Default: scope to the requesting user. This used to be
    // skipped for managers, which meant "open /tasks without any
    // filter" returned every task in the org. People legitimately
    // expect their default view to be *their own* work — managers
    // can opt in to a team view via `view=team`.
    where.assigneeId = currentUserId;
  }

  // Range filter overlaps multi-day spans correctly. A task is in the
  // [from, to] window if:
  //   - its legacy `date` falls in the window, OR
  //   - its [startAt, endAt] span overlaps the window (open-ended endAt
  //     is treated as "still in progress", so it always qualifies if
  //     startAt <= to).
  if (startDate || endDate) {
    const from = startDate ? new Date(startDate) : null;
    const to = endDate ? new Date(endDate) : null;
    const spanFilter: any = {};
    if (from && to) {
      spanFilter.OR = [
        { date: { gte: from, lte: to } },
        {
          AND: [
            { startAt: { lte: to } },
            { OR: [{ endAt: null }, { endAt: { gte: from } }] },
          ],
        },
      ];
    } else if (from) {
      spanFilter.OR = [
        { date: { gte: from } },
        { OR: [{ endAt: null }, { endAt: { gte: from } }] },
      ];
    } else if (to) {
      spanFilter.OR = [
        { date: { lte: to } },
        { startAt: { lte: to } },
      ];
    }
    Object.assign(where, spanFilter);
  }
  if (kraId) where.kraId = kraId;

  // Optional tag filter — `?tags=tagId1,tagId2` narrows to tasks
  // carrying ALL listed tags. Empty list = no filter (skip clause).
  const tagsRaw = url.searchParams.get("tags");
  if (tagsRaw) {
    const matched = await tagFilterIds({ organizationId: orgId, entityType: "TASK", tagsRaw });
    if (matched !== null) {
      if (matched.length === 0) return jsonSuccess([]);
      where.id = { in: matched };
    }
  }

  const tasks = await prisma.task.findMany({
    where,
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      kra: { select: { id: true, name: true } },
      labels: { include: { label: true } },
      _count: { select: { subTasks: true, comments: true } },
    },
    orderBy: [{ startAt: "asc" }, { date: "asc" }],
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

  const {
    title, description, date, startAt, endAt, allDay,
    estimateHours, hoursSpent, category, assigneeId, kraId,
    parentTaskId, labelIds,
  } = body;

  if (!title?.trim() || !date) {
    return jsonError("Title and date are required");
  }

  // Enforce the 1-level sub-task rule: a sub-task can't itself have children.
  if (parentTaskId) {
    const parent = await prisma.task.findFirst({
      where: { id: parentTaskId, organizationId: orgId },
      select: { parentTaskId: true },
    });
    if (!parent) return jsonError("Parent task not found", 404);
    if (parent.parentTaskId) return jsonError("Sub-tasks cannot have their own sub-tasks", 400);
  }

  let task;
  try {
    task = await prisma.task.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        date: new Date(date),
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
        allDay: allDay === false ? false : true,
        estimateHours: estimateHours != null ? Number(estimateHours) : null,
        hoursSpent: hoursSpent != null ? Number(hoursSpent) : null,
        category: category || null,
        assigneeId: assigneeId || currentUserId,
        kraId: kraId || null,
        parentTaskId: parentTaskId || null,
        organizationId: orgId,
        labels: Array.isArray(labelIds) && labelIds.length > 0
          ? { create: labelIds.map((labelId: string) => ({ labelId })) }
          : undefined,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        kra: { select: { id: true, name: true } },
        labels: { include: { label: true } },
        _count: { select: { subTasks: true, comments: true } },
      },
    });
  } catch (err: any) {
    console.error("[Task POST] prisma.task.create failed:", err);
    const code = err?.code;
    if (code === "P2003") return jsonError(`Invalid reference: ${err.meta?.field_name || "foreign key"}`, 400);
    if (code === "P2025") return jsonError("Referenced record not found", 400);
    return jsonError(err?.message || "Failed to create task", 500);
  }

  // Side-effects below must not fail the create — the task row is already
  // persisted. Wrap anything network-adjacent so a downstream outage
  // (notification row, email provider, Google push) can't surface as a
  // 500 to the caller.
  logActivity({
    type: "task_created",
    actorId: currentUserId,
    organizationId: orgId,
    description: `Created task "${task.title}"`,
    targetId: task.id,
    targetType: "task",
  });

  // Notify assignee if task was delegated to someone else
  if (task.assigneeId !== currentUserId) try {
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
  } catch (err) { console.error("[Task] Notify block failed:", err); }

  // Push to Google if the assignee has an OUT/BOTH subscription. Fire-and-forget
  // so the response isn't blocked on external I/O.
  pushTaskToGoogle(task.id).catch(() => {});

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

  // Google Calendar events are read-only in Workwrk. Only status toggles
  // are allowed through — the user may want to mark an event "done" even
  // though the underlying event data stays authoritative in Google.
  if (task.externalSource === GOOGLE_CAL_SOURCE) {
    const allowedKeys = new Set(["id", "status", "completedAt"]);
    for (const key of Object.keys(updates)) {
      if (!allowedKeys.has(key)) {
        return jsonError(
          "Google Calendar events can't be edited here. Edit them on Google and they'll sync over.",
          403,
        );
      }
    }
  }

  if (updates.date) updates.date = new Date(updates.date);
  if (updates.startAt) updates.startAt = new Date(updates.startAt);
  if (updates.endAt) updates.endAt = new Date(updates.endAt);

  // Stamp completedAt on COMPLETED transitions, clear on reopen.
  // The Gantt view reads completedAt directly to render elapsed-time bars,
  // so it must be accurate on every status change.
  if (updates.status && updates.status !== task.status) {
    if (updates.status === "COMPLETED" && task.status !== "COMPLETED") {
      updates.completedAt = new Date();
    } else if (task.status === "COMPLETED" && updates.status !== "COMPLETED") {
      updates.completedAt = null;
    }
  }

  // Label updates come in as labelIds[]; translate to a full resync of the
  // join table so callers don't have to compute diffs.
  const incomingLabelIds: string[] | undefined = Array.isArray(updates.labelIds)
    ? updates.labelIds
    : undefined;
  delete updates.labelIds;

  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...updates,
      ...(incomingLabelIds !== undefined
        ? {
            labels: {
              deleteMany: {},
              create: incomingLabelIds.map((labelId) => ({ labelId })),
            },
          }
        : {}),
    },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      kra: { select: { id: true, name: true } },
      labels: { include: { label: true } },
      _count: { select: { subTasks: true, comments: true } },
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

  // Echo the update to Google if the task already has a GCAL shadow.
  pushTaskToGoogle(updated.id).catch(() => {});

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
  if (task.externalSource === GOOGLE_CAL_SOURCE) {
    return jsonError(
      "Google Calendar events can't be deleted here. Remove them from Google and they'll disappear on next sync.",
      403,
    );
  }

  // Snapshot externalId before we delete so we can clean up the Google
  // shadow. Fire-and-forget.
  const googleShadow = task.externalId
    ? { id: task.id, externalId: task.externalId, externalSource: task.externalSource, assigneeId: task.assigneeId }
    : null;

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

  if (googleShadow) {
    deleteTaskFromGoogle(googleShadow).catch(() => {});
  }

  return jsonSuccess({ message: "Task deleted" });
}
