import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const body = await req.json();
  const { tasks } = body;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return jsonError("tasks array is required");
  }

  if (tasks.length > 400) {
    return jsonError("Maximum 400 tasks per batch");
  }

  // All tasks in a batch share the same recurringGroupId
  const groupId = crypto.randomBytes(8).toString("hex");

  const data = tasks.map((t: any) => ({
    title: t.title?.trim() || "Untitled",
    description: t.description?.trim() || null,
    date: new Date(t.date),
    hoursSpent: t.hoursSpent != null ? Number(t.hoursSpent) : null,
    category: t.category || null,
    status: t.status || "PLANNED",
    recurringGroupId: groupId,
    assigneeId: t.assigneeId || currentUserId,
    kraId: t.kraId || null,
    organizationId: orgId,
  }));

  const result = await prisma.task.createMany({ data });

  // If recurring tasks were assigned to someone else, send one notification
  const assignedTo = data[0]?.assigneeId;
  const firstTitle = data[0]?.title;
  if (assignedTo && assignedTo !== currentUserId) {
    await prisma.notification.create({
      data: {
        userId: assignedTo,
        type: "task_assigned",
        title: "Recurring Task Assigned",
        message: `${firstTitle} — ${result.count} occurrences`,
        link: "/tasks",
      },
    }).catch((err) => console.error("[Task batch] Notification failed:", err));
  }

  return jsonSuccess({ created: result.count, groupId }, 201);
}
