// GET /api/backlinks?kind=doc|sop&id=<id>
//
// Returns every doc and SOP that references the given entity. Used by
// the "Linked from" panel in the Notes editor and the SOP detail page.
//
// Implementation: queries the EntityLink table (populated by
// syncLinksFromBlocks on each save). Indexed lookup, O(matches).
// Replaces the previous org-wide content scan which became too slow
// past a few hundred docs.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";

type Kind = "doc" | "sop";

type Hit = {
  type: "doc" | "sop";
  id: string;
  title: string;
  icon?: string;
  excerpt?: string | null;
  updatedAt: string;
};

export async function GET(req: NextRequest) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as Kind | null;
  const id = url.searchParams.get("id");
  if (!kind || !id || (kind !== "doc" && kind !== "sop")) {
    return NextResponse.json({ error: "kind=doc|sop and id required" }, { status: 400 });
  }

  // All EntityLink rows that point AT this entity.
  const links = await prisma.entityLink.findMany({
    where: {
      organizationId: ctx.orgId,
      targetType: kind === "doc" ? "DOC" : "SOP",
      targetId: id,
      // Both EMBEDDED (sop_card etc.) and REFERENCES (inline @-mention)
      // count as "linked from" for the panel.
      relationKind: { in: ["EMBEDDED", "REFERENCES"] },
    },
    select: { sourceType: true, sourceId: true, relationKind: true },
    take: 1000,
  });

  // Bucket by source type so we can do one batched fetch per kind.
  const docIds = links.filter((l) => l.sourceType === "DOC").map((l) => l.sourceId);
  const sopIds = links.filter((l) => l.sourceType === "SOP").map((l) => l.sourceId);

  const [docs, sops] = await Promise.all([
    docIds.length > 0
      ? prisma.doc.findMany({
          where: { id: { in: docIds }, organizationId: ctx.orgId, archivedAt: null },
          select: {
            id: true, title: true, excerpt: true, content: true, updatedAt: true,
            entityType: true, entityId: true,
          },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; excerpt: string | null; content: unknown; updatedAt: Date; entityType: string | null; entityId: string | null }>),
    sopIds.length > 0
      ? prisma.sOP.findMany({
          where: { id: { in: sopIds }, organizationId: ctx.orgId, status: { not: "ARCHIVED" } },
          select: { id: true, title: true, updatedAt: true },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; updatedAt: Date }>),
  ]);

  // Doc hits — filter by per-row access (private notes that reference
  // this entity stay hidden from viewers who can't read them).
  const docHits: Hit[] = [];
  for (const d of docs) {
    if (!(await docAccessible(d, ctx.userId, ctx.accessLevel))) continue;
    if (kind === "doc" && d.id === id) continue;
    const meta = (d.content as { meta?: { icon?: string } } | null)?.meta;
    docHits.push({
      type: "doc",
      id: d.id,
      title: d.title || "Untitled note",
      icon: meta?.icon,
      excerpt: d.excerpt ?? null,
      updatedAt: d.updatedAt.toISOString(),
    });
  }
  const sopHits: Hit[] = sops
    .filter((s) => !(kind === "sop" && s.id === id))
    .map((s) => ({
      type: "sop" as const,
      id: s.id,
      title: s.title || "Untitled SOP",
      updatedAt: s.updatedAt.toISOString(),
    }));

  docHits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sopHits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json({ docs: docHits, sops: sopHits });
}
