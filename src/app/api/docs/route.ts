// /api/docs — list + create universal Docs.
//
// A Doc can be standalone (entityType + entityId both null) or pinned
// to an entity (e.g. a Task description, a board row's Doc cell).
// NOTEPAD/<userId> anchors are personal sticky notes: owner-only via
// docAccessible, and hidden from every un-anchored list below.
// Every create snapshots v1 into DocVersion immediately so the
// version trail starts at row 1.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { docAccessible } from "@/lib/doc-access";
import { getDocSharingMap, isDocFull, resolveDocRole } from "@/lib/doc-sharing";
import { getEffectivePreferences } from "@/lib/preferences";
import { matchesFilters, matchesView, parseDocsListQuery, slicePage, sortDocs, type DocsCandidate } from "@/lib/docs-list";
import { resolveDocLocations } from "@/lib/doc-location";
import { readDocLocks } from "@/lib/doc-lock";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.unknown().optional(),
  entityType: z.string().max(40).nullable().optional(),
  entityId: z.string().max(80).nullable().optional(),
  parentId: z.string().nullable().optional(),
  isFolder: z.boolean().optional(),
  position: z.number().optional(),
});

/**
 * Per-row gate with one call per distinct anchor: a hundred docs on the same
 * List ask the resolver once. The gate runs over EVERY candidate before any
 * cap or page slice (critic 12: the old `take: 200` bit before gating, so a
 * viewer who could read 30 of the newest 200 saw 30 rows and no way to page).
 */
async function gateDocs<T extends { entityType: string | null; entityId: string | null }>(docs: T[], userId: string, accessLevel: string | null | undefined): Promise<T[]> {
  const cache = new Map<string, Promise<boolean>>();
  const flags = await Promise.all(
    docs.map((d) => {
      const key = `${d.entityType ?? ""}:${d.entityId ?? ""}`;
      let p = cache.get(key);
      if (!p) { p = docAccessible(d, userId, accessLevel); cache.set(key, p); }
      return p;
    }),
  );
  return docs.filter((_, i) => flags[i]);
}

/**
 * GET /api/docs?view=all|recent|my|shared|favorites&q=&location=&owner=
 *   &updatedFrom=&updatedTo=&includeChildren=0|1&sort=&dir=&cursor=&limit=40
 *   -> { data: DocRow[], total, nextCursor }
 *
 * The /docs list page (spec-docs-knowledge section 2). Server-side views,
 * filters, sort and cursor pagination over the gated set, with a REAL total.
 * The legacy shape ({ docs }, the 200 newest) survives for the callers that
 * pass none of these params (the sidebar tree, the card pickers, entity
 * anchors), so nothing that read it before reads anything different.
 */
