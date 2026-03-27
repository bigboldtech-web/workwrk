import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;

  const task = await prisma.task.findFirst({
    where: { id, organizationId: getOrgId(session) },
    select: { id: true },
  });

  if (!task) return jsonError("Task not found", 404);

  const comments = await prisma.taskComment.findMany({
    where: { taskId: id },
    include: {
      author: {
        select: { id: true, firstName: true, lastName: true, avatar: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(comments);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;

  const body = await req.json();
  const { content } = body;

  if (!content || !content.trim()) {
    return jsonError("Comment content is required");
  }

  const task = await prisma.task.findFirst({
    where: { id, organizationId: getOrgId(session) },
    select: { id: true },
  });

  if (!task) return jsonError("Task not found", 404);

  const comment = await prisma.taskComment.create({
    data: {
      content: content.trim(),
      taskId: id,
      authorId: getUserId(session),
    },
    include: {
      author: {
        select: { id: true, firstName: true, lastName: true, avatar: true },
      },
    },
  });

  return jsonSuccess(comment, 201);
}
