"use client";

// Item right-click host, for the renderers that draw items as chips, bars,
// cards or tree rows (Calendar, Gantt, Timeline, Hierarchy, Cards) instead of
// table rows. Table + Kanban mount one ItemMoreMenu per row; these views
// mount ONE triggerless ItemMoreMenu and re-target it to whichever item was
// right-clicked (MorePortal point mode, the same contract the sidebar tree
// rows use), so every surface opens the exact same menu.
//
// Usage in a renderer:
//   const menu = useItemContextMenu();
//   ...on each item element: onContextMenu={(e) => menu.openItemMenu(e, item)}
//   ...once, at the root:    <ItemContextMenuHost menu={menu} ... />

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { ItemMoreMenu, type ItemMenuListContext } from "./item-more-menu";
import { accessMessage } from "@/lib/access-message";
import { emitItemChanged } from "@/lib/realtime-events";
import { linkedMenuFlags, linkedRowKind, writeContext } from "@/lib/list-link-rows";

/**
 * True inside a Personal List's canvas. The five renderers that mount this
 * host read it here instead of each threading a prop: a private task's menu
 * never offers Add to another List (or Share), exactly as the Table, the
 * Board and the drawer already hide them.
 */
export const PersonalListSurface = createContext(false);

export interface ItemContextMenu {
  menuRef: React.RefObject<ContextMenuHandle | null>;
  target: BoardItemRow | null;
  openItemMenu: (e: React.MouseEvent, item: BoardItemRow) => void;
}

export function useItemContextMenu(): ItemContextMenu {
  const menuRef = useRef<ContextMenuHandle>(null);
  const [target, setTarget] = useState<BoardItemRow | null>(null);
  const openItemMenu = useCallback((e: React.MouseEvent, item: BoardItemRow) => {
    // Let inputs / editable cells keep their native menu, same guard as the
    // table rows (board-table-view).
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    e.preventDefault();
    e.stopPropagation();
    setTarget(item);
    // The host stays mounted, so the handle exists before the state lands.
    menuRef.current?.openAtPoint(e.clientX, e.clientY);
  }, []);
  return { menuRef, target, openItemMenu };
}

