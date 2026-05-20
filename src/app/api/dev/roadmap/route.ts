// GET/POST /api/dev/roadmap — roadmap items (themes → initiatives tree)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const items = await prisma.roadmapItem.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  return NextResponse.json({ items });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  theme: z.string().max(80).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  quarter: z.string().max(20).optional(),
  parentId: z.string().optional(),
  effortPoints: z.number().int().nonnegative().optional(),
  impactScore: z.number().int().min(1).max(10).optional(),
  publicVisible: z.boolean().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const item = await prisma.roadmapItem.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      description: parsed.data.description,
      theme: parsed.data.theme,
      priority: parsed.data.priority ?? "P2",
      quarter: parsed.data.quarter,
      parentId: parsed.data.parentId,
      effortPoints: parsed.data.effortPoints,
      impactScore: parsed.data.impactScore,
      publicVisible: parsed.data.publicVisible ?? false,
      ownerId: ctx.userId,
    },
  });
  return NextResponse.json({ item });
}

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(8000).nullable().optional(),
  theme: z.string().max(80).nullable().optional(),
  status: z.enum(["EXPLORING", "COMMITTED", "IN_PROGRESS", "BETA", "SHIPPED", "PAUSED", "CANCELLED"]).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  quarter: z.string().max(20).nullable().optional(),
  impactScore: z.number().int().min(1).max(10).nullable().optional(),
  effortPoints: z.number().int().nonnegative().nullable().optional(),
  publicVisible: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.roadmapItem.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const item = await prisma.roadmapItem.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.theme !== undefined ? { theme: parsed.data.theme } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.quarter !== undefined ? { quarter: parsed.data.quarter } : {}),
      ...(parsed.data.impactScore !== undefined ? { impactScore: parsed.data.impactScore } : {}),
      ...(parsed.data.effortPoints !== undefined ? { effortPoints: parsed.data.effortPoints } : {}),
      ...(parsed.data.publicVisible !== undefined ? { publicVisible: parsed.data.publicVisible } : {}),
    },
  });
  return NextResponse.json({ item });
}
