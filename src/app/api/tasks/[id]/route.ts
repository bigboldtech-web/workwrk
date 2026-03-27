import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { broadcastWebhook } from "@/lib/webhooks";
import { triggerRecalculation } from "@/services/performanceScoreService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;

  const task = await prisma.task.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      creator: { select: { id: true, firstName: true, lastName: true } },
      subTasks: true,
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!task) return jsonError("Task not found", 404);
  return jsonSuccess(task);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;

  const body = await req.json();
  const { title, description, status, priority, progress, assigneeId, deadline } = body;

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      ...(priority !== undefined && { priority }),
      ...(progress !== undefined && { progress }),
      ...(assigneeId !== undefined && { assigneeId }),
      ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
      ...(status === "COMPLETED" && { completedAt: new Date() }),
    },
  });

  if (status === "COMPLETED") {
    logActivity({
      type: "task_completed",
      actorId: getUserId(session),
      organizationId: getOrgId(session),
      description: `Completed task "${task.title}"`,
      targetId: task.id,
      targetType: "task",
    });
    broadcastWebhook({
      organizationId: getOrgId(session),
      event: "task_completed",
      payload: { taskId: task.id, title: task.title, priority: task.priority },
    });
    // Auto-recalculate performance score for assignee
    if (task.assigneeId) {
      triggerRecalculation(task.assigneeId, getOrgId(session));
    }
  } else if (status) {
    logActivity({
      type: "task_updated",
      actorId: getUserId(session),
      organizationId: getOrgId(session),
      description: `Updated task "${task.title}" status to ${status.replace(/_/g, " ").toLowerCase()}`,
      targetId: task.id,
      targetType: "task",
      metadata: { status },
    });
  }

  return jsonSuccess(task);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;

  await prisma.task.delete({ where: { id } });
  return jsonSuccess({ message: "Task deleted" });
}
