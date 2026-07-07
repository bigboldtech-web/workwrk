"use client";

// ItemRowMoreMenu — the ClickUp task-row "..." menu. Portaled (MorePortal) so it
// escapes the table's overflow, built from the shared MenuList/MenuItem. Wires
// the actions that have real endpoints (Copy link / Copy ID / New tab / Rename /
// Duplicate / Start timer / Archive / Delete) and stubs the rest with a toast so
// the menu reads complete without pretending unbuilt features work.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  MoreHorizontal, Copy, Pencil, Trash2, Archive, Clock, Star,
  CornerUpRight, ExternalLink, Box,
} from "lucide-react";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { MorePortal, type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";

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
  className?: string;
}>(function ItemRowMoreMenu({
  item,
  canEdit,
  onOpen,
  onRename,
  onDuplicate,
  onArchive,
  onDeleted,
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
          <div className="flex items-stretch gap-1 px-2 pb-1.5">
            <button type="button" onClick={copyLink} className="flex-1 h-7 rounded-md border border-zinc-200 text-[12px] text-zinc-700 hover:bg-zinc-50">Copy link</button>
            <button type="button" onClick={copyId} className="flex-1 h-7 rounded-md border border-zinc-200 text-[12px] text-zinc-700 hover:bg-zinc-50">Copy ID</button>
            <button type="button" onClick={newTab} className="flex-1 h-7 rounded-md border border-zinc-200 text-[12px] text-zinc-700 hover:bg-zinc-50">New tab</button>
          </div>
          <MenuSeparator />
          <MenuItem icon={Star} label="Favorite" onClick={() => soon("Favorite")} />
          {onOpen ? <MenuItem icon={ExternalLink} label="Open" onClick={() => { onOpen(); close(); }} /> : null}
          {canEdit && onRename ? <MenuItem icon={Pencil} label="Rename" onClick={() => { onRename(); close(); }} /> : null}
          {canEdit ? <MenuItem icon={CornerUpRight} label="Move to" onClick={() => soon("Move to")} /> : null}
          {canEdit && onDuplicate ? <MenuItem icon={Copy} label="Duplicate" onClick={() => { onDuplicate(); close(); }} /> : null}
          {canEdit ? <MenuItem icon={Box} label="Task type" onClick={() => soon("Task type")} /> : null}
          {canEdit ? <MenuItem icon={Clock} label="Start timer" onClick={startTimer} busy={busy === "timer"} /> : null}
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
