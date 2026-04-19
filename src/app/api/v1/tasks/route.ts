import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { dispatchEvent } from "@/services/webhookDispatcher";

/** GET /api/v1/tasks — list; POST — create (with optional SLA + source). */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const assigneeId = url.searchParams.get("assigneeId");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (assigneeId) where.assigneeId = assigneeId;
  if (status) where.status = status;
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const rows = await prisma.task.findMany({
    where,
    take: limit + 1,
    orderBy: { date: "desc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      title: true,
      description: true,
      date: true,
      status: true,
      priority: true,
      slaHours: true,
      escalatedAt: true,
      source: true,
      sourceRef: true,
      assigneeId: true,
      kraId: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    date?: string;
    assigneeId?: string;
    kraId?: string;
    slaHours?: number;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    source?: "MANUAL" | "SOP" | "REVIEW" | "OKR" | "AI";
    sourceRef?: string;
    category?: string;
  };
  if (!body.title?.trim() || !body.assigneeId) {
    return Response.json({ error: "title and assigneeId are required" }, { status: 400 });
  }

  // Assignee must be in caller's org.
  const assignee = await prisma.user.findFirst({
    where: { id: body.assigneeId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!assignee) return Response.json({ error: "Assignee not in org" }, { status: 404 });

  const task = await prisma.task.create({
    data: {
      title: body.title.trim().slice(0, 200),
      description: body.description?.slice(0, 2000) ?? null,
      date: body.date ? new Date(body.date) : new Date(),
      category: body.category?.slice(0, 80) ?? null,
      assigneeId: body.assigneeId,
      kraId: body.kraId ?? null,
      slaHours: body.slaHours && body.slaHours > 0 ? body.slaHours : null,
      priority: body.priority ?? "NORMAL",
      source: body.source ?? "MANUAL",
      sourceRef: body.sourceRef ?? null,
      organizationId: ctx.organizationId,
    },
    select: {
      id: true,
      title: true,
      date: true,
      status: true,
      priority: true,
      slaHours: true,
      source: true,
      sourceRef: true,
      assigneeId: true,
      createdAt: true,
    },
  });

  dispatchEvent({
    organizationId: ctx.organizationId,
    event: "task.created",
    payload: task,
  }).catch(() => {});

  return Response.json(task, { status: 201 });
}
