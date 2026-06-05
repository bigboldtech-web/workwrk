// GET /api/whiteboards — list this org's whiteboards
// POST /api/whiteboards — create a new whiteboard

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { visibleSpaceIds } from "@/lib/space";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  // Optional ?spaceId filter for the Library Space chip strip. "unscoped"
  // is a sentinel: return only whiteboards with spaceId IS NULL.
  const sp = new URL(req.url).searchParams;
  const spaceIdParam = sp.get("spaceId");
  const spaceFilter: Record<string, unknown> =
    spaceIdParam === "unscoped"
      ? { spaceId: null }
      : spaceIdParam
        ? { spaceId: spaceIdParam }
        : {};

  const whiteboards = await prisma.whiteboard.findMany({
    where: { organizationId: ctx.orgId, archivedAt: null, ...spaceFilter },
    select: {
      id: true,
      name: true,
      description: true,
      thumbnail: true,
      ownerId: true,
      lastEditedAt: true,
      productSlug: true,
      spaceId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ lastEditedAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  // Phase 22 — gate by Space visibility. Unscoped whiteboards (spaceId=null)
  // stay visible org-wide; scoped ones are returned only if the viewer
  // can read the parent Space.
  const scopedIds = whiteboards.map((w) => w.spaceId).filter((s): s is string => Boolean(s));
  const visible = scopedIds.length > 0
    ? await visibleSpaceIds(scopedIds, ctx.userId, ctx.accessLevel ?? "EMPLOYEE")
    : new Set<string>();
  const gated = whiteboards.filter((w) => !w.spaceId || visible.has(w.spaceId));

  return NextResponse.json({ whiteboards: gated });
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
