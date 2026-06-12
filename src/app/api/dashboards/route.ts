// GET  /api/dashboards — list this org's dashboards (?mine=1 → owned only)
// POST /api/dashboards — create a dashboard { name, description?, spaceId? }
//
// Mirrors /api/whiteboards: org-scoped, soft-archive aware, Space-scoped
// rows gated by visibleSpaceIds (the Phase 22 consistency triad).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { visibleSpaceIds } from "@/lib/space";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const sp = new URL(req.url).searchParams;
  const mine = sp.get("mine") === "1";

  const dashboards = await prisma.dashboard.findMany({
    where: {
      organizationId: ctx.orgId,
      archivedAt: null,
      ...(mine ? { ownerId: ctx.userId } : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      ownerId: true,
      spaceId: true,
      widgets: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const scopedIds = dashboards.map((d) => d.spaceId).filter((s): s is string => Boolean(s));
  const visible = scopedIds.length > 0
    ? await visibleSpaceIds(scopedIds, ctx.userId, ctx.accessLevel ?? "EMPLOYEE")
    : new Set<string>();
  const gated = dashboards.filter((d) => !d.spaceId || visible.has(d.spaceId));

  return NextResponse.json({ dashboards: gated });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  spaceId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Cross-tenant safety: spaceId must belong to the caller's org.
  if (parsed.data.spaceId) {
    const space = await prisma.space.findFirst({
      where: { id: parsed.data.spaceId, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (!space) return NextResponse.json({ error: "space not found" }, { status: 404 });
  }

  const dashboard = await prisma.dashboard.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      spaceId: parsed.data.spaceId,
      ownerId: ctx.userId,
      widgets: [],
    },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json({ dashboard });
}
