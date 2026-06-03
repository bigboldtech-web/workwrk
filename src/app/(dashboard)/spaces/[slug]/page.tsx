// Space detail — ClickUp-style chrome (rebuilt 2026-06-03 design pivot).
//
// White background, breadcrumb, title row with Ask AI + Share,
// then folder/board content. The "+ New Folder" and "+ New Board"
// buttons live in SpaceActions (client island) on the right side.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Folder as FolderIcon, Lock, Star, ListTree,
  Sparkles, Share2,
} from "lucide-react";
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
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb + title row */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/spaces" className="hover:text-zinc-900">Spaces</Link>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-2 min-w-0">
            {space.visibility === "PRIVATE" ? (
              <Lock className="w-4 h-4 text-zinc-500" />
            ) : (
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            )}
            <span className="truncate">{space.name}</span>
          </h1>
          <span className="text-xs text-zinc-500">
            {space._count.members} member{space._count.members === 1 ? "" : "s"} ·{" "}
            {space._count.folders} folder{space._count.folders === 1 ? "" : "s"} ·{" "}
            {space._count.boards} board{space._count.boards === 1 ? "" : "s"}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            Ask AI
          </button>
          <button
            type="button"
            className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
          >
            <Share2 className="w-3.5 h-3.5" />
            Share
          </button>
        </div>
        {space.description ? (
          <p className="text-sm text-zinc-600 mt-2 max-w-[640px]">{space.description}</p>
        ) : null}
      </div>

      {/* Action row */}
      <div className="px-6 pb-3 border-b border-zinc-100 flex items-center gap-2">
        <SpaceActions spaceId={space.id} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ListTree className="w-8 h-8 text-zinc-400 mb-3" />
            <div className="text-sm font-medium text-zinc-900 mb-1">This Space is empty</div>
            <p className="text-xs text-zinc-500 max-w-[360px]">
              Add a Folder to group related work, or create your first Board to start tracking items.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {space.folders.length > 0 ? (
              <section>
                <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Folders</h2>
                <ul className="space-y-3">
                  {space.folders.map((f) => (
                    <li key={f.id} className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
                      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-zinc-100">
                        <FolderIcon className="w-4 h-4 text-zinc-500" />
                        <span className="text-sm font-medium text-zinc-900 flex-1">{f.name}</span>
                        <span className="text-xs text-zinc-500">
                          {f._count.boards} board{f._count.boards === 1 ? "" : "s"}
                        </span>
                      </div>
                      {f.boards.length > 0 ? (
                        <ul className="px-2 py-2">
                          {f.boards.map((b) => (
                            <li key={b.id}>
                              <Link
                                href={`/boards/${b.slug}`}
                                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-50"
                              >
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold bg-zinc-100 uppercase">
                                  {b.icon ?? b.name.charAt(0)}
                                </span>
                                <span className="text-sm text-zinc-900 flex-1">{b.name}</span>
                                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                                  {b.views[0]?.type ?? "TABLE"}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="px-4 py-3 text-xs text-zinc-500">No boards yet</div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {space.boards.length > 0 ? (
              <section>
                <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Boards</h2>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {space.boards.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/boards/${b.slug}`}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                      >
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-semibold bg-zinc-100 uppercase">
                          {b.icon ?? b.name.charAt(0)}
                        </span>
                        <span className="text-sm text-zinc-900 flex-1">{b.name}</span>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
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
    </div>
  );
}
