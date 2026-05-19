// GET/POST/PATCH /api/dev/sprints

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const sprints = await prisma.sprint.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { startDate: "desc" },
    take: 100,
  });
  return NextResponse.json({ sprints });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  goal: z.string().max(2000).optional(),
  startDate: z.string(),
  endDate: z.string(),
  capacityPoints: z.number().int().nonnegative().optional(),
  committedPoints: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const sprint = await prisma.sprint.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      goal: parsed.data.goal,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      capacityPoints: parsed.data.capacityPoints,
      committedPoints: parsed.data.committedPoints,
    },
  });
  return NextResponse.json({ sprint });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["PLANNED", "ACTIVE", "REVIEW", "COMPLETED", "CANCELLED"]).optional(),
  completedPoints: z.number().int().nonnegative().optional(),
  retroNotes: z.string().max(8000).optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.sprint.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sprint = await prisma.sprint.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.completedPoints !== undefined ? { completedPoints: parsed.data.completedPoints } : {}),
      ...(parsed.data.retroNotes !== undefined ? { retroNotes: parsed.data.retroNotes } : {}),
    },
  });
  return NextResponse.json({ sprint });
}
