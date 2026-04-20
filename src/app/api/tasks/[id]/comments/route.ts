import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Notes thread on a task. Any user who can see the task can read its
 * comments; only members of the same org can post. Managers can see
 * every task in their recursive team so they can both read and post
 * without extra permission checks — visibility is scoped by the task's
 * orgId match.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const task = await prisma.task.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!task) return jsonError("Task not found", 404);

  const comments = await prisma.taskComment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    },
  });

  return jsonSuccess(comments);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const authorId = getUserId(session);

  const body = await req.json();
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return jsonError("Comment body is required");
  if (text.length > 4000) return jsonError("Comment too long (max 4000 chars)");

  const task = await prisma.task.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, assigneeId: true, title: true },
  });
  if (!task) return jsonError("Task not found", 404);

  const comment = await prisma.taskComment.create({
    data: { taskId: id, authorId, body: text },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    },
  });

  // Notify the assignee when someone else leaves a comment. Fire-and-forget
  // to keep the request snappy; the email queue cron is the safety net.
  if (task.assigneeId !== authorId) {
    prisma.notification.create({
      data: {
        userId: task.assigneeId,
        type: "task_comment",
        title: "New comment on your task",
        message: `${task.title}: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`,
        link: `/tasks?id=${id}`,
      },
    }).catch(() => {});
  }

  return jsonSuccess(comment, 201);
}
