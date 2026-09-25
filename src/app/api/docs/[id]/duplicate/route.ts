// POST /api/docs/[id]/duplicate — clone a doc as a fresh note.
//
// Copies title (with " (copy)" suffix), content, meta, excerpt, the
// entityType/entityId anchor and the parent page, so the copy sits beside the
// original and is open to exactly the people who reach that place. The actor
// must be able to create a doc there (canCreateDocAt, the rule POST /api/docs
// applies): a grant on one doc never plants a copy in a Folder or Space the
// person holds no role on, where they could not open it. Does NOT carry over comments or version
// history — those belong to the original. Generates new block ids so
// the clone doesn't accidentally share comment threads via blockId.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { canCreateDocAt, docAccessible } from "@/lib/doc-access";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { requireDocRole } from "@/lib/doc-sharing";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const original = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: {
      title: true, content: true, excerpt: true,
      id: true, entityType: true, entityId: true, parentId: true, archivedAt: true, createdById: true,
    },
  });
  if (!original) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(original, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Viewers may duplicate (the clone is a fresh doc they own; the source
  // is never mutated). Restricted + unlisted → 404.
  const role = await requireDocRole(ctx, { id, createdById: original.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (original.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  const anchor = original.entityType && original.entityId ? { entityType: original.entityType, entityId: original.entityId } : null;
  if (!(await canCreateDocAt(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), anchor, original.parentId))) {
    // The sentence rides in `error` because apiFetch, and so every toast
    // built on r.error, reads `error` first: as "forbidden" it reached the
    // person as that one bare word. The code moves to `code`.
    const message = "You can't add docs where this one lives, so it can't be copied there.";
    return NextResponse.json({ error: message, code: "forbidden", message }, { status: 403 });
  }

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
      parentId: original.parentId,
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
