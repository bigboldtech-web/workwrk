// /api/item-updates — list + create user-authored updates on any
// polymorphic entity. Mirrors monday's per-row Updates feed.
//
// DELETE is exposed via /api/item-updates/[id] as soft-archive only.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

const createSchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1).max(80),
  body: z.string().min(1).max(20000),
});

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType + entityId required" }, { status: 400 });
  }

  const updates = await prisma.itemUpdate.findMany({
    where: { organizationId: ctx.orgId, entityType, entityId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const authorIds = Array.from(new Set(updates.map((u) => u.authorId).filter(Boolean) as string[]));
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  return NextResponse.json({
    updates: updates.map((u) => {
      const author = u.authorId ? authorMap.get(u.authorId) : null;
      return {
        id: u.id,
        body: u.body,
        authorId: u.authorId,
        authorName: author ? `${author.firstName ?? ""} ${author.lastName ?? ""}`.trim() || author.email : null,
        authorImage: author?.avatar ?? null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
    }),
  });
}

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const update = await prisma.itemUpdate.create({
    data: {
      organizationId: ctx.orgId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      body: parsed.data.body,
      authorId: ctx.userId,
    },
  });
  return NextResponse.json({ update });
}
