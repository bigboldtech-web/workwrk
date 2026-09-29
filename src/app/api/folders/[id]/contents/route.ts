// GET /api/folders/[id]/contents — what is on this shelf, in one round trip.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/folders/[id]`
// Data: "`GET /api/folders/[id]/contents?cursor=&sort=&type=&ownerId=` (new;
// folders, lists with counts, docs)" and Body layout 1, the Contents table
// (Name · Type · Tasks · Owner · Updated), which also lists Canvases.
//
// WHY A ROUTE AND NOT MORE PRISMA IN THE PAGE. The Folder page ran five
// queries inline and still could not fill three of its own columns: the
// progress bar and the Owner cell had no data behind them and the Canvas rows
// had nowhere to come from. Putting the shape here means the page renders the
// answer and the same answer is available to the tree, to search and to the
// Space page's Lists tab without a fourth copy of the counting.
//
// ONE RELEASE OF TOLERANCE. `Whiteboard.folderId` is new
// (prisma/sql/2026-09-19-canvas-folder.sql). If the column is not there yet the
// canvases query throws, and this route answers with an empty canvases array
// rather than a 500: a missing column degrades one section, never the page.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import { getBoardStatuses, isDoneStatus } from "@/lib/board-items-shared";
import { mergeListTaskCounts } from "@/lib/list-links";
import { linkedTreeCountGroups } from "@/lib/list-links-server";

export const dynamic = "force-dynamic";

export type ContentsType = "folder" | "list" | "doc" | "canvas";

export interface ContentsRow {
  kind: ContentsType;
  id: string;
  name: string;
  href: string;
  slug?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: string | null;
  /** "12 open · 40 done" for a List, "3 lists" for a Folder, null otherwise. */
  tasks: { open: number; done: number } | null;
  childCount?: number | null;
  owner: { id: string; name: string } | null;
  updatedAt: string;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const organizationId = u.organizationId;
  const { id } = await params;

  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type") as ContentsType | null;
  const showArchived = url.searchParams.get("archived") === "1";

