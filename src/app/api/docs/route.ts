// /api/docs — list + create universal Docs.
//
// A Doc can be standalone (entityType + entityId both null) or pinned
// to an entity (e.g. a Task description, a board row's Doc cell).
// Every create snapshots v1 into DocVersion immediately so the
// version trail starts at row 1.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.unknown().optional(),
  entityType: z.string().max(40).nullable().optional(),
  entityId: z.string().max(80).nullable().optional(),
});

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const standaloneOnly = url.searchParams.get("standaloneOnly") === "1";

  const docs = await prisma.doc.findMany({
    where: {
      organizationId: ctx.orgId,
      archivedAt: null,
      ...(entityType && entityId ? { entityType, entityId } : {}),
      ...(standaloneOnly ? { entityType: null, entityId: null } : {}),
    },
    select: {
      id: true, title: true, excerpt: true, entityType: true, entityId: true,
      createdById: true, createdAt: true, updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ docs });
}

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const content = (parsed.data.content as object) ?? {};

  const doc = await prisma.doc.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      content,
      entityType: parsed.data.entityType ?? null,
      entityId: parsed.data.entityId ?? null,
      createdById: ctx.userId,
      // Snapshot v1 immediately so every Doc has at least one version.
      versions: {
        create: { version: 1, title: parsed.data.title, content, authorId: ctx.userId },
      },
    },
    select: { id: true, title: true, content: true, entityType: true, entityId: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ doc });
}