/** The stored watcher list, so Watch reads "Unwatch" when it should. */
function watcherIdsOf(item: BoardItemRow | null): string[] {
  const md = (item?.metadata as Record<string, unknown> | undefined) ?? {};
  return Array.isArray(md.watchers) ? (md.watchers as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

export function ItemContextMenuHost({
  menu,
  boardId,
  canEdit,
  rowCanEdit,
  relationOnly,
  rowCanDelete,
  rowPersonal,
  statuses = [],
  timeTrackingEnabled = true,
  onOpenItem,
  onItemCreated,
  onItemRemoved,
}: {
  menu: ItemContextMenu;
  /**
   * The List these rows are drawn in. Absent on a chart of many Lists (My
   * work, Everything), where every row is read as its home's.
   */
  boardId?: string | null;
  canEdit: boolean;
  /** Per row, when the host knows better than one flag (My work, Everything, the Gantt's own set). */
  rowCanEdit?: (row: BoardItemRow) => boolean;
  /**
   * Rows open only because the viewer is assigned to them or made them,
   * below Can edit on the List: the menu offers no List writes (Duplicate,
   * Move, Add to another List, Share, Public link), which the List refuses.
   */
  relationOnly?: (row: BoardItemRow) => boolean;
  /**
   * Rows the viewer holds at Full access (Full on the List, or a task they
   * made where rule 5 applies): their menu offers Delete as the server allows.
   */
  rowCanDelete?: (row: BoardItemRow) => boolean;
  /** Personal List rows on a chart of many Lists: nothing to share, no public link. */
  rowPersonal?: (row: BoardItemRow) => boolean;
  /** The List's own statuses, so "Mark complete" sets one it actually has. */
  statuses?: StatusOption[];
  /** Time Tracking module gate, hides "Start timer" when false. */
  timeTrackingEnabled?: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Receives the server's enriched row after Duplicate succeeds. */
  onItemCreated?: (item: BoardItemRow) => void;
  /** Local removal after Archive / Delete succeeds. */
  onItemRemoved?: (id: string) => void;
}) {
  const { menuRef, target } = menu;
  const personalList = useContext(PersonalListSurface);
  const { toast } = useOsToast();
  const { data: session } = useSession();
  // Read here rather than threaded through five renderers that have no other
  // use for it. Without it "Assign to me" and "Watch" render on every calendar
  // chip, gantt bar, timeline row, hierarchy row and card and do nothing,
  // because ItemMoreMenu guards both handlers on `currentUserId`.
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  // The five surfaces that mount this menu have no row state of their own to
  // patch, so the write goes to the server and the result is announced with
  // the one window event every host list listens for. Before this the prop was
  // `onPatch={() => {}}` and five canon rows (Mark complete / Reopen, Assign
  // to me, Task type, Watch / Unwatch, Move to list…) were dead on all five.
  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const id = target?.id;
      if (!id) return;
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          // A task shown here through a link names this List on its write.
          body: JSON.stringify({ ...body, ...writeContext(target, boardId ?? "") }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          toast(accessMessage(d, "Couldn't update this task."));
          return;
        }
        // A move takes the row off this List; everything else just changed it.
        if (body.boardId) onItemRemoved?.(id);
        emitItemChanged(id, (body.boardId as string | undefined) ?? boardId ?? null, Boolean(body.boardId));
      } catch {
        toast("Couldn't update this task.");
      }
    },
    [target, boardId, onItemRemoved, toast],
  );



  // A task shown here THROUGH A LINK: its menu is the link's (Remove from
  // this List, the link Move, Delete everywhere) and its role the task's.
  const kind = target && boardId ? linkedRowKind(target, boardId) : "home";
  const flags = target && boardId ? linkedMenuFlags(target, boardId, canEdit, currentUserId, { personalList }) : null;
  const listContext: ItemMenuListContext | undefined = target && boardId && flags
    ? kind === "home"
      ? { boardId, kind: "home", canAddToList: flags.canAddToList, canShareHome: flags.canShareHome }
      : {
          boardId,
          kind: "linked",
          homeBoardId: target.listLink?.homeList?.id ?? null,
          homeStatuses: target.listLink?.homeStatuses,
          canRemoveFromList: flags.canRemoveFromList,
          canLinkMove: flags.canLinkMove,
          canAddToList: flags.canAddToList,
          linkedSubtask: flags.linkedSubtask,
          canShareHome: flags.canShareHome,
        }
    : undefined;
  const mayEdit = !!target && (rowCanEdit ? rowCanEdit(target) : canEdit);
  const role = kind !== "home" && flags?.role ? flags.role : mayEdit ? (rowCanDelete?.(target!) ? "FULL" : "EDIT") : "VIEW";
  const personalHere = personalList || (!!target && !!rowPersonal?.(target));

  return (
    <ItemMoreMenu
      ref={menuRef}
      // The "…" trigger is never shown on these surfaces, the menu opens
      // only at the right-click point.
      triggerless
      host="row"
      role={role}
      item={{ id: target?.id ?? "", boardId: kind !== "home" ? target?.listLink?.homeList?.id ?? null : boardId ?? target?.boardId ?? null, title: target?.title ?? "", status: target?.status ?? null, assigneeIds: target?.assigneeIds, itemTypeId: target?.itemTypeId ?? null, parentItemId: target?.parentItemId ?? null }}
      isCreator={kind !== "home" ? flags?.isCreator : undefined}
      assigneeOnly={!!target && kind === "home" && !!relationOnly?.(target)}
      listContext={listContext}
      onRemovedFromList={onItemRemoved && target ? () => onItemRemoved(target.id) : undefined}
      currentUserId={currentUserId}
      personalList={personalHere}
      statuses={statuses}
      watcherIds={watcherIdsOf(target)}
      timeTrackingOn={timeTrackingEnabled ?? true}
      onPatch={(body) => void patch(body)}
      onOpen={onOpenItem && target ? () => onOpenItem(target.id) : undefined}
      // The menu has already asked and written each of these (item-more-menu.tsx):
      // the host only shows the result. Writing them again here made every
      // Duplicate two copies and every Archive two dialogs.
      // A copy of a task shown here through a link lives in that task's HOME
      // List, not here: it is left to the List's own poll rather than drawn
      // as if it lived here. Everything else shows the copy at once.
      onDuplicated={onItemCreated && target ? (_id, copy) => { if (copy && kind === "home") onItemCreated(copy as BoardItemRow); } : undefined}
      onArchived={onItemRemoved && target ? () => onItemRemoved(target.id) : undefined}
      onDeleted={onItemRemoved && target ? () => onItemRemoved(target.id) : undefined}
    />
  );
}
