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
// The two tabs are `?tab=contents|tasks`. The old `?view=overview|list` still
// resolves (it is one release of back-compat, not a redirect chain), so a
// bookmark and a Favorites link both land where they always did.

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
import { folderVisibleTo } from "@/lib/folder";
import { canEditSpace } from "@/lib/space";
import { resolveAccess, meets, type ViewerContext } from "@/lib/access";
import { ContainerMenuTrigger } from "@/components/layout/os/container-menu";
import { ShareButton } from "@/components/access/share-button";
import { FolderTabs } from "./folder-tabs";
import { NewListGhostRow, NewFolderGhostRow } from "./new-in-folder";
import { SpaceListItemsTable } from "../../spaces/[slug]/space-list-items";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "@/lib/board-items-shared";
// A Folder page is Work, so what is on the shelf opens at its Work address
// (src/lib/nav/object-href.ts), with the Work tree beside it.
import { objectHref } from "@/lib/nav/object-href";

export const dynamic = "force-dynamic";

type FolderTab = "contents" | "tasks";

export default async function FolderPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; view?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  // `?view=list` was the Tasks tab and `?view=overview` was Contents. Both keep
  // working for one release rather than 404ing a bookmark.
  const tab: FolderTab =
    sp.tab === "tasks" || sp.view === "list" ? "tasks" : "contents";

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

  const viewer: ViewerContext = { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" };
  const decision = await resolveAccess(viewer, { type: "folder", id: folder.id });
  if (decision.permission === "none") notFound();
  const canEdit = meets(decision, "edit");
  const canManage = meets(decision, "admin");

  // WHAT A FOLDER GRANT ACTUALLY BUYS, TODAY.
  //
  // The Share dialog's "Can edit the contents" on a Folder writes a
  // FolderMember row, and `resolveFolder` above honours it, so `canEdit` is
  // true for a folder grantee. No WRITE gate anywhere else consults
  // FolderMember: `POST /api/boards` and `POST /api/folders` both answer to
  // `canEditSpace` (org admin, Space OWNER, Space ADMIN). So the two create
  // rows at the foot of the Contents table were offered to exactly the people
  // the server refuses.
  //
  // Until the contribute path learns about FolderMember (tracked separately;
  // it is an access-engine change, not a screen change), the honest thing is
  // to render those two rows only to people the create endpoints accept, and
  // to say plainly why they are absent. Files are NOT in this bucket: `POST
  // /api/files` scopes by org and never asks about the folder, so the drop
  // zone below keeps working for a grantee and stays on `canEdit`.
  const canCreateInFolder = await canEditSpace(folder.spaceId, u.id, u.accessLevel ?? "EMPLOYEE");

  // Everything nested under this folder, so the Tasks tab covers the shelf and
  // every shelf below it.
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

  const childFolders = await prisma.folder.findMany({
    where: { spaceId: folder.spaceId, parentFolderId: folder.id, archivedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, icon: true, color: true, visibility: true, ownerId: true, updatedAt: true,
      _count: { select: { boards: true, childFolders: true } },
    },
  });
  const visibleChildFolders = childFolders.filter((f) => folderVisibleTo(f, u.id, u.accessLevel));

  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  const rawBoards = await prisma.board.findMany({
    where: { folderId: { in: Array.from(descendantIds) }, archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true, slug: true, name: true, icon: true, color: true,
      visibility: true, ownerId: true, folderId: true, updatedAt: true, statuses: true,
    },
  });
  const boards = rawBoards.filter((b) => isAdmin || canEdit || b.visibility !== "PRIVATE" || b.ownerId === u.id);
  const directBoards = boards.filter((b) => b.folderId === folder.id);
  const boardIds = boards.map((b) => b.id);

  // audit High #3: every row's statuses come from that row's own List. A
  // Space-wide palette was the wrong answer for any List that sets its own.
  const statusesByList: Record<string, StatusOption[]> = Object.fromEntries(
    boards.map((b) => [b.slug, getBoardStatuses(b)]),
  );
  // The fallback for a row whose List is somehow absent from the map.
  const fallbackStatuses: StatusOption[] = getBoardStatuses(null);

  const [statusCounts, docs, canvases, ownerRows, listItems] = await Promise.all([
    boardIds.length
      ? prisma.item.groupBy({
          by: ["boardId", "status"],
          where: { boardId: { in: boardIds }, archivedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([] as { boardId: string; status: string | null; _count: { _all: number } }[]),
    prisma.doc.findMany({
      where: { organizationId: u.organizationId, entityType: "FOLDER", entityId: folder.id, archivedAt: null },
      orderBy: { updatedAt: "desc" }, take: 20,
      select: { id: true, title: true, updatedAt: true, createdById: true },
    }),
    // One release of tolerance: `Whiteboard.folderId` is new
    // (prisma/sql/2026-09-19-canvas-folder.sql). A database that has not had
    // the file applied loses the Canvas rows, never the page.
    prisma.whiteboard
      .findMany({
        where: { organizationId: u.organizationId, folderId: folder.id, archivedAt: null },
        orderBy: { updatedAt: "desc" }, take: 20,
        // spaceId too: a Space move leaves a canvas's folderId behind, so its
        // link is Space-scoped only when it still sits in this Folder's Space.
        select: { id: true, name: true, updatedAt: true, ownerId: true, spaceId: true },
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
  for (const row of statusCounts) {
    const bucket = tasksByList.get(row.boardId) ?? { open: 0, done: 0 };
    const opts = boards.find((b) => b.id === row.boardId);
    if (isDoneStatus(opts ? getBoardStatuses(opts) : fallbackStatuses, row.status)) bucket.done += row._count._all;
    else bucket.open += row._count._all;
    tasksByList.set(row.boardId, bucket);
  }

  const space = folder.space!;
  // back-map: the crumb immediately to the left, so a nested Folder goes to its
  // parent Folder and never skips a level.
  const backHref = folder.parentFolder ? `/folders/${folder.parentFolder.id}` : `/spaces/${space.slug}`;
  const backLabel = folder.parentFolder?.name ?? space.name;
  const isRestricted = folder.visibility === "PRIVATE";

  const rowCount = visibleChildFolders.length + directBoards.length + docs.length + canvases.length;

  return (
    <div className="flex flex-col h-full bg-app">
      <Breadcrumb
        items={[
          { label: space.name, href: `/spaces/${space.slug}`, tile: { icon: space.icon, color: space.color, name: space.name } },
          ...(folder.parentFolder ? [{ label: folder.parentFolder.name, href: `/folders/${folder.parentFolder.id}` }] : []),
          { label: folder.name },
        ]}
      />

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
          role={canManage ? "full" : canEdit ? "edit" : "view"}
        />
      </div>

      <FolderTabs tab={tab} folderId={folder.id} taskCount={boardIds.length} />

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
                  {visibleChildFolders.map((f) => (
                    <ContentsRow
                      key={f.id}
                      href={`/folders/${f.id}`}
                      glyph={<EntityTile size="sm" icon={f.icon} color={f.color} name={f.name} fallback="folder" />}
                      name={f.name}
                      type="Folder"
                      tasks={`${f._count.boards} list${f._count.boards === 1 ? "" : "s"}`}
                      owner={f.ownerId ? ownerById.get(f.ownerId) ?? null : null}
                      menu={
                        <ContainerMenuTrigger
                          container={{
                            kind: "folder", id: f.id, name: f.name, icon: f.icon, color: f.color,
                            visibility: f.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
                            spaceId: space.id, spaceSlug: space.slug, spaceName: space.name,
                          }}
                          role={canManage ? "full" : canEdit ? "edit" : "view"}
                        />
                      }
                    />
                  ))}
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
                            role={canManage ? "full" : canEdit ? "edit" : "view"}
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
              ) : canEdit ? (
                // A refusal has to be readable. This person was shared into the
                // folder and can work inside the lists on it, but creating a
                // list or a sub-folder is a Space-level right today, so name
                // the right and name who grants it instead of showing a button
                // that answers 403.
                <p className="px-3 py-2 border-t border-line-soft text-xs text-ink-3">
                  You can work in this folder, but adding a list or a sub-folder
                  needs Full access on the {space.name} space. Ask a space admin.
                </p>
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
    </div>
  );
}

function ContentsRow({
  href, glyph, name, type, tasks, owner, menu,
}: {
  href: string;
  glyph: React.ReactNode;
  name: string;
  type: string;
  tasks: string;
  owner: string | null;
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
      <span className="text-xs text-ink-2 truncate">{owner ?? "No owner"}</span>
      <span className="inline-flex items-center justify-end opacity-0 group-hover/row:opacity-100 transition-opacity">
        {menu}
      </span>
    </li>
  );
}
