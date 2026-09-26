"use client";

// ViewTabContextMenu: the menu on each view tab of a List. It opens on a
// right-click, a long-press (touch and pen) and the keyboard's context-menu
// key or Shift+F10, all through useContextMenuTrigger, and from the active
// tab's trailing "..." (ViewTabMoreTrigger; the host calls the opener this
// component hands its children). Every door opens the same menu. Rows:
//   Rename               inline editor in the menu, PATCH { name }
//   Pin as default view  PATCH { isDefault: true }: the view opens first for
//                        everyone on the List (the route clears every other
//                        view's default and mark in the same transaction)
//   Unpin                PATCH { isDefault: false } on the pinned view: the
//                        List falls back to its Board
//   Duplicate            POST a new view with the source's type and config
//                        and a " (copy)" suffix
//   Schedule report      Phase 5b: the one ScheduleReportDialog, for a view
//                        whose content is the task set, where the host says
//                        the viewer may schedule one. The dialog also lists
//                        the reports this viewer receives, with Stop receiving
//   Delete               DELETE; refused server-side for the last view
// Which pin row shows is the strip's call (pinMenuRow in default-view.ts),
// passed in as `pinRow`, so the menu and the strip cannot disagree. The old
// "Set as default" row is gone: it sent the same PATCH { isDefault: true },
// which is "Pin as default view" now, on the pin's Can edit gate.
//
// Rename, Duplicate and Delete are gated the same way: the strip passes the
// route's own answer for each (`gates`), and a row the route would refuse is
// not drawn. They used to render for everyone, so a view-only reader got
// three rows that could only answer 403. A tab with no row left opens no
// menu at all (viewMenuHasRows), rather than an empty panel.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Edit2, Copy, Trash2, Pin, PinOff, CalendarClock } from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dots } from "@/components/ui/dots";
import { useContextMenuTrigger, type MenuPoint } from "@/components/ui/use-context-menu-trigger";
import { ScheduleReportDialog, SCHEDULABLE_VIEW_TYPES } from "@/components/reports/schedule-report-dialog";
import { accessMessage } from "@/lib/access-message";
import { cn } from "@/lib/utils";

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

type PinRow = "none" | "pin" | "pin-disabled" | "unpin";

/**
 * Which of the non-pin rows this person may use on this view, each the gate
 * its route checks (see board-view-tabs.tsx, viewTabGates). Every flag
 * defaults to true, so a caller that passes none keeps the full menu.
 */
export interface ViewMenuGates {
  /** PATCH { name }: canSaveView. */
  canRename?: boolean;
  /** POST /views: canContributeBoard. */
  canDuplicate?: boolean;
  /** DELETE: canManageView, and never the List's last view. */
  canDelete?: boolean;
}

/** May this view be scheduled here? Its content is the task set, and the host allows it. */
export function viewCanSchedule(view: Pick<ViewLike, "type">, scheduleReports: boolean): boolean {
  return scheduleReports && SCHEDULABLE_VIEW_TYPES.has(view.type);
}

/**
 * Does this tab's menu have any row to show? No row, no menu, and the host
 * draws no "...". `canSchedule` is viewCanSchedule's answer for the tab.
 */
export function viewMenuHasRows(pinRow: PinRow, gates: ViewMenuGates = {}, canSchedule = false): boolean {
  return pinRow !== "none"
    || gates.canRename !== false
    || gates.canDuplicate !== false
    || gates.canDelete !== false
    || canSchedule;
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
  /** Which pin row this tab's menu shows (pinMenuRow in default-view.ts). */
  pinRow: PinRow;
  /** Who pinned the List's default, for the Unpin row's second line. */
  pinnedByName?: string | null;
  /** The Personal list: its owner is its only reader, so the pin is "for you". */
  personalList?: boolean;
  /** After a pin or an unpin lands. The strip keeps the person on the view in front of them. */
  onPinChanged?: () => void;
  /** Rename / Duplicate / Delete, each only when its route would allow it. */
  gates?: ViewMenuGates;
  /**
   * The host decided the viewer may schedule reports of this List's views
   * (the strict List read, and a member). Absent: no Schedule report row.
   */
  scheduleReports?: boolean;
  /** Plain children, or a render function handed the menu's opener. */
  children?: ReactNode | ((openAt: (p: MenuPoint) => void) => ReactNode);
}

/** Wider than the old 200px, so the pin row's second line reads in one or two whole lines. */
const PANEL_WIDTH = 280;

