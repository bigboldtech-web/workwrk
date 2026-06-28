"use client";

// Client wrapper for the board's view-tab strip. The per-view lucide icons are
// functions, which a Server Component cannot hand across the boundary into the
// client ViewTab ("Functions cannot be passed directly to Client Components").
// Keeping the icon map + tab rendering here (client -> client) fixes that crash.

import {
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
  Activity as ActivityIcon, Grid3X3, ListTree, SquareStack,
  type LucideIcon,
} from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { NewViewTrigger } from "@/components/board-view/view-create-popover";
import { ViewTabMenu } from "@/components/board-view/view-tab-menu";
import type { ViewType } from "@/generated/prisma";

const VIEW_ICONS: Record<ViewType, LucideIcon> = {
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

export interface BoardViewItem {
  id: string;
  name: string;
  type: ViewType;
  isDefault: boolean;
  config: unknown;
}

export function BoardViewTabs({
  views,
  boardId,
  boardSlug,
  activeViewId,
  defaultViewId,
}: {
  views: BoardViewItem[];
  boardId: string;
  boardSlug: string;
  activeViewId: string | null;
  defaultViewId: string | null;
}) {
  return (
    <ViewTabStrip className="px-6">
      {views.map((v) => {
        // Monday-style Table views are TABLE type with config.grid; show
        // the Table icon to distinguish them from the List tab.
        const isMondayTable = v.type === "TABLE" && (v.config as { grid?: string } | null)?.grid === "monday";
        const VIcon = isMondayTable ? Table2 : (VIEW_ICONS[v.type] ?? ListIcon);
        const color = isMondayTable ? "text-emerald-500" : (VIEW_COLORS[v.type] ?? "text-zinc-600");
        const active = v.id === activeViewId;
        const isDefault = v.id === defaultViewId;
        const href = isDefault ? `/boards/${boardSlug}` : `/boards/${boardSlug}?view=${v.id}`;
        return (
          <ViewTab
            key={v.id}
            icon={VIcon}
            iconClassName={color}
            label={v.name}
            active={active}
            href={href}
            trailing={
              <span
                className="opacity-0 group-hover/view:opacity-100 transition-opacity"
                onClick={(e) => {
                  // Tab body is a single <Link>; keep menu clicks from navigating.
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <ViewTabMenu boardId={boardId} view={v} />
              </span>
            }
          />
        );
      })}
      <NewViewTrigger boardId={boardId} />
    </ViewTabStrip>
  );
}
