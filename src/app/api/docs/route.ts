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
import { docAccessible } from "@/lib/doc-access";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.unknown().optional(),
  entityType: z.string().max(40).nullable().optional(),
  entityId: z.string().max(80).nullable().optional(),
  parentId: z.string().nullable().optional(),
  isFolder: z.boolean().optional(),
  position: z.number().optional(),
});

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const standaloneOnly = url.searchParams.get("standaloneOnly") === "1";
  // `archived=1` flips to the trash view — only soft-archived docs.
  const archived = url.searchParams.get("archived") === "1";

  const docs = await prisma.doc.findMany({
    where: {
      organizationId: ctx.orgId,
      archivedAt: archived ? { not: null } : null,
      ...(entityType && entityId ? { entityType, entityId } : {}),
      ...(standaloneOnly ? { entityType: null, entityId: null } : {}),
    },
    select: {
      id: true, title: true, excerpt: true, entityType: true, entityId: true,
      createdById: true, createdAt: true, updatedAt: true, archivedAt: true,
      parentId: true, isFolder: true, position: true,
      // The note's icon/emoji lives in content.meta.icon (no dedicated column),
      // so pull content to derive `emoji` for list rows. Dropped from the
      // response below so the payload stays lean.
      content: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  // Phase 37 — gate per row via docAccessible, which handles SPACE +
  // BOARD + BOARD_ITEM anchors. Standalone docs (entityType=null) and
  // suite-specific anchors fall through. Per-row resolution is fine
  // at the 100-doc cap; library views typically pre-filter by
  // entity anyway.
  const flags = await Promise.all(
    docs.map((d) => docAccessible(d, ctx.userId, ctx.accessLevel)),
  );
  const gated = docs.filter((_, i) => flags[i]);

  // Resolve each doc's anchor into a "Location" (real Space/Folder/Board/Item
  // name + icon/color) so the Docs list shows *which* Space, not just "Space".
  const idsOf = (t: string) =>
    [...new Set(gated.filter((d) => d.entityType === t && d.entityId).map((d) => d.entityId as string))];
  const [locSpaces, locBoards, locFolders, locItems] = await Promise.all([
    idsOf("SPACE").length ? prisma.space.findMany({ where: { id: { in: idsOf("SPACE") } }, select: { id: true, name: true, icon: true, color: true, slug: true } }) : Promise.resolve([]),
    idsOf("BOARD").length ? prisma.board.findMany({ where: { id: { in: idsOf("BOARD") } }, select: { id: true, name: true, icon: true, color: true, slug: true } }) : Promise.resolve([]),
    idsOf("FOLDER").length ? prisma.folder.findMany({ where: { id: { in: idsOf("FOLDER") } }, select: { id: true, name: true, icon: true, color: true } }) : Promise.resolve([]),
    idsOf("BOARD_ITEM").length ? prisma.item.findMany({ where: { id: { in: idsOf("BOARD_ITEM") } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  type Loc = { type: string; name: string; icon: string | null; color: string | null; href: string | null };
  const locMap = new Map<string, Loc>();
  for (const s of locSpaces) locMap.set(`SPACE:${s.id}`, { type: "SPACE", name: s.name, icon: s.icon, color: s.color, href: `/spaces/${s.slug}` });
  for (const b of locBoards) locMap.set(`BOARD:${b.id}`, { type: "BOARD", name: b.name, icon: b.icon, color: b.color, href: `/boards/${b.slug}` });
  for (const f of locFolders) locMap.set(`FOLDER:${f.id}`, { type: "FOLDER", name: f.name, icon: f.icon, color: f.color, href: null });
  for (const it of locItems) locMap.set(`BOARD_ITEM:${it.id}`, { type: "BOARD_ITEM", name: it.title, icon: null, color: null, href: `/item/${it.id}` });

  // Attach creator display info for list views ("Created by" column).
  const creatorIds = [...new Set(gated.map((d) => d.createdById).filter((x): x is string => !!x))];
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const creatorById = new Map(creators.map((u) => [u.id, u]));
  const enriched = gated.map((d) => {
    const u = d.createdById ? creatorById.get(d.createdById) : undefined;
    const name = u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null) : null;
    // Derive the list-row icon from content.meta.icon, then drop the heavy
    // content blob so the response stays small.
    const { content, ...rest } = d;
    const meta = (content as { meta?: { icon?: string | null } } | null)?.meta;
    const emoji = typeof meta?.icon === "string" && meta.icon ? meta.icon : null;
    const location = d.entityType && d.entityId ? locMap.get(`${d.entityType}:${d.entityId}`) ?? null : null;
    return { ...rest, emoji, location, createdBy: u ? { name, avatar: u.avatar } : null };
  });

  return NextResponse.json({ docs: enriched });
}

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const content = (parsed.data.content as object) ?? {};

  // Phase 37 — block pinning to an entity the viewer can't see.
  // Without this, a probe with a guessed boardId could mint a doc on
  // a board the viewer can't read.
  const ok = await docAccessible(
    { entityType: parsed.data.entityType ?? null, entityId: parsed.data.entityId ?? null },
    ctx.userId,
    ctx.accessLevel,
  );
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = await prisma.doc.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      content,
      entityType: parsed.data.entityType ?? null,
      entityId: parsed.data.entityId ?? null,
      parentId: parsed.data.parentId ?? null,
      isFolder: parsed.data.isFolder ?? false,
      // Default to a monotonically increasing position so new items land at
      // the bottom of their sibling list (sorted ascending in the tree).
      position: parsed.data.position ?? Date.now(),
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
