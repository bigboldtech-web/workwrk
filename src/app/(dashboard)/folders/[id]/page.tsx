// /folders/[id]. A Folder is a shelf in a Space: what is on it, and the
// controls to manage the shelf itself.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/folders/[id]`.
//
// WHAT THIS PAGE DID NOT HAVE, and now does:
//   * a BackButton (audit spaces-boards High #7). It had a hand-rolled
//     "Spaces / {Space}" text breadcrumb and nothing that went back one level;
//   * a Share control or a working "…" (audit Medium #13). The title row's
//     ChevronDown had no onClick at all, so the affordance was a decoration;
//   * a Canvas row. The Folder's own "New" menu creates Canvases and they were
//     invisible here (see prisma/sql/2026-09-19-canvas-folder.sql);
//   * a readable description. `NewFolderDialog` captures one at creation; the
//     page's `findFirst` did not even select the column
//     (audit section 12, the Folder gap). It is in the About modal now;
//   * per-List statuses on the Tasks tab. It rendered the SPACE wizard palette
//     for every row (audit High #3), so a List with its own statuses showed the
//     wrong word in the wrong colour and the in-row picker offered statuses
//     that List does not have;
//   * an Owner column with an owner in it (audit Medium #11).
//
// The tabs are `?tab=contents|tasks|birdseye`. The old `?view=overview|list`
// still resolves (it is one release of back-compat, not a redirect chain), so
// a bookmark and a Favorites link both land where they always did. Bird's eye
// is the Space's own view cut to this Folder: its Lists and its sub-folders',
// side by side (GET /api/folders/[id]/birdseye), `&focus=<listId>` for Focus.

import { notFound, redirect } from "next/navigation";
import { FolderFilesCard } from "@/components/spaces/folder-files-card";
import { FileDropZone } from "@/components/files/file-drop-zone";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { FileText, Brush, Lock } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { BackButton } from "@/components/ui/back-button";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { nodeCtxFromLevel, nodePath, nodeRole, nodeRoleMap, nodeRoles, spaceTree } from "@/lib/access/node-access";
import { refKey, roleAtLeast, toContainerRole, type NodeRef, type NodeRole } from "@/lib/access/node-rules";
import { pathViewRows } from "@/lib/access/node-tree";
import { PathContainerView } from "@/components/access/path-container-view";
import type { PlacementCrumb } from "@/lib/work/placement";
import { ContainerMenuTrigger } from "@/components/layout/os/container-menu";
import { ShareButton } from "@/components/access/share-button";
import { FolderTabs } from "./folder-tabs";
import { NewListGhostRow, NewFolderGhostRow } from "./new-in-folder";
import { SpaceListItemsTable } from "../../spaces/[slug]/space-list-items";
import { SpaceBirdseye } from "@/components/space-birdseye/space-birdseye";
import { readableFolderLists } from "@/lib/space";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "@/lib/board-items-shared";
// A Folder page is Work, so what is on the shelf opens at its Work address
// (src/lib/nav/object-href.ts), with the Work tree beside it.
import { objectHref } from "@/lib/nav/object-href";
import { mergeListTaskCounts } from "@/lib/list-links";
import { linkedTreeCountGroups } from "@/lib/list-links-server";

export const dynamic = "force-dynamic";

type FolderTab = "contents" | "tasks" | "birdseye";

