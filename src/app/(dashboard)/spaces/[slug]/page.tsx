// Space detail — header + folder/board management. Server-rendered;
// the "+ Folder / + Board" buttons are a small client island
// (SpaceActions) that opens the corresponding dialogs and calls
// router.refresh() so the page re-fetches on success.
//
// Phase 3 ships the create+list flow; Phase 3b will add inline rename,
// drag-reorder, archive/restore, and the actual board renderer at
// /boards/[slug].

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Folder as FolderIcon, Layers, Lock, Users as UsersIcon, ListTree } from "lucide-react";
import Link from "next/link";
import { SpaceActions } from "@/components/layout/os/space-actions";

export const dynamic = "force-dynamic";

export default async function SpacePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const space = await prisma.space.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      _count: { select: { members: true, folders: true, boards: true } },
      folders: {
        where: { archivedAt: null, parentFolderId: null },
        orderBy: { position: "asc" },
        include: {
          _count: { select: { boards: true, childFolders: true } },
          boards: {
            where: { archivedAt: null },
            orderBy: { name: "asc" },
            select: {
              id: true, slug: true, name: true, icon: true, color: true,
              itemType: true, visibility: true,
              views: { where: { isDefault: true }, take: 1, select: { type: true } },
            },
          },
        },
      },
      boards: {
        where: { archivedAt: null, folderId: null },
        orderBy: { name: "asc" },
        select: {
          id: true, slug: true, name: true, icon: true, color: true,
          itemType: true, visibility: true,
          views: { where: { isDefault: true }, take: 1, select: { type: true } },
        },
      },
    },
  });
  if (!space) notFound();

  // Visibility check (lightweight; Phase 6 will centralize).
  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  if (!isAdmin && space.visibility !== "ORG") {
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: space.id, userId: u.id } },
      select: { id: true },
    });
    if (!member) notFound();
  }

  const hasContent = space.folders.length > 0 || space.boards.length > 0;

  return (
    <div className="px-8 py-6 max-w-[1200px]">
      <header className="mb-6 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted mb-2">
            <Link href="/spaces" className="hover:text-foreground">Spaces</Link>
            <span>/</span>
            <span className="truncate">{space.name}</span>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            {space.visibility === "PRIVATE" ? (
              <Lock className="w-5 h-5 text-muted" />
            ) : (
              <Layers className="w-5 h-5 text-muted" />
            )}
            {space.name}
          </h1>
          {space.description ? (
            <p className="text-sm text-muted mt-2 max-w-[640px]">{space.description}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <UsersIcon className="w-3.5 h-3.5" />
              {space._count.members} member{space._count.members === 1 ? "" : "s"}
            </span>
            <span>{space._count.folders} folder{space._count.folders === 1 ? "" : "s"}</span>
            <span>{space._count.boards} board{space._count.boards === 1 ? "" : "s"}</span>
          </div>
        </div>
        <SpaceActions spaceId={space.id} />
      </header>

      {!hasContent ? (
        <div className="border border-border rounded-xl px-8 py-16 text-center">
          <ListTree className="w-8 h-8 mx-auto text-muted mb-3" />
          <div className="text-base font-medium mb-1">This Space is empty</div>
          <p className="text-sm text-muted max-w-[420px] mx-auto">
            Add a Folder to group related work, or create your first Board to start tracking items.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {space.folders.length > 0 ? (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Folders</h2>
              <ul className="space-y-3">
                {space.folders.map((f) => (
                  <li key={f.id} className="border border-border rounded-lg bg-surface">
                    <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
                      <FolderIcon className="w-4 h-4 text-muted" />
                      <span className="text-sm font-medium flex-1">{f.name}</span>
                      <span className="text-xs text-muted">
                        {f._count.boards} board{f._count.boards === 1 ? "" : "s"}
                      </span>
                    </div>
                    {f.boards.length > 0 ? (
                      <ul className="px-2 py-2">
                        {f.boards.map((b) => (
                          <li key={b.id}>
                            <Link
                              href={`/boards/${b.slug}`}
                              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-2"
                            >
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold bg-surface-2 uppercase">
                                {(b.icon ?? b.name.charAt(0))}
                              </span>
                              <span className="text-sm flex-1">{b.name}</span>
                              <span className="text-[11px] text-muted uppercase tracking-wide">
                                {b.views[0]?.type ?? "TABLE"}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="px-4 py-3 text-xs text-muted">No boards yet</div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {space.boards.length > 0 ? (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Boards</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {space.boards.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/boards/${b.slug}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-surface hover:bg-surface-2"
                    >
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-semibold bg-surface-2 uppercase">
                        {(b.icon ?? b.name.charAt(0))}
                      </span>
                      <span className="text-sm flex-1">{b.name}</span>
                      <span className="text-[11px] text-muted uppercase tracking-wide">
                        {b.views[0]?.type ?? "TABLE"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
