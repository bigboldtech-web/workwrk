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
