// POST /api/docs/[id]/duplicate — clone a doc as a fresh note.
//
// Copies title (with " (copy)" suffix), content, meta, excerpt, and the
// entityType/entityId anchor. Does NOT carry over comments or version
// history — those belong to the original. Generates new block ids so
// the clone doesn't accidentally share comment threads via blockId.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const original = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: {
      title: true, content: true, excerpt: true,
      entityType: true, entityId: true, archivedAt: true,
    },
  });
  if (!original) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(original, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (original.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  // Re-key every block so the clone's comment-storage namespace (which
  // is `${docId}:${blockId}`) is fresh — no chance of a comment thread
  // unexpectedly attaching to the new doc through a recycled block id.
  const clonedContent = remintBlockIds(original.content);

  const created = await prisma.doc.create({
    data: {
      organizationId: ctx.orgId,
      title: `${original.title} (copy)`,
      content: clonedContent as object,
      excerpt: original.excerpt,
      entityType: original.entityType,
      entityId: original.entityId,
      createdById: ctx.userId,
    },
    select: { id: true, title: true, content: true, excerpt: true, updatedAt: true, createdAt: true },
  });

  // Seed v1 immediately so the new doc has a non-empty version trail.
  await prisma.docVersion.create({
    data: {
      docId: created.id,
      version: 1,
      title: created.title,
      content: clonedContent as object,
      authorId: ctx.userId,
    },
  });

  return NextResponse.json({ doc: created });
}

function remintBlockIds(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const c = content as { blocks?: unknown[] };
  if (!Array.isArray(c.blocks)) return content;
  const blocks = c.blocks.map((b) => {
    if (!b || typeof b !== "object") return b;
    const bb = b as { id?: string };
    return { ...bb, id: Math.random().toString(36).slice(2, 10) };
  });
  return { ...(c as object), blocks };
}
