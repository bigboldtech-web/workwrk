// /api/item-updates — list + create user-authored updates on any
// polymorphic entity. Mirrors monday's per-row Updates feed.
//
// DELETE is exposed via /api/item-updates/[id] as soft-archive only.
//
// A doc's block comments ride here as entityType DOC_BLOCK with an entityId
// of "<docId>:<blockId>", and they follow the doc (the one node-access
// resolver): reading them needs Can view on the doc, writing one needs Can
// comment. Every other entity type answers as it always has.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docRoleFor, nodeCtxFromSession } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { z } from "zod";

/**
 * For a DOC_BLOCK thread: may the viewer read ("read") or write ("write")
 * it? Null when the entity is not a doc block. A doc outside the viewer's
 * org, or one they cannot open, is the same 404 as a wrong id.
 */
async function docBlockGate(entityType: string, entityId: string, orgId: string, need: "read" | "write"): Promise<NextResponse | null> {
  if (entityType !== "DOC_BLOCK") return null;
  const docId = entityId.split(":")[0];
  const notFound = NextResponse.json({ error: "not found" }, { status: 404 });
  if (!docId) return notFound;
  const doc = await prisma.doc.findFirst({ where: { id: docId, organizationId: orgId }, select: { id: true } });
  if (!doc) return notFound;
  const ctx = await nodeCtxFromSession();
  if (!ctx || ctx.organizationId !== orgId) return notFound;
  const info = await docRoleFor(ctx, doc.id);
  if (!roleAtLeast(info.unlockedRole, "VIEW")) return notFound;
  // A Can view grant is read only; every older "view" listing reads as Can
  // comment, so nobody who commented before loses it.
  if (need === "write" && !info.canComment) return NextResponse.json({ error: "read-only" }, { status: 403 });
  return null;
}

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
  const refused = await docBlockGate(entityType, entityId, ctx.orgId, "read");
  if (refused) return refused;

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
  const refused = await docBlockGate(parsed.data.entityType, parsed.data.entityId, ctx.orgId, "write");
  if (refused) return refused;

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
