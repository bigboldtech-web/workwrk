// GET /api/whiteboards — list this org's whiteboards
// POST /api/whiteboards — create a new whiteboard

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const whiteboards = await prisma.whiteboard.findMany({
    where: { organizationId: ctx.orgId, archivedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      thumbnail: true,
      ownerId: true,
      lastEditedAt: true,
      productSlug: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ lastEditedAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({ whiteboards });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  productSlug: z.string().max(40).optional(),
  spaceId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const whiteboard = await prisma.whiteboard.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      productSlug: parsed.data.productSlug,
      spaceId: parsed.data.spaceId,
      ownerId: ctx.userId,
      lastEditedById: ctx.userId,
      lastEditedAt: new Date(),
      scene: {},
    },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json({ whiteboard });
}