async function pagedList(req: Request, ctx: { orgId: string; userId: string; accessLevel: string | null | undefined }) {
  const q = parseDocsListQuery(new URL(req.url).searchParams);

  const [candidates, prefs, org, childCounts] = await Promise.all([
    prisma.doc.findMany({
      where: {
        organizationId: ctx.orgId,
        archivedAt: null,
        OR: [{ entityType: null }, { entityType: { not: "NOTEPAD" } }],
      },
      select: { id: true, title: true, entityType: true, entityId: true, createdById: true, updatedAt: true, parentId: true },
    }),
    getEffectivePreferences(ctx.userId, ctx.orgId),
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } }),
    prisma.doc.groupBy({ by: ["parentId"], where: { organizationId: ctx.orgId, archivedAt: null, parentId: { not: null } }, _count: { _all: true } }),
  ]);

  const gated = await gateDocs(candidates, ctx.userId, ctx.accessLevel);

  const sharing = getDocSharingMap(org?.settings);
  const home = prefs.home as { favoriteDocIds?: string[]; recentDocViews?: { id: string; at: string }[] };
  const facts = {
    userId: ctx.userId,
    favoriteIds: new Set<string>(Array.isArray(home.favoriteDocIds) ? home.favoriteDocIds : []),
    viewedAt: new Map<string, string>((Array.isArray(home.recentDocViews) ? home.recentDocViews : []).map((v) => [v.id, v.at])),
  };

  // Location and owner names are needed to SORT, so they are resolved over
  // the gated set (light rows: ids and names only), never over the page.
  const filtered: DocsCandidate[] = gated
    .map((d) => ({ ...d, sharedWithMe: !!sharing[d.id]?.members?.[ctx.userId] }))
    .filter((d) => matchesView(d, q.view, facts) && matchesFilters(d, q));

  const [locMap, users] = await Promise.all([
    resolveDocLocations(filtered),
    (() => {
      const ids = [...new Set(filtered.map((d) => d.createdById).filter((x): x is string => !!x))];
      return ids.length
        ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, avatar: true } })
        : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null; avatar: string | null }[]);
    })(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: string | null) => {
    const u = id ? userById.get(id) : undefined;
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
  };
  for (const d of filtered) {
    d.locationName = d.entityType && d.entityId ? locMap.get(`${d.entityType}:${d.entityId}`)?.name ?? "" : "";
    d.ownerName = nameOf(d.createdById);
  }

  const sorted = sortDocs(filtered, q.sort, q.dir, facts);
  const { page, nextCursor } = slicePage(sorted, q.cursor, q.limit);

  // The views row's counts, from the same gated set the rows come from
  // (spec-docs-knowledge section 2: "the sidebar badge counts and the page
  // counts come from the same query"). Sub-docs follow the same Include rule.
  const counts = {
    all: 0, recent: 0, my: 0, shared: 0, favorites: 0,
  } as Record<"all" | "recent" | "my" | "shared" | "favorites", number>;
  for (const d of gated) {
    const row: DocsCandidate = { ...d, sharedWithMe: !!sharing[d.id]?.members?.[ctx.userId] };
    if (!q.includeChildren && row.parentId) continue;
    for (const v of Object.keys(counts) as (keyof typeof counts)[]) {
      if (matchesView(row, v, facts)) counts[v] += 1;
    }
  }

  // Only the page carries content (for the emoji) and a parent title.
  const pageIds = page.map((d) => d.id);
  const parentIds = [...new Set(page.map((d) => d.parentId).filter((x): x is string => !!x))];
  const [full, parents] = await Promise.all([
    pageIds.length ? prisma.doc.findMany({ where: { id: { in: pageIds } }, select: { id: true, content: true } }) : Promise.resolve([]),
    parentIds.length ? prisma.doc.findMany({ where: { id: { in: parentIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  const contentById = new Map(full.map((f) => [f.id, f.content]));
  const parentTitle = new Map(parents.map((p) => [p.id, p.title]));
  const childCount = new Map(childCounts.map((c) => [c.parentId as string, c._count._all]));

  // Contributors (every DocVersion author) for the PAGE only: the Display
  // toggle that keeps the old table's column reachable, off by default.
  const [contribRows, locks] = await Promise.all([
    pageIds.length
      ? prisma.docVersion.groupBy({ by: ["docId", "authorId"], where: { docId: { in: pageIds }, authorId: { not: null } }, _max: { createdAt: true } })
      : Promise.resolve([]),
    // The lock (change request A4) gates the row menu exactly as it gates the
    // editor: below Full access a locked doc is Can comment, so the menu
    // offers no Rename or Move that the server would refuse.
    readDocLocks(pageIds),
  ]);
  const contribAuthorIds = [...new Set(contribRows.map((r) => r.authorId).filter((x): x is string => !!x && !userById.has(x)))];
  const contribUsers = contribAuthorIds.length
    ? await prisma.user.findMany({ where: { id: { in: contribAuthorIds } }, select: { id: true, firstName: true, lastName: true, avatar: true } })
    : [];
  for (const u of contribUsers) userById.set(u.id, u);
  const contribByDoc = new Map<string, { id: string; at: number }[]>();
  for (const r of contribRows) {
    if (!r.authorId) continue;
    const list = contribByDoc.get(r.docId) ?? [];
    list.push({ id: r.authorId, at: r._max.createdAt ? new Date(r._max.createdAt).getTime() : 0 });
    contribByDoc.set(r.docId, list);
  }

  const data = page.map((d) => {
    const meta = (contentById.get(d.id) as { meta?: { icon?: string | null } } | null | undefined)?.meta;
    const emoji = typeof meta?.icon === "string" && meta.icon ? meta.icon : null;
    const owner = d.createdById ? userById.get(d.createdById) : undefined;
    return {
      id: d.id,
      title: d.title,
      emoji,
      parentId: d.parentId,
      parentTitle: d.parentId ? parentTitle.get(d.parentId) ?? null : null,
      childCount: childCount.get(d.id) ?? 0,
      location: d.entityType && d.entityId ? locMap.get(`${d.entityType}:${d.entityId}`) ?? null : null,
      entityType: d.entityType,
      entityId: d.entityId,
      ownerId: d.createdById,
      owner: owner ? { id: owner.id, name: nameOf(owner.id) || null, avatar: owner.avatar, firstName: owner.firstName, lastName: owner.lastName } : null,
      updatedAt: d.updatedAt,
      viewedAt: facts.viewedAt.get(d.id) ?? null,
      favorite: facts.favoriteIds.has(d.id),
      sharedWithMe: !!d.sharedWithMe,
      contributors: (contribByDoc.get(d.id) ?? [])
        .sort((a, b) => b.at - a.at)
        .slice(0, 5)
        .map((c) => userById.get(c.id))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((x) => ({ id: x.id, firstName: x.firstName, lastName: x.lastName, avatar: x.avatar })),
      // The viewer's role on this doc (settings.docSharing) and whether they
      // hold Full access (creator or admin), so the row menu can gate its rows.
      myRole: rowRole(d.id, d.createdById),
      canManage: isDocFull(ctx, { createdById: d.createdById }),
    };
  });

  function rowRole(id: string, createdById: string | null): "edit" | "comment" | "view" {
    const role = resolveDocRole(sharing[id], { userId: ctx.userId, accessLevel: ctx.accessLevel, createdById }) ?? "view";
    if (!locks.get(id)?.lockedById || isDocFull(ctx, { createdById })) return role;
    return role === "view" ? "view" : "comment";
  }

  return NextResponse.json({ data, total: sorted.length, nextCursor, counts });
}

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  if (parseDocsListQuery(url.searchParams).paged && !url.searchParams.get("entityType")) {
    return pagedList(req, ctx);
  }
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const standaloneOnly = url.searchParams.get("standaloneOnly") === "1";
  // `archived=1` flips to the trash view — only soft-archived docs.
  const archived = url.searchParams.get("archived") === "1";

  const docs = await prisma.doc.findMany({
    where: {
      organizationId: ctx.orgId,
      archivedAt: archived ? { not: null } : null,
      // Personal Notepad notes are reachable ONLY via an explicit
      // entityType=NOTEPAD&entityId=<self> query (docAccessible still
      // gates the pair per-row). Every un-anchored list — /docs tree,
      // Library, pickers, trash view — excludes them. The OR keeps
      // entityType:null standalone docs: Prisma `not` on a nullable
      // column drops NULL rows, which would hide every standalone doc.
      ...(entityType && entityId
        ? { entityType, entityId }
        : { OR: [{ entityType: null }, { entityType: { not: "NOTEPAD" } }] }),
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

  // The viewer's role per row rides on the legacy shape too, so the tree
  // hosts that read it (the Docs sidebar, the pages panel) gate their row
  // menu the way the /docs table does instead of assuming Can edit.
  const [locMap, legacyOrg, legacyLocks] = await Promise.all([
    resolveDocLocations(gated),
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } }),
    readDocLocks(gated.map((d) => d.id)),
  ]);
  const legacySharing = getDocSharingMap(legacyOrg?.settings);
  const legacyRole = (d: { id: string; createdById: string | null }): "edit" | "comment" | "view" => {
    const role = resolveDocRole(legacySharing[d.id], { userId: ctx.userId, accessLevel: ctx.accessLevel, createdById: d.createdById }) ?? "view";
    if (!legacyLocks.get(d.id)?.lockedById || isDocFull(ctx, { createdById: d.createdById })) return role;
    return role === "view" ? "view" : "comment";
  };

  // Contributors — every distinct DocVersion author per doc, derived at
  // read time (no storage). Most-recent-save first, capped at 5 below.
  const contribRows = gated.length
    ? await prisma.docVersion.groupBy({
        by: ["docId", "authorId"],
        where: { docId: { in: gated.map((d) => d.id) }, authorId: { not: null } },
        _max: { createdAt: true },
      })
    : [];
  const contribByDoc = new Map<string, Array<{ authorId: string; at: number }>>();
  for (const r of contribRows) {
    if (!r.authorId) continue;
    const list = contribByDoc.get(r.docId) ?? [];
    list.push({ authorId: r.authorId, at: r._max.createdAt ? new Date(r._max.createdAt).getTime() : 0 });
    contribByDoc.set(r.docId, list);
  }

  // Attach creator + contributor display info for list views.
  const creatorIds = [...new Set(gated.map((d) => d.createdById).filter((x): x is string => !!x))];
  const contribAuthorIds = contribRows.map((r) => r.authorId).filter((x): x is string => !!x);
  const userIds = [...new Set([...creatorIds, ...contribAuthorIds])];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const enriched = gated.map((d) => {
    const u = d.createdById ? userById.get(d.createdById) : undefined;
    const name = u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null) : null;
    // Derive the list-row icon from content.meta.icon, then drop the heavy
    // content blob so the response stays small.
    const { content, ...rest } = d;
    const meta = (content as { meta?: { icon?: string | null } } | null)?.meta;
    const emoji = typeof meta?.icon === "string" && meta.icon ? meta.icon : null;
    const location = d.entityType && d.entityId ? locMap.get(`${d.entityType}:${d.entityId}`) ?? null : null;
    const versionAuthors = (contribByDoc.get(d.id) ?? [])
      .sort((a, b) => b.at - a.at)
      .slice(0, 5)
      .map((c) => userById.get(c.authorId))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: x.id, firstName: x.firstName, lastName: x.lastName, avatar: x.avatar }));
    // Docs with no authored versions still show their creator.
    const contributors = versionAuthors.length
      ? versionAuthors
      : u ? [{ id: u.id, firstName: u.firstName, lastName: u.lastName, avatar: u.avatar }] : [];
    return {
      ...rest, emoji, location, createdBy: u ? { name, avatar: u.avatar } : null, contributors,
      myRole: legacyRole(d),
      canManage: isDocFull(ctx, { createdById: d.createdById }),
    };
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
