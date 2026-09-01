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
  Lock, ChevronDown, ListChecks, Zap, IterationCw,
} from "lucide-react";
import { parseSprintMeta } from "@/lib/sprint";
import { EntityTile } from "@/components/ui/entity-tile";
import { BoardShareButton } from "@/components/layout/os/board-share-button";
import { AskSidekickButton } from "@/components/layout/os/ask-sidekick-button";
import { BoardViewTabs } from "./board-view-tabs";
import { getBoardStatuses, listBoardItems } from "@/lib/board-items";
import { ensureCoreListViews } from "@/lib/board";
import { canEditSpace } from "@/lib/space";
import { canRead, type ViewerContext } from "@/lib/access";
import { hasModule } from "@/lib/space-modules";
import { BoardAddTaskButton } from "@/components/board-view/board-add-task-button";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { parseBoardSchema } from "@/lib/field-catalog";

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
      space: { select: { id: true, slug: true, name: true, visibility: true, icon: true, color: true, settings: true } },
      folder: { select: { id: true, name: true, icon: true, color: true } },
      views: { orderBy: [{ displayOrder: "asc" }, { name: "asc" }] },
    },
  });
  if (!board || !board.space) notFound();

  // Self-heal: give every task List the full ClickUp view set (Board/Calendar/
  // Gantt) so switching views on the list always shows the same tasks. No-op
  // (no writes) once the views exist. Refetch the view set only if it grew.
  let views = board.views;
  const createdViews = await ensureCoreListViews(board.id, u.id);
  if (createdViews > 0) {
    views = await prisma.view.findMany({
      where: { boardId: board.id },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  }

  // Central gate: org admin / ORG-visible / SpaceMember read via the Space; a
  // folder-only grantee reads a board inside their granted folder via the
  // resolver's folder fallback; PRIVATE boards need an explicit grant.
  const viewer: ViewerContext = { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" };
  if (!(await canRead(viewer, { type: "board", id: board.id }))) notFound();

  const defaultView = views.find((v) => v.isDefault) ?? views[0];
  // Active view = ?view=<id> if it matches an existing view; else default.
  // Tab click is a Link that updates this param.
  const activeView =
    (sp.view ? views.find((v) => v.id === sp.view) : null) ?? defaultView;

  const [items, canEdit] = await Promise.all([
    listBoardItems(board.id),
    canEditSpace(board.space.id, u.id, u.accessLevel),
  ]);
  const initialFields = parseBoardSchema(board.schema).fields;
  // Per-List statuses (backbone #1) — the board's own set, or the
  // canonical default trio when Board.statuses is null.
  const statuses = getBoardStatuses(board);
  // Sprint identity (migration-free) — null for ordinary Lists.
  const sprint = parseSprintMeta(board.settings);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Title row — inline breadcrumb with Space tile + Folder + Board */}
      <div className="px-4 pt-1.5 pb-1 flex items-center gap-1">
        {/* Space tile + name */}
        <Link
          href={`/spaces/${board.space.slug}`}
          className="inline-flex items-center gap-1.5 text-[14px] text-zinc-700 hover:text-zinc-900 min-w-0 hover:bg-zinc-100 rounded px-1 -ml-1 py-0.5 transition-colors"
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
            <span className="text-zinc-300 text-[14px] px-0.5">/</span>
            <span className="inline-flex items-center gap-1.5 text-[14px] text-zinc-700 min-w-0 hover:bg-zinc-100 rounded px-1 py-0.5 transition-colors cursor-pointer">
              <EntityTile
                size="sm"
                icon={board.folder.icon}
                color={board.folder.color}
                name={board.folder.name}
                fallback="folder"
              />
              <span className="truncate">{board.folder.name}</span>
            </span>
          </>
        ) : null}

        {/* Board (current) — bold + star + filter */}
        <span className="text-zinc-300 text-[14px] px-0.5">/</span>
        <h1 className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900 min-w-0 group cursor-pointer hover:bg-zinc-100 rounded px-1 -ml-1 py-0.5 transition-colors">
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-4 h-4 text-zinc-500" />
          ) : sprint ? (
            <IterationCw className="w-4 h-4 text-zinc-700" />
          ) : (
            <ListChecks className="w-4 h-4 text-zinc-700" />
          )}
          <span className="truncate">{board.name}</span>
          <ChevronDown className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </h1>
        {/* The working board filter lives in the renderer's own toolbar (the
            FilterMenu BoardCanvas mounts below). The former title-row filter
            icon + Reader-mode toggle were inert with no backend, so they're
            gone rather than faked. */}

        <div className="flex-1" />

        <Link
          href="/automation/workflows"
          className="text-[13.5px] text-zinc-700 hover:text-zinc-900 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-zinc-100"
          title="Automations"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          Automate
        </Link>
        <AskSidekickButton
          prompt="Help me with this board."
          className="text-[13.5px] text-zinc-600 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-zinc-100 hover:text-zinc-900"
        />
        <BoardShareButton
          boardId={board.id}
          boardName={board.name}
          visibility={board.visibility as "PRIVATE" | "WORKSPACE" | "ORG"}
          parentSpaceName={board.space.name}
        />
      </div>

      {/* View tabs — clicking switches the active view via ?view=<id>.
          Phase 65: tabs were previously inert (always rendered default). */}
      <BoardViewTabs
        views={views}
        boardId={board.id}
        boardSlug={board.slug}
        activeViewId={activeView?.id ?? null}
        defaultViewId={defaultView?.id ?? null}
      />

      {/* Renderer — its single toolbar row (filters + Statuses/Fields + the
          "+ Task" passed below) is the one concise ClickUp-style toolbar. */}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
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
          sprint={sprint}
          addTaskSlot={
            // key: this server-created element lands inside BoardCanvas's
            // toolbar children array; RSC-deserialized elements skip jsx-time
            // key validation, so an explicit key keeps React's list check quiet.
            <BoardAddTaskButton
              key="add-task"
              boardId={board.id}
              boardSlug={board.slug}
              boardName={board.name}
              spaceId={board.space.id}
            />
          }
          moduleGating={{
            priority: hasModule(board.space.settings, "PRIORITY"),
            tags: hasModule(board.space.settings, "TAGS"),
            timeTracking: hasModule(board.space.settings, "TIME_TRACKING"),
            customFields: hasModule(board.space.settings, "CUSTOM_FIELDS"),
          }}
        />
      </div>
    </div>
  );
}
