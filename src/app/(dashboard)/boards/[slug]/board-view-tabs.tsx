"use client";

// Client wrapper for the board's view-tab strip. The per-view lucide icons are
// functions, which a Server Component cannot hand across the boundary into the
// client ViewTab ("Functions cannot be passed directly to Client Components").
// Keeping the icon map + tab rendering here (client -> client) fixes that crash.
//
// THE FIRST TAB IS THE DEFAULT VIEW (decision 9). The page hands the views in
// the order listViewsForViewer() resolved (the default first), so the first
// tab and the view the bare URL opens are the same view for every viewer. The
// default tab is not draggable, a drop on it lands second (and says why), and
// a pinned default carries a small Pin glyph.

import { useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  List as ListIcon, LayoutGrid, Calendar as CalIcon, GanttChart, Table2,
  ClipboardList, FileText, BarChart3, AlignLeft, GaugeCircle, MapPin, Brush,
  Activity as ActivityIcon, Grid3X3, ListTree, SquareStack, Users as UsersIcon,
  Pin, type LucideIcon,
} from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { NewViewTrigger } from "@/components/board-view/view-create-popover";
import { ViewTabContextMenu, type ViewMenuGates } from "@/components/board-view/view-tab-menu";
import { useOsToast } from "@/components/layout/os/toast";
import { moveTabKeepingDefaultFirst, pinMenuRow, visibleToEveryone } from "@/lib/work/default-view";
import { canManageView, canSaveView } from "@/lib/work/view-visibility";
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

/**
 * The tab menu's Rename / Duplicate / Delete rows, each on the gate its route
 * checks, so a row is drawn only when it can succeed:
 *   Rename     PATCH { name }   canSaveView (contribute, or the view's owner)
 *   Duplicate  POST /views      canContributeBoard (the strip's canManage)
 *   Delete     DELETE           canManageView (full access, or the owner)
 * A view-only reader keeps all three on a private view of their own, and
 * gets none on anyone else's.
 */
export function viewTabGates(input: {
  view: BoardViewItem;
  currentUserId: string | null;
  canContribute: boolean;
  canDeleteShared: boolean;
}): Required<ViewMenuGates> {
  return {
    canRename: canSaveView(input.view, input.currentUserId, input.canContribute),
    canDuplicate: input.canContribute,
    // canManageView reads only the owner; displayOrder is there for its type.
    canDelete: canManageView({ ...input.view, displayOrder: 0 }, input.currentUserId, input.canDeleteShared),
  };
}

/**
 * The default tab's tooltip. The unpinned Board fallback used to tell every
 * viewer to "Pin another view to put it first", including a view-only reader
 * whose menu has no Pin row and whose pin the route refuses. That hint shows
 * only when this person really can pin some other tab (`canPinAny`).
 */
export function defaultTabTitle(input: {
  isDefault: boolean;
  manyTabs: boolean;
  defaultPinned: boolean;
  canPinAny: boolean;
}): string | undefined {
  if (!input.isDefault || !input.manyTabs) return undefined;
  if (input.defaultPinned) return "Pinned as the default view";
  return input.canPinAny ? "Default view. Pin another view to put it first." : "Default view";
}

export interface BoardViewItem {
  id: string;
  name: string;
  type: ViewType;
  isDefault: boolean;
  config: unknown;
  isShared: boolean;
  ownerId: string | null;
}