export function ViewTabContextMenu({
  boardId,
  boardName,
  view,
  pinRow,
  pinnedByName,
  personalList,
  onPinChanged,
  gates,
  scheduleReports = false,
  children,
}: Props) {
  const { point, openAt, close, bind } = useContextMenuTrigger();
  const canSchedule = viewCanSchedule(view, scheduleReports);
  // Nothing this person may do from the menu: the tab is left as a plain
  // link (the browser's own menu, no long-press swallowing the tap).
  const hasRows = viewMenuHasRows(pinRow, gates, canSchedule);
  const open = hasRows && point !== null;
  // The dialog lives HERE, outside the menu panel: closing the menu (which
  // unmounts the panel) must never unmount the dialog it just opened.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const body = typeof children === "function" ? children(openAt) : children;

  // Keyboard reach: focus moves into the menu when it opens (its first row),
  // and a close from inside the menu (Esc, or a row that finished) hands it
  // back to the tab before the menu unmounts, so Shift+F10, then Tab and
  // Enter, work without a mouse. A click elsewhere keeps its own focus.
  const closeToTrigger = useCallback(() => {
    const restore = !!panelRef.current?.contains(document.activeElement);
    close();
    if (restore) triggerRef.current?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true });
  }, [close]);

  useEffect(() => {
    if (!open) return;
    // pointerdown, not mousedown: a long-press ends with the finger lifting,
    // and some browsers follow that with a compatibility mousedown on the tab,
    // which would close the menu the press had just opened. A real tap or
    // click anywhere else still starts with a pointerdown.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeToTrigger();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, closeToTrigger]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
  }, [open]);

  if (!hasRows) {
    return <div className="inline-flex h-full items-stretch">{body}</div>;
  }

  return (
    <>
      <div
        ref={triggerRef}
        className={cn("inline-flex h-full items-stretch", bind.className)}
        onContextMenu={bind.onContextMenu}
        onPointerDown={bind.onPointerDown}
        onPointerMove={bind.onPointerMove}
        onPointerUp={bind.onPointerUp}
        onPointerCancel={bind.onPointerCancel}
        onClickCapture={bind.onClickCapture}
      >
        {body}
      </div>
      {open && point ? (
        <div
          ref={panelRef}
          className="fixed z-[100]"
          style={{
            width: PANEL_WIDTH,
            left: Math.max(8, Math.min(point.x, typeof window !== "undefined" ? window.innerWidth - PANEL_WIDTH - 10 : point.x)),
            top: Math.min(point.y, typeof window !== "undefined" ? window.innerHeight - 300 : point.y),
          }}
        >
          <ViewMenuPanel
            boardId={boardId}
            view={view}
            pinRow={pinRow}
            pinnedByName={pinnedByName ?? null}
            personalList={Boolean(personalList)}
            onPinChanged={onPinChanged}
            gates={gates ?? {}}
            onClose={closeToTrigger}
            // Focus goes back to the tab first, so the dialog hands it back
            // there when it closes.
            onSchedule={canSchedule ? () => { closeToTrigger(); setScheduleOpen(true); } : undefined}
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
 * tab's link, so it stops the click from navigating, and it stops the
 * pointerdown too, so a finger on it is a tap and never starts the long-press.
 */
export function ViewTabMoreTrigger({ onOpen, label = "View options" }: { onOpen: (p: MenuPoint) => void; label?: string }) {
  const openFrom = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onOpen({ x: r.left, y: r.bottom + 4 });
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
  pinRow,
  pinnedByName,
  personalList,
  onPinChanged,
  gates,
  onClose,
  onSchedule,
}: {
  boardId: string;
  view: ViewLike;
  pinRow: PinRow;
  pinnedByName: string | null;
  personalList: boolean;
  onPinChanged?: () => void;
  gates: ViewMenuGates;
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

  // Pin and unpin are not optimistic: nothing reorders until the route has
  // answered, so a refusal (the route's own sentence) changes nothing on the
  // strip. On success the strip decides how to refresh (onPinChanged), so the
  // person stays on the view in front of them rather than following the pin.
  const setPin = async (pin: boolean) => {
    const kind = pin ? "pin" : "unpin";
    setBusy(kind);
    try {
      const res = await fetch(`/api/boards/${boardId}/views/${view.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: pin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(accessMessage(data, pin ? "Couldn't pin the view." : "Couldn't unpin the view."), { tone: "danger" });
        // A stale unpin (409): someone pinned another view since, so the
        // strip reloads to show the pin that is really there.
        if (!pin && res.status === 409) {
          onClose();
          if (onPinChanged) onPinChanged();
          else router.refresh();
        }
        return;
      }
      toast(pin ? "Pinned as the default view" : "Unpinned");
      onClose();
      if (onPinChanged) onPinChanged();
      else router.refresh();
    } catch {
      toast(pin ? "Couldn't pin the view." : "Couldn't unpin the view.", { tone: "danger" });
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

  // The pin rows' second line says who the pin is for and who set it (review
  // #23), so it wraps rather than being cut off at the menu's width.
  const wrap = (text: string) => <span className="whitespace-normal">{text}</span>;
  const canRename = gates.canRename !== false;
  const canDuplicate = gates.canDuplicate !== false;
  const canDelete = gates.canDelete !== false;

  return (
    <MenuList>
      {canRename ? <MenuItem icon={Edit2} label="Rename" onClick={() => setMode("rename")} /> : null}
      {pinRow === "pin" ? (
        <MenuItem
          icon={Pin}
          label="Pin as default view"
          description={wrap(personalList ? "Opens first for you" : "Opens first for everyone on this List")}
          busy={busy === "pin"}
          onClick={() => void setPin(true)}
        />
      ) : pinRow === "pin-disabled" ? (
        <MenuItem
          icon={Pin}
          label="Pin as default view"
          description={wrap("Only a shared view can be pinned for everyone")}
          title="A private view can't be the List's default, because the rest of the List can't see it."
          disabled
        />
      ) : pinRow === "unpin" ? (
        <MenuItem
          icon={PinOff}
          label="Unpin"
          description={wrap(
            pinnedByName
              ? `Pinned by ${pinnedByName}`
              : personalList
                ? "Opens first for you"
                : "Everyone on this List opens it first",
          )}
          busy={busy === "unpin"}
          onClick={() => void setPin(false)}
        />
      ) : null}
      {canDuplicate ? <MenuItem icon={Copy} label="Duplicate" busy={busy === "dup"} onClick={duplicate} /> : null}
      {onSchedule ? <MenuItem icon={CalendarClock} label="Schedule report" onClick={onSchedule} /> : null}
      {/* The separator sets Delete apart from the rows above it, so it only
          draws when there is both a Delete and something above it. */}
      {canDelete && (canRename || canDuplicate || pinRow !== "none" || onSchedule) ? <MenuSeparator /> : null}
      {canDelete ? <MenuItem icon={Trash2} label="Delete" destructive busy={busy === "del"} onClick={remove} /> : null}
    </MenuList>
  );
}

export type { ViewLike };
