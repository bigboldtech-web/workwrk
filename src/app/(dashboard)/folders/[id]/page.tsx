// Folder detail — a folder opens as its own page, mirroring the Space page
// chrome (breadcrumb, title row, view tabs). This is what lets you click a
// folder (from the Space Overview card or the sidebar) and see WHAT'S INSIDE:
// its Lists with live status/progress, its child folders, and its docs.
//
// Overview + List views are functional. Boards inside the folder (and any
// nested child folders) are aggregated for the List view and progress bars.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  Folder as FolderIcon, FileText, ListFilter, Zap, Sparkles, ChevronDown, Lock,
  List as ListIcon,
} from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { folderVisibleTo } from "@/lib/folder";
import { getSpaceForReader, canEditSpace } from "@/lib/space";
import { FolderViewTabs } from "./folder-view-tabs";
import { FolderMoreTrigger } from "@/components/layout/os/folder-more-menu";
import { ShareBoardButton } from "@/components/layout/os/share-board-button";
import { BoardMoreTrigger } from "@/components/layout/os/board-more-menu";
import { FolderCardCreate, ListCardCreate } from "@/components/layout/os/space-overview-create";
import { SpaceListItemsTable } from "../../spaces/[slug]/space-list-items";
import type { StatusOption } from "@/lib/board-items-shared";

export const dynamic = "force-dynamic";

type WorkflowStatus = { key: string; label: string; color: string; group: string };
function readWorkflowStatuses(settings: unknown): WorkflowStatus[] {
  if (!settings || typeof settings !== "object") return [];
  const w = (settings as Record<string, unknown>).workflow;
  if (!w || typeof w !== "object") return [];
  const s = (w as Record<string, unknown>).statuses;
  return Array.isArray(s) ? (s as WorkflowStatus[]) : [];
}

