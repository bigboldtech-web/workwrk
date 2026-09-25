"use client";

// Client wrapper for the board's view-tab strip. The per-view lucide icons are
// functions, which a Server Component cannot hand across the boundary into the
// client ViewTab ("Functions cannot be passed directly to Client Components").
// Keeping the icon map + tab rendering here (client -> client) fixes that crash.

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
  Activity as ActivityIcon, Grid3X3, ListTree, SquareStack, Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { NewViewTrigger } from "@/components/board-view/view-create-popover";
import { ViewTabContextMenu, ViewTabMoreTrigger, viewMenuHasRows } from "@/components/board-view/view-tab-menu";
import { viewMenuRows } from "@/lib/work/view-visibility";
import { useOsToast } from "@/components/layout/os/toast";
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
  KANBAN: "#0073EA",
  CALENDAR: "#F59E0B",
  GANTT: "#EF4444",
  TIMELINE: "#3B82F6",
  CHART: "#F43F5E",
  DOC: "#3B82F6",
  FORM: "#7F5347",
  DASHBOARD: "#EC4899",
  MAP: "#EA580C",
  WORKLOAD: "#14B8A6",
  WHITEBOARD: "#EAB308",
  FILE_GALLERY: "#71717A",
  CARDS: "#0891B2",
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
  /** Phase 5b: a private view is scheduled only to its owner. */
  isShared?: boolean;
  ownerId?: string | null;
}

export function BoardViewTabs({
  views,
  boardId,
  boardSlug,
  boardName,
  activeViewId,
  defaultViewId,
  basePath,
  canManage = true,
  canManageList,
  viewerId = null,
  scheduleReports = false,
}: {
  views: BoardViewItem[];
  boardId: string;
  boardSlug: string;
  /** The List's name, for the Schedule report dialog's subtitle. */
  boardName?: string;
  activeViewId: string | null;
  defaultViewId: string | null;
  /** URL the tabs link to (default `/boards/<slug>`). The Personal list passes
   *  `/my-work/personal` so its tabs stay on that route. */
  basePath?: string;
  /**
   * Full access on the List. Below it a person may still SWITCH views, which
   * is reading, but not create or reorder them: "+ View" and the drag both
   * write, and both answered 403 while still being rendered.
   */
  canManage?: boolean;
  /**
   * Full access on the List (Delete a shared view). Absent: follows canManage,
   * which is what the Personal List's owner has.
   */
  canManageList?: boolean;
  /** Who is looking, so a view they own offers its Rename and Delete. */
  viewerId?: string | null;
  /**
   * The viewer may schedule email reports of this List's views (the List
   * page's strict read, and a member). The Personal List never passes it.
   */
  scheduleReports?: boolean;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  // Local order so a drag reorders instantly; re-syncs when the server view set
  // changes (add / delete / refresh).
  const [order, setOrder] = useState<BoardViewItem[]>(views);
  const viewsKey = views.map((v) => v.id).join("|");
  const [syncedKey, setSyncedKey] = useState(viewsKey);
  if (syncedKey !== viewsKey) { setSyncedKey(viewsKey); setOrder(views); }
  const [dragId, setDragId] = useState<string | null>(null);
  const movedRef = useRef(false);

  // Live reorder: as you drag over a tab, the dragged tab jumps into that slot
  // (the others shift) — no drop-line indicator.
  function liveReorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    movedRef.current = true;
    setOrder((cur) => {
      const fi = cur.findIndex((v) => v.id === dragId);
      const ti = cur.findIndex((v) => v.id === targetId);
      if (fi < 0 || ti < 0 || fi === ti) return cur;
      const arr = [...cur];
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
  }

  // ONE REQUEST, AND IT SAYS WHEN IT FAILS. This fired one PATCH per view
  // inside a `Promise.all` whose every rejection was swallowed, so a drag on a
  // List the person could not manage (and every drag on the space-less Personal
  // List, where the per-view route answered 404) snapped back in silence.
  // `PATCH /api/boards/[id]/views/order` writes the whole order in one
  // transaction or none of it.
  function endDrag() {
    setDragId(null);
    if (!movedRef.current) return;
    movedRef.current = false;
    const attempted = order.map((v) => v.id);
    void (async () => {
      try {
        const res = await fetch(`/api/boards/${boardId}/views/order`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: attempted }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setOrder(views);
          toast(d?.error ?? "Couldn't save the view order");
          return;
        }
        router.refresh();
      } catch {
        setOrder(views);
        toast("Couldn't save the view order");
      }
    })();
  }

  return (
    <ViewTabStrip className="px-4">
      {order.map((v) => {
        // Monday-style Table (TABLE + config.grid) and the Team variant
        // (WORKLOAD + config.variant) get their own icon + tile color.
        const config = v.config as { grid?: string; variant?: string } | null;
        const isMondayTable = v.type === "TABLE" && config?.grid === "monday";
        const isTeam = v.type === "WORKLOAD" && config?.variant === "team";
        const VIcon = isMondayTable ? Table2 : isTeam ? UsersIcon : (VIEW_ICONS[v.type] ?? ListIcon);
        const tileColor = isMondayTable ? "#16A34A" : isTeam ? "#00C875" : (VIEW_HEX[v.type] ?? "#6B7280");
        const active = v.id === activeViewId;
        const isDefault = v.id === defaultViewId;
        const base = basePath ?? `/boards/${boardSlug}`;
        const href = isDefault ? base : `${base}?view=${v.id}`;
        // Only the rows this viewer's writes would be accepted for; the "..."
        // is drawn only when there is at least one.
        const rows = viewMenuRows({ ownerId: v.ownerId ?? null, isDefault: v.isDefault }, order, {
          viewerId,
          canContribute: canManage,
          hasFullAccess: canManageList ?? canManage,
        });
        const hasMenu = viewMenuHasRows(v, rows, scheduleReports);
        return (
          <span
            key={v.id}
            draggable={canManage}
            onDragStart={(e) => { if (!canManage) return; e.dataTransfer.effectAllowed = "move"; setDragId(v.id); }}
            onDragOver={(e) => { if (!canManage) return; e.preventDefault(); liveReorder(v.id); }}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={endDrag}
            className={`inline-flex items-stretch transition-[opacity] ${canManage ? "cursor-grab active:cursor-grabbing" : ""} ${dragId === v.id ? "opacity-40" : ""}`}
          >
            <ViewTabContextMenu boardId={boardId} boardName={boardName} view={v} scheduleReports={scheduleReports} rows={rows}>
              {(openMenu) => (
                <ViewTab
                  icon={VIcon}
                  iconTileColor={tileColor}
                  label={v.name}
                  active={active}
                  href={href}
                  // The active tab's own "...", on hover and focus: the same
                  // menu a right-click opens, for a pointer or a keyboard
                  // that cannot right-click.
                  trailing={active && hasMenu ? <ViewTabMoreTrigger onOpen={openMenu} label={`${v.name} options`} /> : undefined}
                />
              )}
            </ViewTabContextMenu>
          </span>
        );
      })}
      {canManage ? (
        <>
          <div className="w-px h-3.5 bg-line-strong mx-1 self-center" />
          <span className="inline-flex items-center self-center">
            <NewViewTrigger boardId={boardId} />
          </span>
        </>
      ) : null}
    </ViewTabStrip>
  );
}
