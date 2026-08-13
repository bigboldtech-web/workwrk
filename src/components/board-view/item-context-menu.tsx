"use client";

// Item right-click host — for the renderers that draw items as chips, bars,
// cards or tree rows (Calendar, Gantt, Timeline, Hierarchy, Cards) instead of
// table rows. Table + Kanban mount one ItemRowMoreMenu per row; these views
// mount ONE hidden ItemRowMoreMenu and re-target it to whichever item was
// right-clicked (MorePortal point mode — the same contract the sidebar tree
// rows use), so every surface opens the exact same menu.
//
// Usage in a renderer:
//   const menu = useItemContextMenu();
//   ...on each item element: onContextMenu={(e) => menu.openItemMenu(e, item)}
//   ...once, at the root:    <ItemContextMenuHost menu={menu} ... />

import { useCallback, useRef, useState } from "react";
import type { BoardItemRow } from "@/lib/board-items-shared";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { ItemRowMoreMenu } from "./item-row-more-menu";

export interface ItemContextMenu {
  menuRef: React.RefObject<ContextMenuHandle | null>;
  target: BoardItemRow | null;
  openItemMenu: (e: React.MouseEvent, item: BoardItemRow) => void;
}

export function useItemContextMenu(): ItemContextMenu {
  const menuRef = useRef<ContextMenuHandle>(null);
  const [target, setTarget] = useState<BoardItemRow | null>(null);
  const openItemMenu = useCallback((e: React.MouseEvent, item: BoardItemRow) => {
    // Let inputs / editable cells keep their native menu — same guard as the
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

const toIso = (v: Date | string | null | undefined): string | undefined => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export function ItemContextMenuHost({
  menu,
  boardId,
  canEdit,
  timeTrackingEnabled = true,
  onOpenItem,
  onItemCreated,
  onItemRemoved,
}: {
  menu: ItemContextMenu;
  /** Enables Duplicate (the copy POSTs to this board). */
  boardId?: string | null;
  canEdit: boolean;
  /** Time Tracking module gate — hides "Start timer" when false. */
  timeTrackingEnabled?: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Receives the server's enriched row after Duplicate succeeds. */
  onItemCreated?: (item: BoardItemRow) => void;
  /** Local removal after Archive / Delete succeeds. */
  onItemRemoved?: (id: string) => void;
}) {
  const { menuRef, target } = menu;
  const confirm = useConfirm();
  const { toast } = useOsToast();

  // Same contract as the kanban card's duplicate, plus dates/priority so the
  // copy stays visible in the date-driven views that host this menu.
  const duplicate = useCallback(async (item: BoardItemRow) => {
    if (!boardId) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${item.title} (copy)`,
          status: item.status ?? undefined,
          ownerId: item.ownerId,
          metadata: item.metadata,
          startAt: toIso(item.startAt),
          dueAt: toIso(item.dueAt),
          priority: item.priority ?? undefined,
          itemTypeId: item.itemTypeId ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.item) onItemCreated?.(data.item as BoardItemRow);
      else toast(data?.error ?? "Couldn't duplicate");
    } catch { toast("Couldn't duplicate"); }
  }, [boardId, onItemCreated, toast]);

  // Soft archive (DELETE without ?hard) — remove locally only after the server
  // confirms, since these renderers have no refetch to fall back on.
  const archive = useCallback(async (item: BoardItemRow) => {
    const ok = await confirm({
      title: "Archive task",
      description: `Archive "${item.title}"? You can restore it later from Trash.`,
      destructive: true,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (res.ok) onItemRemoved?.(item.id);
      else { const d = await res.json().catch(() => ({})); toast(d?.error ?? "Couldn't archive"); }
    } catch { toast("Couldn't archive"); }
  }, [confirm, onItemRemoved, toast]);

  return (
    <ItemRowMoreMenu
      ref={menuRef}
      // The "…" trigger is never shown on these surfaces — the menu opens
      // only at the right-click point.
      className="hidden"
      item={{ id: target?.id ?? "", boardId, title: target?.title ?? "" }}
      canEdit={canEdit && !!target}
      onOpen={onOpenItem && target ? () => onOpenItem(target.id) : undefined}
      onDuplicate={boardId && onItemCreated && target ? () => void duplicate(target) : undefined}
      onArchive={onItemRemoved && target ? () => void archive(target) : undefined}
      onDeleted={onItemRemoved && target ? () => onItemRemoved(target.id) : undefined}
      itemTypeId={target?.itemTypeId ?? null}
      timeTrackingEnabled={timeTrackingEnabled}
    />
  );
}