export default async function FolderPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const view = sp.view === "list" ? "list" : "overview";

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const folder = await prisma.folder.findFirst({
    where: { id, organizationId: u.organizationId, archivedAt: null },
    select: {
      id: true, name: true, icon: true, color: true, spaceId: true,
      visibility: true, ownerId: true,
      space: { select: { id: true, slug: true, name: true, icon: true, color: true, visibility: true, settings: true } },
    },
  });
  if (!folder) notFound();

  // Gate: viewer must be able to read the parent Space, and see this folder
  // (PRIVATE folders are owner/admin only).
  const readableSpace = await getSpaceForReader(folder.spaceId, u.id, u.accessLevel);
  if (!readableSpace) notFound();
  if (!folderVisibleTo(folder, u.id, u.accessLevel)) notFound();
  const canEdit = await canEditSpace(folder.spaceId, u.id, u.accessLevel);

  // Descendant folder set: everything nested under this folder, so "what's
  // inside" includes lists in sub-folders too (BFS over the space's folders).
  const allFolders = await prisma.folder.findMany({
    where: { spaceId: folder.spaceId, archivedAt: null },
    select: { id: true, parentFolderId: true },
  });
  const childrenByParent = new Map<string, string[]>();
  for (const f of allFolders) {
    const arr = childrenByParent.get(f.parentFolderId ?? "__root__") ?? [];
    arr.push(f.id);
    childrenByParent.set(f.parentFolderId ?? "__root__", arr);
  }
  const descendantIds = new Set<string>([folder.id]);
  const queue = [folder.id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!descendantIds.has(child)) { descendantIds.add(child); queue.push(child); }
    }
  }

  // Direct child folders (one level) for the Folders card, with their counts.
  const childFolders = await prisma.folder.findMany({
    where: { spaceId: folder.spaceId, parentFolderId: folder.id, archivedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, icon: true, color: true, visibility: true, ownerId: true,
      _count: { select: { boards: true, childFolders: true } },
    },
  });
  const visibleChildFolders = childFolders.filter((f) => folderVisibleTo(f, u.id, u.accessLevel));

  // Boards under this folder + descendants. PRIVATE boards the viewer can't
  // read are dropped from the aggregate (same leak class the Space page closes).
  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  const rawBoards = await prisma.board.findMany({
    where: { folderId: { in: Array.from(descendantIds) }, archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true, slug: true, name: true, icon: true, color: true,
      visibility: true, ownerId: true, folderId: true,
    },
  });
  const boards = rawBoards.filter((b) => isAdmin || canEdit || b.visibility !== "PRIVATE" || b.ownerId === u.id);
  const directBoards = boards.filter((b) => b.folderId === folder.id);
  const boardIds = boards.map((b) => b.id);

  const workflowStatuses = readWorkflowStatuses(folder.space?.settings);
  const statusOptions: StatusOption[] = workflowStatuses.map((s) => ({
    value: s.key, label: s.label, color: s.color, group: s.group as StatusOption["group"],
  }));
  const doneKeys = new Set(workflowStatuses.filter((s) => s.group === "DONE").map((s) => s.key).concat(["DONE"]));

  // Per-board progress (done / total) + folder docs, in parallel.
  const [totalByBoard, doneCount, docs] = await Promise.all([
    boardIds.length
      ? prisma.item.groupBy({ by: ["boardId"], where: { boardId: { in: boardIds }, archivedAt: null }, _count: { _all: true } })
      : Promise.resolve([] as { boardId: string; _count: { _all: number } }[]),
    boardIds.length
      ? prisma.item.groupBy({ by: ["boardId"], where: { boardId: { in: boardIds }, archivedAt: null, status: { in: Array.from(doneKeys) } }, _count: { _all: true } })
      : Promise.resolve([] as { boardId: string; _count: { _all: number } }[]),
    prisma.doc.findMany({
      where: { organizationId: u.organizationId, entityType: "FOLDER", entityId: folder.id, archivedAt: null },
      orderBy: { updatedAt: "desc" }, take: 8,
      select: { id: true, title: true },
    }),
  ]);
  const totalMap = new Map(totalByBoard.map((r) => [r.boardId, r._count._all]));
  const doneMap = new Map(doneCount.map((r) => [r.boardId, r._count._all]));

  // List-view items: cross-board pull scoped to this folder (recency, capped).
  const listItems = view === "list" && boardIds.length
    ? await prisma.item.findMany({
        where: { boardId: { in: boardIds }, archivedAt: null },
        orderBy: { updatedAt: "desc" }, take: 200,
        select: {
          id: true, title: true, status: true, updatedAt: true, ownerId: true, parentItemId: true,
          board: { select: { slug: true, name: true } },
        },
      })
    : [];

  const space = folder.space!;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb + title row — Space / Folder */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/spaces" className="hover:text-zinc-900">Spaces</Link>
          <span className="text-zinc-300">/</span>
          <Link href={`/spaces/${space.slug}`} className="hover:text-zinc-900 inline-flex items-center gap-1.5">
            <EntityTile size="xs" icon={space.icon} color={space.color} name={space.name} />
            {space.name}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-100">
            <FolderIcon className="w-4 h-4 text-amber-500" style={folder.color ? { color: folder.color } : undefined} />
          </span>
          <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-1.5 min-w-0">
            <span className="truncate" title={folder.name}>{folder.name}</span>
            <button type="button" aria-label="Folder menu" title="Folder menu" className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {folder.visibility === "PRIVATE" ? <Lock className="w-3.5 h-3.5 text-zinc-400" /> : null}
            <button type="button" aria-label="Filter" title="Filter" className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
              <ListFilter className="w-3.5 h-3.5" />
            </button>
          </h1>
          <div className="flex-1" />
          <button type="button" className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100" title="Automations">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Automate
          </button>
          <button type="button" className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100">
            <Sparkles className="w-3.5 h-3.5 text-[var(--os-brand)]" />
            Ask
          </button>
        </div>
      </div>

      <FolderViewTabs view={view} folderId={folder.id} />

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {view === "list" ? (
          boards.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">No lists in this folder yet.</p>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
              <SpaceListItemsTable items={listItems} statuses={statusOptions} canEdit={canEdit} currentUserId={u.id} />
              {listItems.length === 200 ? (
                <div className="px-3 py-2 text-[10.5px] text-zinc-400 bg-zinc-50 border-t border-zinc-100">
                  Showing 200 most-recently-updated items. Open a List for the full set.
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="space-y-6 max-w-5xl">
            {/* Child folders */}
            {visibleChildFolders.length > 0 ? (
              <Card title="Folders" action={canEdit ? <FolderCardCreate spaceId={space.id} parentFolderId={folder.id} /> : undefined}>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {visibleChildFolders.map((f) => (
                    <li key={f.id} className="group/folder relative">
                      <Link
                        href={`/folders/${f.id}`}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors"
                      >
                        <FolderIcon className="w-4 h-4 text-zinc-500 shrink-0" style={f.color ? { color: f.color } : undefined} />
                        <span className="text-sm text-zinc-900 truncate flex-1">{f.name}</span>
                      </Link>
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/folder:opacity-100 transition-opacity">
                        <FolderMoreTrigger folder={{ id: f.id, name: f.name, icon: f.icon, color: f.color }} spaceId={space.id} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {/* Lists — the boards inside this folder, with live progress. */}
            <Card title="Lists" action={canEdit ? <ListCardCreate spaceId={space.id} folderId={folder.id} /> : undefined}>
              {directBoards.length === 0 ? (
                <p className="text-xs text-zinc-500 px-2 py-3">No lists yet.</p>
              ) : (
                <div className="rounded-lg border border-zinc-200 overflow-hidden">
                  <div className="grid grid-cols-[1fr_120px_160px_120px] items-center px-3 py-2 border-b border-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500">
                    <span>Name</span><span>Color</span><span>Progress</span><span>Owner</span>
                  </div>
                  <ul>
                    {directBoards.map((b) => {
                      const total = totalMap.get(b.id) ?? 0;
                      const done = doneMap.get(b.id) ?? 0;
                      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                      return (
                        <li key={b.id} className="group/board grid grid-cols-[1fr_120px_160px_120px] items-center px-3 py-2 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors">
                          <Link href={`/boards/${b.slug}`} className="flex items-center gap-2 min-w-0">
                            <ListIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span className="text-[12.5px] text-zinc-900 truncate">{b.name}</span>
                          </Link>
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm" style={{ background: b.color ?? "#A1A1AA" }} aria-hidden />
                            <span className="text-[11px] text-zinc-500">{b.color ?? "—"}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 rounded-full bg-zinc-100 overflow-hidden">
                              <span className="block h-full bg-emerald-400" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="text-[10.5px] text-zinc-500 tabular-nums shrink-0">{done}/{total}</span>
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <span className="opacity-0 group-hover/board:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                              <ShareBoardButton boardId={b.id} boardName={b.name} visibility={b.visibility} parentSpaceName={space.name} />
                              <BoardMoreTrigger board={{ id: b.id, name: b.name, slug: b.slug, icon: b.icon, color: b.color }} />
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Card>

            {/* Docs anchored to this folder */}
            <Card title="Docs">
              {docs.length === 0 ? (
                <p className="text-xs text-zinc-500 px-2 py-3">No docs in this folder yet.</p>
              ) : (
                <ul className="-mx-2">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <Link href={`/docs/${d.id}`} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 transition-colors rounded text-[12.5px]">
                        <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="text-zinc-900 truncate">{d.title || "Untitled"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
