import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { taskAssignedTemplate } from "@/lib/email-templates";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const assigneeId = searchParams.get("assigneeId");
  const view = searchParams.get("view"); // "my" | "team" | "all"
  const pagination = parsePaginationParams(req);

  const where: any = { organizationId: getOrgId(session) };
  if (status) where.status = status;
  if (priority) where.priority = priority;

  if (view === "my" || !isManager(session)) {
    where.assigneeId = getUserId(session);
  } else if (assigneeId) {
    where.assigneeId = assigneeId;
  }

  if (pagination.search) {
    where.OR = [
      { title: { contains: pagination.search, mode: "insensitive" } },
      { description: { contains: pagination.search, mode: "insensitive" } },
    ];
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
        subTasks: { select: { id: true, title: true, status: true } },
        _count: { select: { comments: true } },
      },
      orderBy: [{ priority: "asc" }, { deadline: "asc" }],
      ...skipTake(pagination),
    }),
    prisma.task.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(tasks, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const { title, description, priority, assigneeId, deadline, parentId, tags } = body;

  if (!title) return jsonError("Task title is required");

  const task = await prisma.task.create({
    data: {
      title,
      description,
      priority: priority || "P2",
      assigneeId,
      deadline: deadline ? new Date(deadline) : undefined,
      parentId,
      tags: tags || [],
      creatorId: getUserId(session),
      organizationId: getOrgId(session),
    },
  });

  logActivity({
    type: "task_created",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Created task "${title}"`,
    targetId: task.id,
    targetType: "task",
    metadata: { priority: priority || "P2" },
  });

  // Send email to assignee if task is assigned
  if (assigneeId) {
    const [assignee, creator] = await Promise.all([
      prisma.user.findUnique({ where: { id: assigneeId }, select: { email: true, id: true } }),
      prisma.user.findUnique({ where: { id: getUserId(session) }, select: { firstName: true, lastName: true } }),
    ]);

    if (assignee && creator) {
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const { subject, html } = taskAssignedTemplate({
        assignerName: `${creator.firstName} ${creator.lastName}`,
        taskTitle: title,
        priority: priority || "P2",
        deadline: deadline ? new Date(deadline).toLocaleDateString() : undefined,
        taskLink: `${baseUrl}/tasks/${task.id}`,
      });

      sendEmail({
        to: assignee.email,
        subject,
        html,
        template: "task-assigned",
        variables: { taskTitle: title, assignerName: `${creator.firstName} ${creator.lastName}` },
        organizationId: getOrgId(session),
        userId: assignee.id,
        category: "task",
      });
    }
  }

  return jsonSuccess(task, 201);
}