  const folder = await prisma.folder.findFirst({
    where: { id, organizationId },
    select: { id: true, spaceId: true },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // THE FOLDER, NOT ONLY ITS SPACE: Can view on the Folder itself, from the
  // one resolver the page and GET /api/boards?folderId= use. A path Folder is
  // not a role (its page renders only the branches that lead to a grant).
  const ctx = nodeCtxFromLevel(u.id, organizationId, accessLevel);
  const own = (await nodeRoles(ctx, [{ kind: "folder", id }])).get(`folder:${id}`)?.role ?? "none";
  if (!roleAtLeast(own, "VIEW")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Full access on the Folder manages its shelf (W2), never the Space's rights.
  const canEdit = roleAtLeast(own, "FULL");
  const archivedWhere = showArchived ? {} : { archivedAt: null };

  const [rawFolders, rawLists, rawDocs, rawCanvases] = await Promise.all([
    prisma.folder.findMany({
      where: { organizationId, parentFolderId: id, ...archivedWhere },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, icon: true, color: true, visibility: true, ownerId: true, updatedAt: true,
        _count: { select: { boards: true, childFolders: true } },
      },
    }),
    prisma.board.findMany({
      where: { organizationId, folderId: id, ...archivedWhere },
      orderBy: { name: "asc" },
      select: {
        id: true, slug: true, name: true, icon: true, color: true,
        visibility: true, ownerId: true, updatedAt: true, statuses: true,
      },
    }),
    prisma.doc.findMany({
      where: { organizationId, entityType: "FOLDER", entityId: id, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true, createdById: true },
    }),
    prisma.whiteboard
      .findMany({
        where: { organizationId, folderId: id, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: { id: true, name: true, updatedAt: true, ownerId: true },
      })
      .catch(() => [] as Array<{ id: string; name: string; updatedAt: Date; ownerId: string | null }>),
  ]);

  // Every row through ONE world: a sub-folder, List, doc or canvas the viewer
  // cannot open is never listed, named or counted (the Private cut, restricted
  // docs and grants all honoured, as the tree does).
  const refs: NodeRef[] = [
    ...rawFolders.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...rawLists.map((b) => ({ kind: "list" as const, id: b.id })),
    ...rawDocs.map((d) => ({ kind: "doc" as const, id: d.id })),
    ...rawCanvases.map((c) => ({ kind: "canvas" as const, id: c.id })),
  ];
  const roles = refs.length ? await nodeRoles(ctx, refs) : new Map();
  const reads = (kind: string, rowId: string) => roleAtLeast(roles.get(`${kind}:${rowId}`)?.role ?? "none", "VIEW");
  const folders = rawFolders.filter((f) => reads("folder", f.id));
  const lists = rawLists.filter((b) => reads("list", b.id));
  const docs = rawDocs.filter((d) => reads("doc", d.id));
  const canvases = rawCanvases.filter((c) => reads("canvas", c.id));

  // Open / done per List, resolved through each List's OWN statuses (audit
  // spaces-boards High #3), not a Space-wide palette.
  const listIds = lists.map((b) => b.id);
  const statusCounts = listIds.length
    ? await prisma.item.groupBy({
        by: ["boardId", "status"],
        where: { boardId: { in: listIds }, archivedAt: null },
        _count: { _all: true },
      })
    : [];
  const tasksByList = new Map<string, { open: number; done: number }>();
  const statusesByList = new Map(lists.map((b) => [b.id, getBoardStatuses(b)]));
  // Phase 5b: a List's count includes the tasks linked into it, each done or
  // open by its HOME status set (the status belongs to the home).
  // Grouped in Postgres, so the count is exact however many tasks are shared.
  const linkRows = await linkedTreeCountGroups(listIds, { organizationId });
  const otherHomes = [...new Set(linkRows.map((r) => r.homeBoardId))].filter((h) => !statusesByList.has(h));
  if (otherHomes.length) {
    const homes = await prisma.board.findMany({ where: { id: { in: otherHomes } }, select: { id: true, statuses: true } });
    for (const h of homes) statusesByList.set(h.id, getBoardStatuses(h));
  }
  const merged = mergeListTaskCounts(
    statusCounts.map((r) => ({ boardId: r.boardId, status: r.status, count: r._count._all })),
    linkRows,
    (home, status) => isDoneStatus(statusesByList.get(home) ?? [], status),
  );
  for (const [listId, count] of merged) tasksByList.set(listId, { open: count.open, done: count.done });

  const ownerIds = Array.from(new Set([
    ...folders.map((f) => f.ownerId),
    ...lists.map((b) => b.ownerId),
    ...docs.map((d) => d.createdById),
    ...canvases.map((c) => c.ownerId),
  ].filter((x): x is string => Boolean(x))));
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds }, organizationId },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const ownerById = new Map(
    owners.map((o) => [o.id, { id: o.id, name: `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || "Unknown" }]),
  );
  const ownerOf = (ownerId: string | null) => (ownerId ? ownerById.get(ownerId) ?? null : null);

  const rows: ContentsRow[] = [
    ...folders.map((f): ContentsRow => ({
      kind: "folder",
      id: f.id,
      name: f.name,
      href: `/folders/${f.id}`,
      icon: f.icon,
      color: f.color,
      visibility: f.visibility,
      tasks: null,
      childCount: f._count.boards,
      owner: ownerOf(f.ownerId),
      updatedAt: f.updatedAt.toISOString(),
    })),
    ...lists.map((b): ContentsRow => ({
      kind: "list",
      id: b.id,
      name: b.name,
      href: `/boards/${b.slug}`,
      slug: b.slug,
      icon: b.icon,
      color: b.color,
      visibility: b.visibility,
      tasks: tasksByList.get(b.id) ?? { open: 0, done: 0 },
      owner: ownerOf(b.ownerId),
      updatedAt: b.updatedAt.toISOString(),
    })),
    ...docs.map((d): ContentsRow => ({
      kind: "doc",
      id: d.id,
      name: d.title || "Untitled",
      href: `/docs/${d.id}`,
      tasks: null,
      owner: ownerOf(d.createdById),
      updatedAt: d.updatedAt.toISOString(),
    })),
    ...canvases.map((c): ContentsRow => ({
      kind: "canvas",
      id: c.id,
      name: c.name || "Untitled canvas",
      href: `/canvas/${c.id}`,
      tasks: null,
      owner: ownerOf(c.ownerId),
      updatedAt: c.updatedAt.toISOString(),
    })),
  ];

  const filtered = typeFilter ? rows.filter((r) => r.kind === typeFilter) : rows;
  return NextResponse.json({ rows: filtered, canEdit, total: filtered.length });
}
