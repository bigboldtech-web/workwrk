"use client";

// ItemRowMoreMenu — the ClickUp task-row "..." + right-click menu. Portaled
// (MorePortal) so it escapes the table's overflow, built from the shared
// MenuList / MenuItem / MenuSubmenu. Wires the actions that have real endpoints
// (Copy link / Copy ID / New tab / Rename / Task type / Remind me / Duplicate /
// Start timer / Archive / Delete) and stubs the few with no backend yet.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  MoreHorizontal, Copy, Pencil, Trash2, Archive, Clock, Star,
  CornerUpRight, ExternalLink, Box, Bell,
} from "lucide-react";
import { MenuList, MenuItem, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { MorePortal, type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useItemTypes } from "./use-item-types";
import { itemTypeIcon } from "@/lib/item-type-icons";

export const ItemRowMoreMenu = forwardRef<ContextMenuHandle, {
  item: { id: string; boardId?: string | null; title: string };
  canEdit: boolean;
  onOpen?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  /** Runs the archive flow (own confirm + API + row removal). */
  onArchive?: () => void;
  /** Local removal after a hard delete succeeds. */
  onDeleted?: () => void;
  /** Current task type id (for the check in the Task type submenu). */
  itemTypeId?: string | null;
  /** Apply a task type (optimistic in the parent). Enables the submenu. */
  onSetType?: (itemTypeId: string | null) => void;
  /** Time Tracking module — hides "Start timer" when false. */
  timeTrackingEnabled?: boolean;
  className?: string;
}>(function ItemRowMoreMenu({
  item,
  canEdit,
  onOpen,
  onRename,
  onDuplicate,
  onArchive,
  onDeleted,
  itemTypeId,
  onSetType,
  timeTrackingEnabled = true,
  className,
}, ref) {
  const [open, setOpen] = useState(false);
  // Cursor coords when opened via right-click; null = anchored to the "…" button.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useOsToast();
  const confirm = useConfirm();

  useImperativeHandle(ref, () => ({
    openAtPoint: (x, y) => { setPoint({ x, y }); setOpen(true); },
  }), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const soon = (label: string) => { toast(`${label} — coming soon`); close(); };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/item/${item.id}`); toast("Link copied"); } catch {}
    close();
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(item.id); toast("ID copied"); } catch {}
    close();
  };
  const newTab = () => { window.open(`/item/${item.id}`, "_blank", "noopener"); close(); };

  const startTimer = async () => {
    setBusy("timer");
    try {
      const res = await fetch("/api/timers/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: "BOARD_ITEM", entityId: item.id }),
      });
      const d = await res.json().catch(() => ({}));
      toast(res.ok ? "Timer started" : (d?.error ?? "Couldn't start timer"));
    } catch { toast("Couldn't start timer"); }
    finally { setBusy(null); close(); }
  };

  const setType = (id: string | null) => { onSetType?.(id); toast("Task type updated"); close(); };

  const remind = async (at: Date, label: string) => {
    close();
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: item.title || "Task reminder",
          remindAt: at.toISOString(),
          entityType: "BOARD_ITEM", entityId: item.id,
        }),
      });
      toast(res.ok ? `Reminder set — ${label}` : "Couldn't set reminder");
    } catch { toast("Couldn't set reminder"); }
  };

  const archive = () => { close(); onArchive?.(); };

  const del = async () => {
    close();
    const ok = await confirm({
      title: "Delete task",
      description: `Delete "${item.title}"? It moves to Trash and can be restored for 60 days.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/items/${item.id}?hard=1`, { method: "DELETE" });
      if (res.ok) onDeleted?.();
      else { const d = await res.json().catch(() => ({})); toast(d?.error ?? "Couldn't delete"); }
    } catch { toast("Couldn't delete"); }
    finally { setBusy(null); }
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPoint(null); setOpen((v) => !v); }}
        className={`${className ?? "inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"} transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={236} open={open} placement="below" point={point}>
        <MenuList className="min-w-[236px]" onClick={(e) => e.stopPropagation()}>
          {/* Copy trio (ClickUp header row) */}
          <div className="flex items-stretch gap-1.5 px-2.5 pt-0.5 pb-2">
            <button type="button" onClick={copyLink} className="flex-1 h-7 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">Copy link</button>
            <button type="button" onClick={copyId} className="flex-1 h-7 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">Copy ID</button>
            <button type="button" onClick={newTab} className="flex-1 h-7 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">New tab</button>
          </div>
          <MenuSeparator />
          <MenuItem icon={Star} label="Favorite" onClick={() => soon("Favorite")} />
          {onOpen ? <MenuItem icon={ExternalLink} label="Open" onClick={() => { onOpen(); close(); }} /> : null}
          {canEdit && onRename ? <MenuItem icon={Pencil} label="Rename" onClick={() => { onRename(); close(); }} /> : null}
          {canEdit ? (
            <MenuSubmenu icon={Bell} label="Remind me">
              <RemindSubmenu onPick={remind} />
            </MenuSubmenu>
          ) : null}
          {canEdit ? (
            <>
              <MenuSeparator />
              <MenuItem icon={CornerUpRight} label="Move to" onClick={() => soon("Move to")} />
              {onDuplicate ? <MenuItem icon={Copy} label="Duplicate" onClick={() => { onDuplicate(); close(); }} /> : null}
              {onSetType ? (
                <MenuSubmenu icon={Box} label="Task type">
                  <TaskTypeSubmenu currentId={itemTypeId ?? null} onSet={setType} />
                </MenuSubmenu>
              ) : (
                <MenuItem icon={Box} label="Task type" onClick={() => soon("Task type")} />
              )}
              {timeTrackingEnabled ? <MenuItem icon={Clock} label="Start timer" onClick={startTimer} busy={busy === "timer"} /> : null}
            </>
          ) : null}
          {canEdit ? (
            <>
              <MenuSeparator />
              {onArchive ? <MenuItem icon={Archive} label="Archive" onClick={archive} /> : null}
              <MenuItem icon={Trash2} label="Delete" destructive onClick={del} busy={busy === "delete"} />
            </>
          ) : null}
        </MenuList>
      </MorePortal>
    </span>
  );
});

// Task type submenu — org item types (lazily fetched, one shared 60s cache),
// with the current one checked. "Default" clears the type.
function TaskTypeSubmenu({ currentId, onSet }: { currentId: string | null; onSet: (id: string | null) => void }) {
  const { list } = useItemTypes();
  return (
    <>
      <MenuItem label="Default" selected={currentId === null} onClick={() => onSet(null)} />
      {list.map((t) => (
        <MenuItem
          key={t.id}
          icon={itemTypeIcon(t.icon)}
          label={t.singular}
          selected={currentId === t.id}
          onClick={() => onSet(t.id)}
        />
      ))}
    </>
  );
}

// Remind-me submenu — quick reminders that create real Reminder rows so they
// fire through the same ticker/cron + topbar bell as due-date reminders.
function RemindSubmenu({ onPick }: { onPick: (at: Date, label: string) => void }) {
  const inHour = () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; };
  const thisEvening = () => { const d = new Date(); d.setHours(18, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d; };
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
  const nextWeek = () => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + ((8 - day) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; };
  return (
    <>
      <MenuItem label="In 1 hour" onClick={() => onPick(inHour(), "in 1 hour")} />
      <MenuItem label="This evening" onClick={() => onPick(thisEvening(), "this evening")} />
      <MenuItem label="Tomorrow" onClick={() => onPick(tomorrow(), "tomorrow")} />
      <MenuItem label="Next week" onClick={() => onPick(nextWeek(), "next week")} />
    </>
  );
}
