// Board detail — ClickUp-style chrome (rebuilt 2026-06-03 design pivot).
//
// White background, clean breadcrumb, title row with Ask AI + Share,
// view tabs with colorful icons, filter row, then the BoardCanvas
// (which now also matches the new aesthetic).

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  Lock, Share2, Sparkles, ChevronRight,
  ListFilter, Glasses, Zap, Folder as FolderIcon,
} from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { BoardViewTabs } from "./board-view-tabs";
import { getBoardStatuses, listBoardItems } from "@/lib/board-items";
import { canEditSpace } from "@/lib/space";
import { BoardAddTaskButton } from "@/components/board-view/board-add-task-button";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { BoardFavoriteButton } from "@/components/board-view/board-favorite-button";
import { parseBoardSchema } from "@/lib/field-catalog";
import { getEffectivePreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function BoardPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; item?: string }>;
}) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const board = await prisma.board.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      space: { select: { id: true, slug: true, name: true, visibility: true, icon: true, color: true } },
      folder: { select: { id: true, name: true, icon: true, color: true } },
      views: { orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }, { name: "asc" }] },
    },
  });
  if (!board || !board.space) notFound();

  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  if (!isAdmin && board.visibility !== "ORG" && board.space.visibility !== "ORG") {
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: board.space.id, userId: u.id } },
      select: { id: true },
    });
    if (!member) notFound();
  }

  const defaultView = board.views.find((v) => v.isDefault) ?? board.views[0];
  // Active view = ?view=<id> if it matches an existing view; else default.
  // Tab click is a Link that updates this param.
  const activeView =
    (sp.view ? board.views.find((v) => v.id === sp.view) : null) ?? defaultView;

  const [items, canEdit, prefs] = await Promise.all([
    listBoardItems(board.id),
    canEditSpace(board.space.id, u.id, u.accessLevel),
    getEffectivePreferences(u.id, u.organizationId),
  ]);
  const initiallyStarred = Array.isArray(prefs?.home?.favoriteBoardIds)
    ? prefs.home.favoriteBoardIds.includes(board.id)
    : false;
  const initialFields = parseBoardSchema(board.schema).fields;
  // Per-List statuses (backbone #1) — the board's own set, or the
  // canonical default trio when Board.statuses is null.
  const statuses = getBoardStatuses(board);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Title row — inline breadcrumb with Space tile + Folder + Board */}
      <div className="px-6 pt-2.5 pb-1.5 flex items-center gap-1">
        {/* Space tile + name */}
        <Link
          href={`/spaces/${board.space.slug}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-700 hover:text-zinc-900 min-w-0"
        >
          <EntityTile
            size="sm"
            icon={board.space.icon}
            color={board.space.color}
            name={board.space.name}
          />
          <span className="truncate">{board.space.name}</span>
        </Link>

        {/* Folder breadcrumb segment (when board lives in a folder) */}
        {board.folder ? (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-700 min-w-0">
              <EntityTile
                size="sm"
                icon={board.folder.icon}
                color={board.folder.color}
                name={board.folder.name}
                fallbackIcon={FolderIcon}
              />
              <span className="truncate">{board.folder.name}</span>
            </span>
          </>
        ) : null}

        {/* Board (current) — bold + star + filter */}
        <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
        <h1 className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-zinc-900 min-w-0">
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <EntityTile size="sm" icon={board.icon} color={board.color} name={board.name} />
          )}
          <span className="truncate">{board.name}</span>
        </h1>
        <BoardFavoriteButton boardId={board.id} initiallyStarred={initiallyStarred} />
        <button
          type="button"
          aria-label="Filter board"
          title="Filter"
          className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
        >
          <ListFilter className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1" />

        <button
          type="button"
          aria-label="Reader mode"
          title="Reader mode"
          className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500"
        >
          <Glasses className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="text-[12.5px] text-zinc-700 hover:text-zinc-900 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-zinc-100"
          title="Automations"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          Automate
        </button>
        <button
          type="button"
          className="text-[12.5px] text-zinc-700 hover:text-zinc-900 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-zinc-100"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          Ask
        </button>
        <button
          type="button"
          className="text-[12.5px] text-zinc-700 hover:text-zinc-900 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-zinc-100"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share
        </button>
      </div>

      {/* View tabs — clicking switches the active view via ?view=<id>.
          Phase 65: tabs were previously inert (always rendered default). */}
      <BoardViewTabs
        views={board.views}
        boardId={board.id}
        boardSlug={board.slug}
        activeViewId={activeView?.id ?? null}
        defaultViewId={defaultView?.id ?? null}
      />

      {/* Renderer — its single toolbar row (filters + Statuses/Fields + the
          "+ Task" passed below) is the one concise ClickUp-style toolbar. */}
      <div className="flex-1 overflow-y-auto px-6 pt-2.5 pb-4">
        <BoardCanvas
          boardId={board.id}
          viewId={activeView?.id ?? null}
          viewType={activeView?.type ?? "TABLE"}
          viewConfig={(activeView?.config as Record<string, unknown> | null) ?? {}}
          initialItems={items}
          initialFields={initialFields}
          statuses={statuses}
          canEdit={canEdit}
          currentUserId={u.id}
          addTaskSlot={
            <BoardAddTaskButton
              boardId={board.id}
              boardSlug={board.slug}
              boardName={board.name}
              spaceId={board.space.id}
            />
          }
        />
      </div>
    </div>
  );
}
