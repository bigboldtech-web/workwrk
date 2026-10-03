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
import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { readableItemsVia } from "@/lib/list-links-server";
import { sopVisibilityWhere } from "@/lib/sop-access";

type Kind = "doc" | "sop";

type Hit = {
  type: "doc" | "sop";
  id: string;
  title: string;
  icon?: string;
  excerpt?: string | null;
  updatedAt: string;
};

// Board-item sources use a distinct shape (sourceType/sourceId/href) so
// the panel can route them to /item/<id> instead of a doc/SOP page.
type ItemHit = {
  sourceType: "BOARD_ITEM";
  sourceId: string;
  title: string;
  href: string;
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

  // The SOP read rule (the SOP list's and the SOP page's), for the target
  // and for every SOP that links to it.
  const sopVisible = await sopVisibilityWhere({ user: { id: ctx.userId, organizationId: ctx.orgId, accessLevel: ctx.accessLevel } });

  // Only for a doc or SOP the person can open: the panel of one they cannot
  // is not theirs to read, and it would confirm the id and count its sources.
  if (kind === "doc") {
    const role = (await nodeRoleMap(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), "doc", [id])).get(id) ?? "none";
    if (!roleAtLeast(role, "VIEW")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else if ((await prisma.sOP.count({ where: { AND: [{ id, organizationId: ctx.orgId }, sopVisible] } })) === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // All EntityLink rows that point AT this entity.
  const links = await prisma.entityLink.findMany({
    where: {
      organizationId: ctx.orgId,
      targetType: kind === "doc" ? "DOC" : "SOP",
      targetId: id,
      // Both EMBEDDED (sop_card etc.) and REFERENCES (inline @-mention)
      // count as "linked from" for the panel. A task an SOP step created
      // links back as REQUIRED_READING (src/lib/sop-spawn.ts), so tasks
      // count with that relation too; only tasks, which are gated below.
      OR: [
        { relationKind: { in: ["EMBEDDED", "REFERENCES"] } },
        { relationKind: "REQUIRED_READING", sourceType: "BOARD_ITEM" },
      ],
    },
    select: { sourceType: true, sourceId: true, relationKind: true },
    take: 1000,
  });

  // Bucket by source type so we can do one batched fetch per kind.
  const docIds = links.filter((l) => l.sourceType === "DOC").map((l) => l.sourceId);
  const sopIds = links.filter((l) => l.sourceType === "SOP").map((l) => l.sourceId);
  const itemIds = [...new Set(links.filter((l) => l.sourceType === "BOARD_ITEM").map((l) => l.sourceId))];

  const [docs, sops, items] = await Promise.all([
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
          // A SOP source is named only to someone who can open it: a draft, or
          // a SOP in a folder they hold no grant on, is a 404 on its own page.
          where: { AND: [{ id: { in: sopIds }, organizationId: ctx.orgId, status: { not: "ARCHIVED" } }, sopVisible] },
          select: { id: true, title: true, updatedAt: true },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; updatedAt: Date }>),
    itemIds.length > 0
      ? prisma.item.findMany({
          where: { id: { in: itemIds }, organizationId: ctx.orgId, archivedAt: null },
          select: { id: true, title: true, updatedAt: true, boardId: true, organizationId: true, ownerId: true, assigneeIds: true, parentItemId: true, itemType: true },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; updatedAt: Date; boardId: string; organizationId: string; ownerId: string | null; assigneeIds: string[]; parentItemId: string | null; itemType: string }>),
  ]);

  // Doc hits, filtered by the viewer's role on each doc in ONE world (private
  // notes, restricted docs and sub-pages under a page they cannot open stay
  // hidden from viewers who can't read them).
  const docRoles = await nodeRoleMap(
    nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel),
    "doc",
    docs.map((d) => d.id),
  );
  const docHits: Hit[] = [];
  for (const d of docs) {
    if (!roleAtLeast(docRoles.get(d.id) ?? "none", "VIEW")) continue;
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

  // Board items that embed/reference this entity ("this SOP backs task
  // X"). Additive: `docs` and `sops` keep their existing shape. Only the
  // tasks this viewer may read are named (the item gate's ladder, batched).
  const itemAccess = items.length
    ? await readableItemsVia({ userId: ctx.userId, accessLevel: ctx.accessLevel, organizationId: ctx.orgId }, items)
    : new Map<string, { readable: boolean }>();
  const itemHits: ItemHit[] = items.filter((it) => itemAccess.get(it.id)?.readable === true).map((it) => ({
    sourceType: "BOARD_ITEM" as const,
    sourceId: it.id,
    title: it.title || "Untitled task",
    href: `/item/${it.id}`,
    updatedAt: it.updatedAt.toISOString(),
  }));

  docHits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sopHits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  itemHits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json({ docs: docHits, sops: sopHits, items: itemHits });
}