export default async function FolderPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; view?: string; focus?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  // `?view=list` was the Tasks tab and `?view=overview` was Contents. Both keep
  // working for one release rather than 404ing a bookmark.
  const tab: FolderTab =
    sp.tab === "birdseye" ? "birdseye" : sp.tab === "tasks" || sp.view === "list" ? "tasks" : "contents";

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const folder = await prisma.folder.findFirst({
    where: { id, organizationId: u.organizationId, archivedAt: null },
    select: {
      id: true, name: true, icon: true, color: true, spaceId: true,
      visibility: true, ownerId: true,
      // The description NewFolderDialog has always captured and nothing ever
      // showed. The About modal reads and writes it (audit section 12).
      description: true, createdAt: true, parentFolderId: true,
      parentFolder: { select: { id: true, name: true } },
      space: { select: { id: true, slug: true, name: true, icon: true, color: true, visibility: true, settings: true } },
    },
  });
  if (!folder) notFound();

  // The viewer's role on this Folder, from the one resolver
  // (src/lib/access/node-access.ts): its own grant, an ancestor's, its
  // Space's, its owner, with the PRIVATE cut. A Folder grant (Full included)
  // gives nothing on the Space or on sibling Folders: roles never climb.
  const nodeCtx = nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel);
  const folderRef: NodeRef = { kind: "folder", id: folder.id };
  const [decision, steps] = await Promise.all([nodeRole(nodeCtx, folderRef), nodePath(nodeCtx, folderRef)]);

  // The crumb names the Space and the Folders above this one while the
  // viewer can open each or passes through it on the way here, and stops at
  // the first they can do neither with (no gap, nothing hidden named).
  const trail: PlacementCrumb[] = [];
  for (const st of steps) {
    if (!st.readable && !st.path) break;
    trail.push(
      st.kind === "space"
        ? { label: st.name, href: `/spaces/${encodeURIComponent(st.slug ?? st.id)}`, tile: { icon: st.icon, color: st.color, name: st.name } }
        : { label: st.name, href: `/folders/${encodeURIComponent(st.id)}` },
    );
  }

  if (!roleAtLeast(decision.role, "VIEW")) {
    if (!decision.path) notFound();
    // A path container: the viewer passes through this Folder on the way to
    // something they were given below it. Its name and those branches only.
    const tree = await spaceTree(nodeCtx, folder.spaceId);
    return (
      <PathContainerView
        kind="folder"
        id={folder.id}
        name={folder.name}
        icon={folder.icon}
        color={folder.color}
        trail={trail}
        rows={tree && folder.space ? pathViewRows(tree, folderRef, folder.space.slug) : []}
      />
    );
  }
  const canEdit = roleAtLeast(decision.role, "EDIT");
  // Full access on the Folder manages it (rename, move, delete, access).
  const canManage = roleAtLeast(decision.role, "FULL");
  // The placement rule (node-rules P1): Can edit or higher creates Lists,
  // sub-folders, docs and canvases in it, exactly what POST /api/boards and
  // POST /api/folders accept. The Contents card once offered New list and
  // New folder at Full only, while the header's New submenu offered them at
  // Can edit and the server took them (round three, break 8).
  const canCreateInFolder = canEdit;
  const folderRole = toContainerRole(decision.role) ?? "view";

  const childFolders = await prisma.folder.findMany({
    where: { spaceId: folder.spaceId, parentFolderId: folder.id, archivedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, icon: true, color: true, visibility: true, ownerId: true, updatedAt: true,
      _count: { select: { boards: true, childFolders: true } },
    },
  });
  // ONE world for every sub-folder and every List below this shelf: the
  // child Folder rows show the ones the viewer can open or passes through,
  // and every List read here (the rows, the Tasks tab, the counts, the
  // statuses) is one the viewer can open. A PRIVATE List, or a List under a
  // PRIVATE sub-folder, that the viewer cannot open is never read, named or
  // counted. The Lists are readableFolderLists (src/lib/space.ts), the one
  // read this page's Bird's eye tab answers from too, so the three tabs
  // always agree.
  const [childDecisions, boards] = await Promise.all([
    nodeRoles(nodeCtx, childFolders.map((f) => ({ kind: "folder" as const, id: f.id })), { paths: true }),
    readableFolderLists({ id: folder.id, spaceId: folder.spaceId }, { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel }),
  ]);
  const listRoles = new Map(boards.map((b) => [b.id, b.role] as const));
  const childRole = (id: string): NodeRole => childDecisions.get(refKey({ kind: "folder", id }))?.role ?? "none";
  const childIsPath = (id: string): boolean => childDecisions.get(refKey({ kind: "folder", id }))?.path ?? false;
  const visibleChildFolders = childFolders.filter((f) => roleAtLeast(childRole(f.id), "VIEW") || childIsPath(f.id));
  const directBoards = boards.filter((b) => b.folderId === folder.id);
  const boardIds = boards.map((b) => b.id);
  const readableListsIn = new Map<string, number>();
  for (const b of boards) if (b.folderId) readableListsIn.set(b.folderId, (readableListsIn.get(b.folderId) ?? 0) + 1);

  // audit High #3: every row's statuses come from that row's own List. A
  // Space-wide palette was the wrong answer for any List that sets its own.
  const statusesByList: Record<string, StatusOption[]> = Object.fromEntries(
    boards.map((b) => [b.slug, getBoardStatuses(b)]),
  );
  // The fallback for a row whose List is somehow absent from the map.
  const fallbackStatuses: StatusOption[] = getBoardStatuses(null);

  const [statusCounts, docs, canvases, ownerRows, listItems] = await Promise.all([
    // Bird's eye loads its own data from the client; the per-List counts are
    // the Contents tab's.
    boardIds.length && tab !== "birdseye"
      ? prisma.item.groupBy({
          by: ["boardId", "status"],
          where: { boardId: { in: boardIds }, archivedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([] as { boardId: string; status: string | null; _count: { _all: number } }[]),
    // The Folder's docs the viewer can open (a restricted doc they are not on
    // never shows), through one world.
    prisma.doc
      .findMany({
        where: { organizationId: u.organizationId, entityType: "FOLDER", entityId: folder.id, archivedAt: null },
        orderBy: { updatedAt: "desc" }, take: 50,
        select: { id: true, title: true, updatedAt: true, createdById: true },
      })
      .then(async (rows) => {
        const roles = await nodeRoleMap(nodeCtx, "doc", rows.map((d) => d.id));
        return rows.filter((d) => roleAtLeast(roles.get(d.id) ?? "none", "VIEW")).slice(0, 20);
      }),
    // One release of tolerance: `Whiteboard.folderId` is new
    // (prisma/sql/2026-09-19-canvas-folder.sql). A database that has not had
    // the file applied loses the Canvas rows, never the page. Only the
    // canvases that sit in THIS Folder of THIS Space (a Space move leaves a
    // canvas's folderId behind), and only the ones the viewer can open.
    prisma.whiteboard
      .findMany({
        where: { organizationId: u.organizationId, folderId: folder.id, spaceId: folder.spaceId, archivedAt: null },
        orderBy: { updatedAt: "desc" }, take: 50,
        select: { id: true, name: true, updatedAt: true, ownerId: true, spaceId: true },
      })
      .then(async (rows) => {
        const roles = await nodeRoleMap(nodeCtx, "canvas", rows.map((c) => c.id));
        return rows.filter((c) => roleAtLeast(roles.get(c.id) ?? "none", "VIEW")).slice(0, 20);
      })
      .catch(() => [] as Array<{ id: string; name: string; updatedAt: Date; ownerId: string | null; spaceId: string | null }>),
    (async () => {
      const ids = Array.from(new Set([
        ...visibleChildFolders.map((f) => f.ownerId),
        ...directBoards.map((b) => b.ownerId),
        folder.ownerId,
      ].filter((x): x is string => Boolean(x))));
      if (!ids.length) return [] as { id: string; firstName: string | null; lastName: string | null }[];
      return prisma.user.findMany({
        where: { id: { in: ids }, organizationId: u.organizationId },
        select: { id: true, firstName: true, lastName: true },
      });
    })(),
    tab === "tasks" && boardIds.length
      ? prisma.item.findMany({
          where: { boardId: { in: boardIds }, archivedAt: null },
          orderBy: { updatedAt: "desc" }, take: 200,
          select: {
            id: true, title: true, status: true, updatedAt: true, ownerId: true, parentItemId: true,
            board: { select: { slug: true, name: true } },
          },
        })
      : Promise.resolve([] as never[]),
  ]);

  const ownerById = new Map(
    ownerRows.map((o) => [o.id, `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || "Unknown"]),
  );
  const tasksByList = new Map<string, { open: number; done: number }>();
  // Phase 5b: each List's count includes the tasks linked into it, done or
  // open by their HOME status set. Data only; nothing on the page changes
  // until a task is actually shared into one of these Lists.
  // Grouped in Postgres, so the count is exact however many tasks are shared.
  const linkRows = tab === "birdseye" ? [] : await linkedTreeCountGroups(boardIds, { organizationId: u.organizationId });
  const homeStatuses = new Map(boards.map((b) => [b.id, getBoardStatuses(b)] as const));
  const otherHomes = [...new Set(linkRows.map((r) => r.homeBoardId))].filter((h) => !homeStatuses.has(h));
  if (otherHomes.length) {
    const homes = await prisma.board.findMany({ where: { id: { in: otherHomes } }, select: { id: true, statuses: true } });
    for (const h of homes) homeStatuses.set(h.id, getBoardStatuses(h));
  }
  const merged = mergeListTaskCounts(
    statusCounts.map((r) => ({ boardId: r.boardId, status: r.status, count: r._count._all })),
    linkRows,
    (home, status) => isDoneStatus(homeStatuses.get(home) ?? fallbackStatuses, status),
  );
  for (const [listId, count] of merged) tasksByList.set(listId, { open: count.open, done: count.done });

  const space = folder.space!;
  // back-map: the crumb immediately to the left, so a nested Folder goes to its
  // parent Folder and never skips a level. A crumb the viewer may not see is
  // never the Back target: then Back goes to the nearest one they may, or Work.
  const nearest = trail[trail.length - 1];
  const backHref = nearest?.href ?? "/home";
  const backLabel = nearest?.label ?? "Work";
  const isRestricted = folder.visibility === "PRIVATE";

  const rowCount = visibleChildFolders.length + directBoards.length + docs.length + canvases.length;

  return (
    <div className="flex flex-col h-full bg-app">
      <Breadcrumb items={[...trail, { label: folder.name }]} />

      {/* Title row (40): back · tile · name · lock · Share · "…" */}
      <div className="flex h-[40px] items-center gap-2 px-6">
        <BackButton fallbackHref={backHref} label={backLabel} className="me-0.5" />
        <EntityTile size="md" icon={folder.icon} color={folder.color} name={folder.name} fallback="folder" />
        <h1 className="min-w-0 flex items-center gap-1.5 text-title font-semibold text-ink">
          <span className="truncate" title={folder.name}>{folder.name}</span>
          {isRestricted ? (
            <Lock className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-label="Restricted" />
          ) : null}
        </h1>
        <div className="flex-1" />
        <ShareButton
          target={{
            kind: "folder", id: folder.id, name: folder.name,
            visibility: folder.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
            parentSpaceName: space.name,
          }}
          canManage={canManage}
        />
        <ContainerMenuTrigger
          container={{
            kind: "folder",
            id: folder.id,
            name: folder.name,
            icon: folder.icon,
            color: folder.color,
            visibility: folder.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
            description: folder.description,
            createdAt: folder.createdAt.toISOString(),
            owner: folder.ownerId ? { id: folder.ownerId, name: ownerById.get(folder.ownerId) ?? "Unknown" } : null,
            spaceId: space.id,
            spaceSlug: space.slug,
            spaceName: space.name,
            contents: `${directBoards.length} lists · ${visibleChildFolders.length} folders · ${docs.length} docs`,
          }}
          role={folderRole}
        />
      </div>

      <FolderTabs tab={tab} folderId={folder.id} taskCount={boardIds.length} />

      {tab === "birdseye" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <SpaceBirdseye
            scope={{ kind: "folder", id: folder.id, spaceId: folder.spaceId }}
            overviewHref={`/folders/${encodeURIComponent(folder.id)}?tab=birdseye`}
            initialFocusId={sp.focus ?? null}
            canCreateList={canCreateInFolder}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {tab === "tasks" ? (
            boards.length === 0 ? (
              <p className="text-base text-ink-2 py-8 text-center">
                Nothing to show until this folder has a list.
              </p>
            ) : (
              <div className="rounded-xl border border-line bg-raised overflow-hidden">
                <SpaceListItemsTable
                  items={listItems}
                  statuses={fallbackStatuses}
                  statusesByList={statusesByList}
                />
                {listItems.length === 200 ? (
                  <div className="px-3 py-2 text-xs text-ink-3 bg-subtle border-t border-line-soft">
                    Showing the 200 most recently updated tasks. Open a List for the full set.
                  </div>
                ) : null}
              </div>
            )
          ) : (
            <div className="space-y-6 max-w-5xl">
              {/* Contents: one table, every kind, in the spec's order. */}
              <section className="rounded-xl border border-line bg-raised overflow-hidden">
                <div className="grid grid-cols-[1fr_90px_180px_150px_44px] items-center px-3 py-2 border-b border-line-soft text-xs uppercase tracking-wide text-ink-2">
                  <span>Name</span>
                  <span>Type</span>
                  <span>Tasks</span>
                  <span>Owner</span>
                  <span className="sr-only">Actions</span>
                </div>
                {rowCount === 0 ? (
                  <p className="px-3 py-4 text-base text-ink-2">
                    Nothing here yet{canCreateInFolder ? " · Create a list below." : "."}
                  </p>
                ) : (
                  <ul>
                    {visibleChildFolders.map((f) => {
                      // A sub-folder the viewer only passes through (a path) is
                      // named and opens its path view: no count, no owner, no menu.
                      const role = toContainerRole(childRole(f.id));
                      if (!role) {
                        return (
                          <ContentsRow
                            key={f.id}
                            href={`/folders/${f.id}`}
                            glyph={<EntityTile size="sm" icon={f.icon} color={f.color} name={f.name} fallback="folder" />}
                            name={f.name}
                            type="Folder"
                            tasks=""
                            owner={null}
                            ownerHidden
                          />
                        );
                      }
                      const lists = readableListsIn.get(f.id) ?? 0;
                      return (
                        <ContentsRow
                          key={f.id}
                          href={`/folders/${f.id}`}
                          glyph={<EntityTile size="sm" icon={f.icon} color={f.color} name={f.name} fallback="folder" />}
                          name={f.name}
                          type="Folder"
                          tasks={`${lists} list${lists === 1 ? "" : "s"}`}
                          owner={f.ownerId ? ownerById.get(f.ownerId) ?? null : null}
                          menu={
                            <ContainerMenuTrigger
                              container={{
                                kind: "folder", id: f.id, name: f.name, icon: f.icon, color: f.color,
                                visibility: f.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
                                spaceId: space.id, spaceSlug: space.slug, spaceName: space.name,
                              }}
                              role={role}
                            />
                          }
                        />
                      );
                    })}
                    {directBoards.map((b) => {
                      const t = tasksByList.get(b.id) ?? { open: 0, done: 0 };
                      return (
                        <ContentsRow
                          key={b.id}
                          href={`/boards/${b.slug}`}
                          glyph={<EntityTile size="sm" icon={b.icon} color={b.color} name={b.name} fallback="list" />}
                          name={b.name}
                          type="List"
                          tasks={t.open === 0 && t.done === 0 ? "No tasks" : `${t.open} open · ${t.done} done`}
                          owner={b.ownerId ? ownerById.get(b.ownerId) ?? null : null}
                          menu={
                            <ContainerMenuTrigger
                              container={{
                                kind: "list", id: b.id, name: b.name, slug: b.slug, icon: b.icon, color: b.color,
                                visibility: b.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
                                spaceId: space.id, spaceSlug: space.slug, spaceName: space.name,
                                folderId: folder.id, folderName: folder.name,
                              }}
                              role={toContainerRole(listRoles.get(b.id) ?? "none") ?? "view"}
                            />
                          }
                        />
                      );
                    })}
                    {docs.map((d) => (
                      <ContentsRow
                        key={d.id}
                        href={objectHref("doc", d.id, "home", space.slug)}
                        glyph={<FileText className="w-4 h-4 text-ink-2 shrink-0" />}
                        name={d.title || "Untitled"}
                        type="Doc"
                        tasks=""
                        owner={d.createdById ? ownerById.get(d.createdById) ?? null : null}
                      />
                    ))}
                    {canvases.map((c) => (
                      <ContentsRow
                        key={c.id}
                        href={objectHref("canvas", c.id, "home", c.spaceId === folder.spaceId ? space.slug : null)}
                        glyph={<Brush className="w-4 h-4 text-ink-2 shrink-0" />}
                        name={c.name || "Untitled canvas"}
                        type="Canvas"
                        tasks=""
                        owner={c.ownerId ? ownerById.get(c.ownerId) ?? null : null}
                      />
                    ))}
                  </ul>
                )}
                {canCreateInFolder ? (
                  // Ghost rows with words, not two bare "+" glyphs: a person
                  // reading an empty shelf should be told what they can put on it.
                  <div className="flex items-center gap-1 px-2 py-1.5 border-t border-line-soft">
                    <NewListGhostRow spaceId={space.id} folderId={folder.id} />
                    <NewFolderGhostRow spaceId={space.id} parentFolderId={folder.id} />
                  </div>
                ) : null}
                {boardIds.length > 0 ? (
                  <div className="px-3 py-2 border-t border-line-soft">
                    <Link href={`/folders/${folder.id}?tab=tasks`} className="text-base text-brand-deep hover:underline">
                      All tasks in this folder
                    </Link>
                  </div>
                ) : null}
              </section>

              {/* Files, with the drop zone INSIDE the card. It used to sit above
                  the whole page on every tab (audit section 3, the oddity). */}
              <section className="space-y-3">
                {canEdit ? (
                  <FileDropZone spaceFolderId={folder.id} disabled={false} label={`"${folder.name}"`} />
                ) : null}
                <FolderFilesCard folderId={folder.id} canEdit={canEdit} />
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContentsRow({
  href, glyph, name, type, tasks, owner, ownerHidden = false, menu,
}: {
  href: string;
  glyph: React.ReactNode;
  name: string;
  type: string;
  tasks: string;
  owner: string | null;
  /** A path row names nothing about the container beyond its name. */
  ownerHidden?: boolean;
  menu?: React.ReactNode;
}) {
  return (
    <li className="group/row grid grid-cols-[1fr_90px_180px_150px_44px] items-center px-3 py-2 border-b border-line-soft last:border-b-0 hover:bg-hover transition-colors">
      <Link href={href} className="flex items-center gap-2 min-w-0">
        {glyph}
        <span className="text-base text-ink truncate">{name}</span>
      </Link>
      <span className="text-xs text-ink-2">{type}</span>
      <span className="text-xs text-ink-2 tabular-nums">{tasks}</span>
      <span className="text-xs text-ink-2 truncate">{ownerHidden ? "" : owner ?? "No owner"}</span>
      <span className="inline-flex items-center justify-end opacity-0 group-hover/row:opacity-100 transition-opacity">
        {menu}
      </span>
    </li>
  );
}
