"use client";

// ViewTabMenu — the "..." popover that lives on each view tab in the
// Board detail page. Actions:
//   Rename       — inline editor in the popover, PATCH name
//   Set default  — PATCH isDefault=true (server demotes the previous default in the same tx)
//   Duplicate    — POST a new view with the source's type + config + " (copy)" suffix
//   Delete       — DELETE; blocked server-side if it's the last view on the board
//
// Phase 5b adds Schedule report (before Delete): the one ScheduleReportDialog,
// for a view whose content is the task set, where the host says the viewer
// may schedule one.
//
// Opened by a right-click on any tab, or by the active tab's trailing "..."
// (the host calls the opener this component hands its children).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Copy, Trash2, Star, CalendarClock, } from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dots } from "@/components/ui/dots";
import { ScheduleReportDialog, SCHEDULABLE_VIEW_TYPES } from "@/components/reports/schedule-report-dialog";
import type { ViewMenuRows } from "@/lib/work/view-visibility";

interface ViewLike {
  id: string;
  name: string;
  type: ViewType;
  isDefault: boolean;
  config: unknown;
  /** A private view (false, with an owner) is scheduled only to its owner. */
  isShared?: boolean;
  ownerId?: string | null;
}

interface Props {
  boardId: string;
  /**
   * The List's name, so the Schedule report dialog names the List as well as
   * the view: every List's default view is called "List", and the dialog read
   * the same on all of them.
   */
  boardName?: string;
  view: ViewLike;
  /**
   * The host decided the viewer may schedule reports of this List's views
   * (the strict List read, and a member). Absent: no Schedule report row.
   */
  scheduleReports?: boolean;
  /**
   * The write rows this viewer may use (viewMenuRows, the routes' own gates).
   * Absent: every row, for a host whose viewer has full access (the Personal
   * List). A menu with no row at all does not open.
   */
  rows?: ViewMenuRows;
  /** Plain children, or a render function handed the menu's opener. */
  children?: ReactNode | ((openAt: (x: number, y: number) => void) => ReactNode);
}

/** Does this viewer get any row in a view's menu? The host hides the "..." when not. */
export function viewMenuHasRows(view: Pick<ViewLike, "type">, rows: ViewMenuRows | undefined, scheduleReports: boolean): boolean {
  if (!rows) return true;
  return rows.rename || rows.setDefault || rows.duplicate || rows.delete || (scheduleReports && SCHEDULABLE_VIEW_TYPES.has(view.type));
}

