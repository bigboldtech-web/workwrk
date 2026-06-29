"use client";

// Client wrapper for the board's view-tab strip. The per-view lucide icons are
// functions, which a Server Component cannot hand across the boundary into the
// client ViewTab ("Functions cannot be passed directly to Client Components").
// Keeping the icon map + tab rendering here (client -> client) fixes that crash.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
  Activity as ActivityIcon, Grid3X3, ListTree, SquareStack, Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { NewViewTrigger } from "@/components/board-view/view-create-popover";
import { ViewTabContextMenu } from "@/components/board-view/view-tab-menu";
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

// Hex tile colors — the icon renders as a small filled rounded-square (ClickUp
// tab style). List (TABLE non-monday) is neutral gray; the Monday Table is green.
const VIEW_HEX: Record<ViewType, string> = {
  TABLE: "#6B7280",
  KANBAN: "#4F6BED",
  CALENDAR: "#F59E0B",
  GANTT: "#EF4444",
  TIMELINE: "#3B82F6",
  CHART: "#F43F5E",
  DOC: "#3B82F6",
  FORM: "#8B5CF6",
  DASHBOARD: "#EC4899",
  MAP: "#EA580C",
  WORKLOAD: "#14B8A6",
  WHITEBOARD: "#EAB308",
  FILE_GALLERY: "#71717A",
  CARDS: "#6366F1",
  PIVOT: "#059669",
  HIERARCHY: "#0D9488",
  ACTIVITY: "#0EA5E9",
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
  const router = useRouter();
  // Local order so a drag reorders instantly; re-syncs when the server view set
  // changes (add / delete / refresh).
  const [order, setOrder] = useState<BoardViewItem[]>(views);
  const viewsKey = views.map((v) => v.id).join("|");
  const [syncedKey, setSyncedKey] = useState(viewsKey);
  if (syncedKey !== viewsKey) { setSyncedKey(viewsKey); setOrder(views); }
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function handleDrop(targetId: string) {
    const from = dragId;
    setDragId(null);
    setOverId(null);
    if (!from || from === targetId) return;
    const arr = [...order];
    const fi = arr.findIndex((v) => v.id === from);
    const ti = arr.findIndex((v) => v.id === targetId);
    if (fi < 0 || ti < 0) return;
    const [moved] = arr.splice(fi, 1);
    arr.splice(ti, 0, moved);
    setOrder(arr);
    // Persist the new tab order (displayOrder 0..n), then re-sync from server.
    void Promise.all(arr.map((v, i) =>
      fetch(`/api/boards/${boardId}/views/${v.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayOrder: i }),
      }).catch(() => {}),
    )).then(() => router.refresh());
  }

  return (
    <ViewTabStrip className="px-6">
      {order.map((v) => {
        // Monday-style Table (TABLE + config.grid) and the Team variant
        // (WORKLOAD + config.variant) get their own icon + tile color.
        const config = v.config as { grid?: string; variant?: string } | null;
        const isMondayTable = v.type === "TABLE" && config?.grid === "monday";
        const isTeam = v.type === "WORKLOAD" && config?.variant === "team";
        const VIcon = isMondayTable ? Table2 : isTeam ? UsersIcon : (VIEW_ICONS[v.type] ?? ListIcon);
        const tileColor = isMondayTable ? "#16A34A" : isTeam ? "#A855F7" : (VIEW_HEX[v.type] ?? "#6B7280");
        const active = v.id === activeViewId;
        const isDefault = v.id === defaultViewId;
        const href = isDefault ? `/boards/${boardSlug}` : `/boards/${boardSlug}?view=${v.id}`;
        return (
          <span
            key={v.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(v.id); }}
            onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== v.id) setOverId(v.id); }}
            onDragLeave={() => setOverId((o) => (o === v.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); handleDrop(v.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={`inline-flex cursor-grab active:cursor-grabbing ${dragId === v.id ? "opacity-40" : ""} ${overId === v.id ? "shadow-[inset_2px_0_0_var(--os-brand)]" : ""}`}
          >
            <ViewTabContextMenu boardId={boardId} view={v}>
              <ViewTab
                icon={VIcon}
                iconTileColor={tileColor}
                label={v.name}
                active={active}
                href={href}
              />
            </ViewTabContextMenu>
          </span>
        );
      })}
      <div className="w-px h-3.5 bg-zinc-300 mx-1 self-center" />
      <span className="inline-flex items-center self-center">
        <NewViewTrigger boardId={boardId} />
      </span>
    </ViewTabStrip>
  );
}
