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
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
  ListFilter, Glasses, Zap, Folder as FolderIcon,
  Activity as ActivityIcon, Grid3X3, ListTree, SquareStack,
} from "lucide-react";
import { createElement } from "react";
import { getSpaceIcon } from "@/components/layout/os/space-icon-catalog";
import type { ViewType } from "@/generated/prisma";
import { getBoardStatuses, listBoardItems } from "@/lib/board-items";
import { canEditSpace } from "@/lib/space";
import { BoardAddTaskButton } from "@/components/board-view/board-add-task-button";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { NewViewTrigger } from "@/components/board-view/view-create-popover";
import { ViewTabMenu } from "@/components/board-view/view-tab-menu";
import { BoardFavoriteButton } from "@/components/board-view/board-favorite-button";
import { parseBoardSchema } from "@/lib/field-catalog";
import { getEffectivePreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

const VIEW_ICONS: Record<ViewType, React.ComponentType<{ className?: string }>> = {
  TABLE: ListIcon,
  KANBAN: LayoutGrid,
  CALENDAR: CalIcon,
  GANTT: GanttChart,
  TIMELINE: AlignLeft,
  CHART: BarChart3,
  DOC: FileText,
  FORM: ClipboardList,
  DASHBOARD: BarChart3,
  MAP: MapPin,
  WORKLOAD: GaugeCircle,
  WHITEBOARD: Brush,
  FILE_GALLERY: Table2,
  CARDS: SquareStack,
  PIVOT: Grid3X3,
  HIERARCHY: ListTree,
  ACTIVITY: ActivityIcon,
};

const VIEW_COLORS: Record<ViewType, string> = {
  TABLE: "text-emerald-500",
  KANBAN: "text-violet-500",
  CALENDAR: "text-orange-500",
  GANTT: "text-amber-500",
  TIMELINE: "text-blue-500",
  CHART: "text-rose-500",
  DOC: "text-blue-500",
  FORM: "text-violet-500",
  DASHBOARD: "text-rose-500",
  MAP: "text-red-500",
  WORKLOAD: "text-cyan-500",
  WHITEBOARD: "text-cyan-500",
  FILE_GALLERY: "text-zinc-500",
  CARDS: "text-indigo-500",
  PIVOT: "text-emerald-600",
  HIERARCHY: "text-teal-600",
  ACTIVITY: "text-sky-500",
};

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
      <div className="px-6 pt-4 pb-2 flex items-center gap-1.5">
        {/* Space tile + name */}
        <Link
          href={`/spaces/${board.space.slug}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-zinc-700 hover:text-zinc-900 min-w-0"
        >
          <SpaceTile
            icon={board.space.icon}
            color={board.space.color}
            fallback={board.space.name[0] ?? "?"}
          />
          <span className="truncate">{board.space.name}</span>
        </Link>

        {/* Folder breadcrumb segment (when board lives in a folder) */}
        {board.folder ? (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <span className="inline-flex items-center gap-1.5 text-[13px] text-zinc-700 min-w-0">
              <FolderTile
                icon={board.folder.icon}
                color={board.folder.color}
              />
              <span className="truncate">{board.folder.name}</span>
            </span>
          </>
        ) : null}

        {/* Board (current) — bold + star + filter */}
        <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
        <h1 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 min-w-0">
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <BoardTile icon={board.icon} color={board.color} fallback={board.name[0] ?? "?"} />
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
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
          title="Automations"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          Automate
        </button>
        <button
          type="button"
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          Ask
        </button>
        <button
          type="button"
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share
        </button>
      </div>

      {/* View tabs — clicking switches the active view via ?view=<id>.
          Phase 65: tabs were previously inert (always rendered default). */}
      <div className="px-6 border-b border-zinc-200 flex items-center gap-1">
        {board.views.map((v) => {
          // Monday-style Table views are TABLE type with config.grid; show
          // the Table icon to distinguish them from the List tab.
          const isMondayTable = v.type === "TABLE" && (v.config as { grid?: string } | null)?.grid === "monday";
          const VIcon = isMondayTable ? Table2 : (VIEW_ICONS[v.type] ?? ListIcon);
          const color = isMondayTable ? "text-emerald-500" : (VIEW_COLORS[v.type] ?? "text-zinc-600");
          const active = v.id === activeView?.id;
          const isDefault = v.id === defaultView?.id;
          const href = isDefault
            ? `/boards/${board.slug}`
            : `/boards/${board.slug}?view=${v.id}`;
          return (
            <span
              key={v.id}
              className={`group/view inline-flex items-center gap-1 px-2 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-zinc-900 text-zinc-900 font-medium"
                  : "border-transparent text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <Link href={href} className="inline-flex items-center gap-1.5">
                <VIcon className={`w-3.5 h-3.5 ${active ? "text-zinc-900" : color}`} />
                {v.name}
              </Link>
              <span className="opacity-0 group-hover/view:opacity-100 transition-opacity">
                <ViewTabMenu boardId={board.id} view={v} />
              </span>
            </span>
          );
        })}
        <NewViewTrigger boardId={board.id} />
      </div>

      {/* Action row — the functional filter bar lives inside BoardCanvas
          (it owns the items it filters); this row keeps task creation. */}
      <div className="px-6 py-2 border-b border-zinc-100 flex items-center gap-2">
        <div className="flex-1" />
        <BoardAddTaskButton
          boardId={board.id}
          boardSlug={board.slug}
          boardName={board.name}
          spaceId={board.space.id}
        />
      </div>

      {/* Renderer */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
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
        />
      </div>
    </div>
  );
}

function SpaceTile({ icon, color, fallback }: { icon: string | null; color: string | null; fallback: string }) {
  const Icon = getSpaceIcon(icon);
  const bg = color ?? "#71717A";
  return (
    <span
      className="h-5 w-5 rounded flex items-center justify-center text-white text-[10px] font-semibold uppercase shrink-0"
      style={{ backgroundColor: bg }}
    >
      {Icon ? createElement(Icon, { className: "h-3 w-3" }) : fallback}
    </span>
  );
}

function FolderTile({ icon, color }: { icon: string | null; color: string | null }) {
  const Icon = getSpaceIcon(icon);
  const tint = color ?? "#71717A";
  if (Icon) {
    return (
      <span
        className="h-5 w-5 rounded flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
        style={{ backgroundColor: tint }}
      >
        {createElement(Icon, { className: "h-3 w-3" })}
      </span>
    );
  }
  return <FolderIcon className="h-3.5 w-3.5 shrink-0" style={{ color: tint }} />;
}

function BoardTile({ icon, color, fallback }: { icon: string | null; color: string | null; fallback: string }) {
  const Icon = getSpaceIcon(icon);
  const bg = color ?? "#A1A1AA";
  return (
    <span
      className="h-5 w-5 rounded flex items-center justify-center text-white text-[10px] font-semibold uppercase shrink-0"
      style={{ backgroundColor: bg }}
    >
      {Icon ? createElement(Icon, { className: "h-3 w-3" }) : fallback}
    </span>
  );
}
