// GET    /api/dashboards/[id] — load a dashboard
// PATCH  /api/dashboards/[id] — rename / update description / widgets
// DELETE /api/dashboards/[id] — soft-archive
//
// Mirrors /api/whiteboards/[id] including the per-row Space gate.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { getSpaceForReader } from "@/lib/space";

async function checkSpaceVisible(spaceId: string | null, userId: string, accessLevel: string | null | undefined): Promise<boolean> {
  if (!spaceId) return true;
  const space = await getSpaceForReader(spaceId, userId, accessLevel ?? "EMPLOYEE");
  return Boolean(space);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const dashboard = await prisma.dashboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!dashboard) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await checkSpaceVisible(dashboard.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ dashboard });
}

// Widget shape mirrors DashWidget in components/dashboard/widget-types.ts.
// Non-strict objects strip unknown keys on parse, so foreign props never
// land in the JSON column.
const widgetSourceSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("board"),
    boardId: z.string().min(1).max(60),
    boardName: z.string().max(160).optional(),
  }),
]);

const widgetSchema = z.object({
  id: z.string().min(1).max(60),
  type: z.enum(["task-list", "stat", "notes", "battery", "chart"]),
  title: z.string().min(1).max(120),
  config: z.object({
    source: widgetSourceSchema.optional(),
    statScope: z.enum(["open", "total", "completed", "overdue"]).optional(),
    chartBy: z.enum(["status", "assignee", "priority"]).optional(),
    chartKind: z.enum(["pie", "bar"]).optional(),
    noteText: z.string().max(20000).optional(),
  }),
  layout: z.object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(10000),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(60),
  }),
});

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  widgets: z.array(widgetSchema).max(30).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const existing = await prisma.dashboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await checkSpaceVisible(existing.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const dashboard = await prisma.dashboard.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.widgets !== undefined ? { widgets: parsed.data.widgets as object } : {}),
    },
    select: { id: true, name: true, updatedAt: true },
  });

  return NextResponse.json({ dashboard });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const existing = await prisma.dashboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await checkSpaceVisible(existing.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.dashboard.update({ where: { id }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