export function ViewTabContextMenu({ boardId, boardName, view, scheduleReports = false, rows, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // The dialog lives HERE, outside the menu panel: closing the menu (which
  // unmounts the panel) must never unmount the dialog it just opened.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openAt = useCallback((x: number, y: number) => {
    setPos({ x, y });
    setOpen(true);
  }, []);
  const canSchedule = scheduleReports && SCHEDULABLE_VIEW_TYPES.has(view.type);
  const hasRows = viewMenuHasRows(view, rows, scheduleReports);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
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

  return (
    <>
      <div
        className="inline-flex h-full items-stretch"
        onContextMenu={(e) => {
          // No row this viewer may use: the browser's own menu, not an empty one.
          if (!hasRows) return;
          e.preventDefault();
          openAt(e.clientX, e.clientY);
        }}
      >
        {typeof children === "function" ? children(openAt) : children}
      </div>
      {open ? (
        <div 
          ref={panelRef} 
          className="fixed z-[100] w-[200px]"
          style={{ 
            left: Math.min(pos.x, typeof window !== 'undefined' ? window.innerWidth - 210 : pos.x), 
            top: Math.min(pos.y, typeof window !== 'undefined' ? window.innerHeight - 300 : pos.y) 
          }}
        >
          <ViewMenuPanel
            boardId={boardId}
            view={view}
            rows={rows}
            onClose={() => setOpen(false)}
            onSchedule={canSchedule ? () => { setOpen(false); setScheduleOpen(true); } : undefined}
          />
        </div>
      ) : null}
      {canSchedule ? (
        <ScheduleReportDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          target={{
            kind: "view",
            id: view.id,
            // "List: View", the form the saved schedule and the email subject
            // use (readableTarget), so the dialog and the inbox agree.
            name: boardName ? `${boardName}: ${view.name}` : view.name,
            privateOwnerId: view.isShared === false && view.ownerId ? view.ownerId : null,
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The active tab's trailing "...": the same menu a right-click opens, for a
 * pointer that cannot right-click and for the keyboard. It sits inside the
 * tab's link, so it stops the click from navigating.
 */
export function ViewTabMoreTrigger({ onOpen, label = "View options" }: { onOpen: (x: number, y: number) => void; label?: string }) {
  const openFrom = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onOpen(r.left, r.bottom + 4);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openFrom(e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        openFrom(e.currentTarget);
      }}
      className="-me-1 inline-flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/view:opacity-100 group-focus-visible/view:opacity-100"
    >
      <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}

type Mode = "menu" | "rename";

function ViewMenuPanel({
  boardId,
  view,
  rows,
  onClose,
  onSchedule,
}: {
  boardId: string;
  view: ViewLike;
  rows?: ViewMenuRows;
  onClose: () => void;
  /** Absent: this view cannot be scheduled here, so there is no row. */
  onSchedule?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(view.name);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, kind: string): Promise<boolean> => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/boards/${boardId}/views/${view.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Update failed");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    setBusy("dup");
    try {
      const res = await fetch(`/api/boards/${boardId}/views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${view.name} (copy)`,
          type: view.type,
          config: view.config ?? undefined,
          isShared: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Duplicate failed");
        return;
      }
      toast("View duplicated");
      onClose();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete view", description: `Delete the "${view.name}" view?`, destructive: true, confirmLabel: "Delete" }))) return;
    setBusy("del");
    try {
      const res = await fetch(`/api/boards/${boardId}/views/${view.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Delete failed");
        return;
      }
      toast("View deleted");
      onClose();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (mode === "rename") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-2.5">
        <div className="text-micro uppercase tracking-wide text-zinc-400 font-semibold mb-2">
          Rename view
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== view.name) {
                patch({ name: v }, "rename").then((ok) => { if (ok) onClose(); });
              } else {
                onClose();
              }
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full h-8 px-2 rounded-md border border-zinc-200 bg-white text-base focus:outline-none focus:border-zinc-400"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => setMode("menu")}
            disabled={Boolean(busy)}
            className="h-6 px-2 rounded-md text-xs text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              const v = draft.trim();
              if (!v || v === view.name) { onClose(); return; }
              const ok = await patch({ name: v }, "rename");
              if (ok) onClose();
            }}
            disabled={Boolean(busy) || !draft.trim()}
            className="h-6 px-2 rounded-md text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "rename" ? <Dots variant="pending" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  const may: ViewMenuRows = rows ?? { rename: true, setDefault: !view.isDefault, duplicate: true, delete: true };
  return (
    <MenuList>
      {may.rename ? <MenuItem icon={Edit2} label="Rename" onClick={() => setMode("rename")} /> : null}
      {may.setDefault && !view.isDefault ? (
        <MenuItem
          icon={Star}
          label="Set as default"
          busy={busy === "default"}
          onClick={async () => {
            const ok = await patch({ isDefault: true }, "default");
            if (ok) onClose();
          }}
        />
      ) : null}
      {may.duplicate ? <MenuItem icon={Copy} label="Duplicate" busy={busy === "dup"} onClick={duplicate} /> : null}
      {onSchedule ? <MenuItem icon={CalendarClock} label="Schedule report" onClick={onSchedule} /> : null}
      {may.delete ? (
        <>
          {may.rename || may.setDefault || may.duplicate || onSchedule ? <MenuSeparator /> : null}
          <MenuItem icon={Trash2} label="Delete" destructive busy={busy === "del"} onClick={remove} />
        </>
      ) : null}
    </MenuList>
  );
}

export type { ViewLike };