export function BoardViewTabs({
  views,
  boardId,
  boardSlug,
  activeViewId,
  defaultViewId,
  defaultPinned = false,
  pinnedByName = null,
  personalList = false,
  basePath,
  canManage = true,
  canDeleteShared,
  currentUserId = null,
}: {
  /** In the page's resolved order: the default view first. */
  views: BoardViewItem[];
  boardId: string;
  boardSlug: string;
  activeViewId: string | null;
  defaultViewId: string | null;
  /** The default is somebody's pin (listViewsForViewer's `pinned`), not the Board fallback. */
  defaultPinned?: boolean;
  /** Who pinned it, for the Unpin row's second line. */
  pinnedByName?: string | null;
  /** The Personal list: its owner is its only reader, so a private view can be pinned. */
  personalList?: boolean;
  /** URL the tabs link to (default `/boards/<slug>`). The Personal list passes
   *  `/my-work/personal` so its tabs stay on that route. */
  basePath?: string;
  /**
   * May this person write to the List's views: the page passes its CONTRIBUTE
   * answer. Below it a person may still SWITCH views, which is reading, but
   * not create or reorder them: "+ View" and the drag both write, and each
   * answered 403 while still being rendered. They may pin only a view they
   * own (see currentUserId).
   */
  canManage?: boolean;
  /**
   * May this person delete a view they do not own: the List's MANAGEMENT
   * answer (canEditBoard), which DELETE checks through canManageView.
   * Defaults to `canManage`: a person who cannot contribute cannot manage
   * either, so a reader is never offered Delete on someone else's view.
   */
  canDeleteShared?: boolean;
  /**
   * Who is looking, so the pin row follows the route's gate per view: a
   * view's owner may pin or unpin it even without contribute (canSaveView).
   */
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useOsToast();
  // Local order so a drag reorders instantly; re-syncs when the server view set
  // changes (add / delete / refresh / a new default). The key carries what a
  // tab shows as well as the order, so a rename or a Private toggle that keeps
  // the order is not left showing the old name.
  const [order, setOrder] = useState<BoardViewItem[]>(views);
  const viewsKey = views.map((v) => `${v.id}:${v.name}:${v.type}:${v.isShared}`).join("|");
  const [syncedKey, setSyncedKey] = useState(viewsKey);
  if (syncedKey !== viewsKey) { setSyncedKey(viewsKey); setOrder(views); }
  const [dragId, setDragId] = useState<string | null>(null);
  // The drag's own bookkeeping lives in refs written by the drag events, so
  // a dragover that fires before React has rendered the previous one still
  // moves from the latest order, and the drop saves exactly what is shown.
  const dragRef = useRef<string | null>(null);
  const workingRef = useRef<BoardViewItem[] | null>(null);
  const movedRef = useRef(false);
  const hitDefaultRef = useRef(false);
  const base = basePath ?? `/boards/${boardSlug}`;

  function startDrag(id: string) {
    dragRef.current = id;
    workingRef.current = order;
    hitDefaultRef.current = false;
    setDragId(id);
  }

  // Live reorder: as you drag over a tab, the dragged tab jumps into that slot
  // (the others shift), with no drop-line indicator. The default tab never
  // moves: a drag over it lands the dragged tab second, and the drop says why
  // (review #24). Only the LAST tab hovered counts for that: a drag that
  // crossed the default and went on to land third has nothing to explain.
  function liveReorder(targetId: string) {
    const dragging = dragRef.current;
    if (!dragging || dragging === targetId) return;
    const cur = workingRef.current ?? order;
    const ids = cur.map((v) => v.id);
    const moved = moveTabKeepingDefaultFirst(ids, dragging, targetId, defaultViewId);
    hitDefaultRef.current = moved.hitDefault;
    if (moved.ids.every((id, i) => id === ids[i])) return;
    movedRef.current = true;
    const byId = new Map(cur.map((v) => [v.id, v]));
    const next = moved.ids.map((id) => byId.get(id)!);
    workingRef.current = next;
    setOrder(next);
  }

  // After a pin or an unpin the bare URL opens a different view. A person on
  // the bare URL is moved onto the explicit URL of the view in front of them
  // first, so the page does not switch views under them; anyone already on
  // ?view= just re-reads the strip.
  function pinChanged() {
    if (!searchParams.get("view") && activeViewId) {
      router.replace(`${base}?view=${activeViewId}`, { scroll: false });
    } else {
      router.refresh();
    }
  }

  // ONE REQUEST, AND IT SAYS WHEN IT FAILS. This fired one PATCH per view
  // inside a `Promise.all` whose every rejection was swallowed, so a drag on a
  // List the person could not manage (and every drag on the space-less Personal
  // List, where the per-view route answered 404) snapped back in silence.
  // `PATCH /api/boards/[id]/views/order` writes the whole order in one
  // transaction or none of it.
  function endDrag() {
    setDragId(null);
    dragRef.current = null;
    const working = workingRef.current;
    workingRef.current = null;
    if (hitDefaultRef.current) {
      hitDefaultRef.current = false;
      toast("Pin a view as the default view to put it first.");
    }
    if (!movedRef.current) return;
    movedRef.current = false;
    const attempted = (working ?? order).map((v) => v.id);
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

  const manyTabs = order.length > 1;
  const deleteShared = canDeleteShared ?? canManage;
  // Pin rows use the same inputs below, so the hint and the menus agree.
  const pinRowFor = (v: BoardViewItem, isDefault: boolean) => pinMenuRow({
    isDefault,
    pinned: defaultPinned && isDefault,
    // Pinning is List-wide, so only Can edit on the List offers it (the
    // route's gate); a view owner without it keeps the view, not the pin.
    canPin: canManage,
    pinnable: personalList || visibleToEveryone(v),
    tabCount: order.length,
  });
  const canPinAny = order.some((v) => v.id !== defaultViewId && pinRowFor(v, false) === "pin");

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
        const href = isDefault ? base : `${base}?view=${v.id}`;
        const draggable = canManage && !isDefault;
        const showPin = isDefault && defaultPinned && manyTabs;
        const title = defaultTabTitle({ isDefault, manyTabs, defaultPinned, canPinAny });
        const pinRow = pinRowFor(v, isDefault);
        const gates = viewTabGates({ view: v, currentUserId, canContribute: canManage, canDeleteShared: deleteShared });
        return (
          <span
            key={v.id}
            draggable={draggable}
            onDragStart={(e) => { if (!draggable) return; e.dataTransfer.effectAllowed = "move"; startDrag(v.id); }}
            onDragOver={(e) => { if (!canManage) return; e.preventDefault(); liveReorder(v.id); }}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={endDrag}
            className={`inline-flex items-stretch transition-[opacity] ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${dragId === v.id ? "opacity-40" : ""}`}
          >
            <ViewTabContextMenu
              boardId={boardId}
              view={v}
              pinRow={pinRow}
              pinnedByName={pinnedByName}
              personalList={personalList}
              onPinChanged={pinChanged}
              gates={gates}
            >
              <ViewTab
                icon={VIcon}
                iconTileColor={tileColor}
                label={v.name}
                active={active}
                href={href}
                title={title}
                trailing={
                  showPin ? (
                    <>
                      <Pin className="h-3 w-3 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
                      <span className="sr-only">, pinned as the default view</span>
                    </>
                  ) : undefined
                }
              />
            </ViewTabContextMenu>
          </span>
        );
      })}
      {canManage ? (
        <>
          <div className="w-px h-3.5 bg-line-strong mx-1 self-center" />
          <span className="inline-flex items-center self-center">
            <NewViewTrigger boardId={boardId} personalList={personalList} />
          </span>
        </>
      ) : null}
    </ViewTabStrip>
  );
}
