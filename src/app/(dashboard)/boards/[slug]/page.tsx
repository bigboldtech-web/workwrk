// Board detail — Phase 3 stub. Renders the board header + view tab
// strip + a placeholder for each view. Phase 3b will wire the actual
// view renderers (List/Board/Calendar/Gantt/Table/Form) and Phase 3c
// adds the field shelf for studio-item boards.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  Layers, Lock, Share2, Sparkles, Bot, Zap, Plus,
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
} from "lucide-react";
import type { ViewType } from "@/generated/prisma";

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

  // Visibility check (Phase 6 will centralize).
  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  if (!isAdmin && board.visibility !== "ORG" && board.space.visibility !== "ORG") {
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: board.space.id, userId: u.id } },
      select: { id: true },
    });
    if (!member) notFound();
  }

  const defaultView = board.views.find((v) => v.isDefault) ?? board.views[0];

  return (
    <div className="px-8 py-5 max-w-[1400px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted mb-3">
        <Link href="/spaces" className="hover:text-foreground">Spaces</Link>
        <span>/</span>
        <Link href={`/spaces/${board.space.slug}`} className="hover:text-foreground">{board.space.name}</Link>
        {board.folder ? (
          <>
            <span>/</span>
            <span>{board.folder.name}</span>
          </>
        ) : null}
        <span>/</span>
        <span className="truncate">{board.name}</span>
      </div>

      {/* Header row — title left, action row right (Agents · Automate · Ask AI · Share) */}
      <div className="flex items-center justify-between gap-6 mb-3">
        <h1 className="text-xl font-semibold flex items-center gap-2 min-w-0">
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-4 h-4 text-muted" />
          ) : (
            <Layers className="w-4 h-4 text-muted" />
          )}
          <span className="truncate">{board.name}</span>
        </h1>
        <div className="flex items-center gap-1 text-sm">
          <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md hover:bg-surface-2 text-muted">
            <Bot className="w-3.5 h-3.5" /> Agents
          </button>
          <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md hover:bg-surface-2 text-muted">
            <Zap className="w-3.5 h-3.5" /> Automate
          </button>
          <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md hover:bg-surface-2 text-muted">
            <Sparkles className="w-3.5 h-3.5" /> Ask AI
          </button>
          <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md hover:bg-surface-2 text-muted">
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
        </div>
      </div>

      {/* View tab strip — pinned views + + View */}
      <div className="border-b border-border flex items-center gap-1 mb-4">
        {board.views.map((v) => {
          const VIcon = VIEW_ICONS[v.type] ?? ListIcon;
          const active = v.id === defaultView?.id;
          return (
            <button
              key={v.id}
              type="button"
              className={`inline-flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px ${
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <VIcon className="w-3.5 h-3.5" />
              {v.name}
            </button>
          );
        })}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5" /> View
        </button>
      </div>

      {/* Body — placeholder for Phase 3b renderer */}
      <div className="border border-border rounded-xl px-8 py-16 text-center bg-surface">
        <div className="text-base font-medium mb-1">
          {defaultView?.name ?? "View"} renderer coming next
        </div>
        <p className="text-sm text-muted max-w-[460px] mx-auto">
          The board is created and the default <span className="font-mono text-xs">{defaultView?.type ?? "TABLE"}</span> view is wired.
          Phase 3b adds the actual renderer: rows, columns, kanban swimlanes, and the 30-type field shelf.
        </p>
      </div>
    </div>
  );
}
