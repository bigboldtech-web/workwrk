// GET /api/me/mentions
//
// Mentions inbox — every place across docs and SOPs where the current
// user is @-mentioned. Backed by the EntityLink graph (relationKind =
// REFERENCES, targetType = USER, targetId = <me>) so each request is
// an indexed lookup, not an org-wide content scan.
//
// For the excerpt we hydrate from the source's content JSON, finding
// the block that holds the pill so the inbox row shows useful context.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
// The scanner is shared with scripts/backfill-mentions.ts so the notifications
// that backfill writes anchor at exactly the blocks this page links to.
import { findMentionBlocks } from "@/lib/doc-mentions";

type Hit = {
  source: "doc" | "sop";
  sourceId: string;
  sourceTitle: string;
  sourceIcon?: string;
  blockId: string;
  excerpt: string;
  updatedAt: string;
};

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const me = ctx.userId;

  const links = await prisma.entityLink.findMany({
    where: {
      organizationId: ctx.orgId,
      relationKind: "REFERENCES",
      targetType: "USER",
      targetId: me,
      sourceType: { in: ["DOC", "SOP"] },
    },
    select: { sourceType: true, sourceId: true, updatedAt: true },
    take: 1000,
    orderBy: { updatedAt: "desc" },
  });

  const docIds = links.filter((l) => l.sourceType === "DOC").map((l) => l.sourceId);
  const sopIds = links.filter((l) => l.sourceType === "SOP").map((l) => l.sourceId);

  const [docs, sops] = await Promise.all([
    docIds.length > 0
      ? prisma.doc.findMany({
          where: { id: { in: docIds }, organizationId: ctx.orgId, archivedAt: null },
          select: {
            id: true, title: true, content: true, updatedAt: true,
            entityType: true, entityId: true,
          },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; content: unknown; updatedAt: Date; entityType: string | null; entityId: string | null }>),
    sopIds.length > 0
      ? prisma.sOP.findMany({
          where: { id: { in: sopIds }, organizationId: ctx.orgId, status: { not: "ARCHIVED" } },
          select: { id: true, title: true, content: true, updatedAt: true },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; content: unknown; updatedAt: Date }>),
  ]);

  const hits: Hit[] = [];
  for (const d of docs) {
    if (!(await docAccessible(d, ctx.userId, ctx.accessLevel))) continue;
    const meta = (d.content as { meta?: { icon?: string } } | null)?.meta;
    for (const { blockId, excerpt } of findMentionBlocks(d.content, me)) {
      hits.push({
        source: "doc",
        sourceId: d.id,
        sourceTitle: d.title || "Untitled note",
        sourceIcon: meta?.icon,
        blockId,
        excerpt,
        updatedAt: d.updatedAt.toISOString(),
      });
    }
  }
  for (const s of sops) {
    for (const { blockId, excerpt } of findMentionBlocks(s.content, me)) {
      hits.push({
        source: "sop",
        sourceId: s.id,
        sourceTitle: s.title || "Untitled SOP",
        blockId,
        excerpt,
        updatedAt: s.updatedAt.toISOString(),
      });
    }
  }
  hits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json({ hits });
}
