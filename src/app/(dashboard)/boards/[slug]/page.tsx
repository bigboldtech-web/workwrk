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
  Lock, Share2, Sparkles, Star,
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
  Filter, CheckCircle2, Users as UsersIcon, Search, Settings,
} from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { listBoardItems } from "@/lib/board-items";
import { canEditSpace } from "@/lib/space";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { NewViewTrigger } from "@/components/board-view/view-create-popover";
import { ViewTabMenu } from "@/components/board-view/view-tab-menu";
import { parseBoardSchema } from "@/lib/field-catalog";

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
};

export default async function BoardPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const board = await prisma.board.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      space: { select: { id: true, slug: true, name: true, visibility: true } },
      folder: { select: { id: true, name: true } },
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

  const [items, canEdit] = await Promise.all([
    listBoardItems(board.id),
    canEditSpace(board.space.id, u.id, u.accessLevel),
  ]);
  const initialFields = parseBoardSchema(board.schema).fields;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb + title row */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/spaces" className="hover:text-zinc-900">Spaces</Link>
          <span>/</span>
          <Link href={`/spaces/${board.space.slug}`} className="hover:text-zinc-900">{board.space.name}</Link>
          {board.folder ? (
            <>
              <span>/</span>
              <span>{board.folder.name}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-2 min-w-0">
            {board.visibility === "PRIVATE" ? (
              <Lock className="w-4 h-4 text-zinc-500" />
            ) : (
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            )}
            <span className="truncate">{board.name}</span>
          </h1>
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
      </div>

      {/* View tabs */}
      <div className="px-6 border-b border-zinc-200 flex items-center gap-1">
        {board.views.map((v) => {
          const VIcon = VIEW_ICONS[v.type] ?? ListIcon;
          const color = VIEW_COLORS[v.type] ?? "text-zinc-600";
          const active = v.id === defaultView?.id;
          return (
            <span
              key={v.id}
              className={`group/view inline-flex items-center gap-1 px-2 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-zinc-900 text-zinc-900 font-medium"
                  : "border-transparent text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <button type="button" className="inline-flex items-center gap-1.5">
                <VIcon className={`w-3.5 h-3.5 ${active ? "text-zinc-900" : color}`} />
                {v.name}
              </button>
              <span className="opacity-0 group-hover/view:opacity-100 transition-opacity">
                <ViewTabMenu boardId={board.id} view={v} />
              </span>
            </span>
          );
        })}
        <NewViewTrigger boardId={board.id} />
      </div>

      {/* Filter row */}
      <div className="px-6 py-2 border-b border-zinc-100 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-violet-100 text-violet-700 hover:bg-violet-200"
        >
          <span className="w-3 h-3 rounded-sm bg-violet-500" />
          Status
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Group">
          <UsersIcon className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Filter">
          <Filter className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Closed">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center -space-x-1.5">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 border-2 border-white" />
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 border-2 border-white" />
        </div>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Search">
          <Search className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Settings">
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Renderer */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <BoardCanvas
          boardId={board.id}
          viewType={defaultView?.type ?? "TABLE"}
          initialItems={items}
          initialFields={initialFields}
          canEdit={canEdit}
          currentUserId={u.id}
        />
      </div>
    </div>
  );
}
