// GET /api/docs/[id]/comments
//
// Aggregator that returns every block comment for a single doc, keyed
// by block id. The BlockDocEditor uses this on mount to populate the
// gutter indicator counts in one round-trip; the CommentsPanel for any
// individual block still calls the polymorphic /api/item-updates
// endpoints for create / archive.
//
// Block comments live in ItemUpdate rows with:
//   entityType = "DOC_BLOCK"
//   entityId   = `${docId}:${blockId}`
//
// This keeps the existing comment + activity infrastructure (Monday-
// style polymorphic feed, soft-archive, author hydration) without a
// new table.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";

const ENTITY_TYPE = "DOC_BLOCK";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id: docId } = await params;

  // Gate the read at the doc level so private notes' threads aren't
  // exposed by tagging the entityId.
  const doc = await prisma.doc.findFirst({
    where: { id: docId, organizationId: ctx.orgId },
    select: { id: true, entityType: true, entityId: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // entityId pattern `docId:blockId` — query by startsWith so a single
  // index scan covers every block in this doc.
  const updates = await prisma.itemUpdate.findMany({
    where: {
      organizationId: ctx.orgId,
      entityType: ENTITY_TYPE,
      entityId: { startsWith: `${docId}:` },
      archivedAt: null,
    },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });

  const authorIds = Array.from(new Set(updates.map((u) => u.authorId).filter(Boolean) as string[]));
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  // Group by blockId for the editor's commentsByBlock map.
  const byBlock: Record<string, Array<{
    id: string;
    authorId: string;
    authorName: string;
    authorAvatar: string | null;
    text: string;
    createdAt: string;
    resolved: boolean;
  }>> = {};
  for (const u of updates) {
    // entityId = `${docId}:${blockId}` — strip prefix.
    const blockId = u.entityId.startsWith(`${docId}:`) ? u.entityId.slice(docId.length + 1) : u.entityId;
    if (!blockId) continue;
    const author = u.authorId ? authorMap.get(u.authorId) : null;
    const authorName = author
      ? (`${author.firstName ?? ""} ${author.lastName ?? ""}`.trim() || author.email || "Unknown")
      : "Unknown";
    const row = {
      id: u.id,
      authorId: u.authorId ?? "",
      authorName,
      authorAvatar: author?.avatar ?? null,
      text: u.body,
      createdAt: u.createdAt.toISOString(),
      // ItemUpdate doesn't have a resolved flag of its own — we treat
      // archived as the universal "remove from active thread" signal,
      // and resolve via a soft DELETE for now. Future work can add a
      // dedicated resolved column when threading needs richer states.
      resolved: false,
    };
    if (!byBlock[blockId]) byBlock[blockId] = [];
    byBlock[blockId].push(row);
  }

  return NextResponse.json({ commentsByBlock: byBlock });
}
