"use client";

// ItemMoreMenu, the task "…", ONE component for the page, the drawer and the
// list row (spec-task-detail section 2, "the canon, printed once for the whole
// app"; section 3).
//
// It replaces two menus that had drifted apart: `item-row-more-menu.tsx` (the
// row) and a bare "Archive" button (the task header). The row had Open, Open
// in new tab, Rename and Task type that the header did not; the header had
// Mark complete, Assign to me, Watch and Save as template that the row did
// not. Both are now the seventeen rows in src/lib/item-menu.ts, and only THREE
// of them depend on the host, so the two can never drift again.
//
// It renders no row the viewer's role cannot use, absent, never disabled
// (access section 5.4), and it is never rendered in `host="panel"`, because
// the Inbox pane's actions belong to the notification.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { MenuList, MenuItem, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { accessMessage } from "@/lib/access-message";
import { emitItemChanged } from "@/lib/realtime-events";
import { buildItemMenu, type ItemMenuHost, type ItemMenuRow } from "@/lib/item-menu";
import { moveDestinations } from "@/lib/item-move";
import type { ItemRole } from "@/lib/item-role";
import type { StatusOption } from "@/lib/board-items-shared";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useItemTypes } from "./use-item-types";

export interface ItemMoreMenuItem {
  id: string;
  boardId?: string | null;
  title: string;
  status?: string | null;
  assigneeIds?: string[];
  itemTypeId?: string | null;
}

export interface ItemMoreMenuProps {
  item: ItemMoreMenuItem;
  role: ItemRole;
  host: ItemMenuHost;
  currentUserId: string | null;
  statuses: StatusOption[];
  watcherIds?: string[];
  timeTrackingOn?: boolean;
  timerRunning?: boolean;
  personalList?: boolean;
  assigneeOnly?: boolean;
  isCreator?: boolean;
  isAgent?: boolean;
  isGuest?: boolean;
  archived?: boolean;
  /** PATCH through the host, so its optimistic merge still applies. */
  onPatch: (body: Record<string, unknown>) => void;
  onOpen?: () => void;
  onRenameRequested?: () => void;
  onArchived?: () => void;
  onDeleted?: () => void;
  onMoved?: (boardId: string) => void;
  onDuplicated?: (itemId: string) => void;
  /** Absent means no Share row: a Personal List task has nothing to share. */
  onShare?: () => void;
  /** Archive's Undo restored the task: the host re-reads it. */
  onRestored?: () => void;
  /** "Set reminder" > "Custom…" opens the host's DatePlanner Reminder tab. */
  onCustomReminder?: () => void;
  /** The trigger, when the host wants its own (a row's hover "…"). */
  className?: string;
  /**
   * Hide the "…" button and open only through the ref. Calendar, Gantt,
   * Timeline, Hierarchy and Cards mount ONE menu for the whole surface and
   * re-target it on right-click, so exactly the same rows open everywhere.
   */
  triggerless?: boolean;
}

const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: "In 1 hour", minutes: 60 },
  { label: "This evening", minutes: -1 },
  { label: "Tomorrow morning", minutes: -2 },
  { label: "Next week", minutes: 60 * 24 * 7 },
];

function presetAt(minutes: number): Date {
  const d = new Date();
  if (minutes === -1) {
    d.setHours(18, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d;
  }
  if (minutes === -2) {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  return new Date(Date.now() + minutes * 60_000);
}

export const ItemMoreMenu = forwardRef<ContextMenuHandle, ItemMoreMenuProps>(function ItemMoreMenu(props, ref) {
  const {
    item, role, host, currentUserId, statuses, watcherIds = [],
    timeTrackingOn = true, timerRunning = false, personalList = false,
    assigneeOnly = false, isCreator = false, isAgent = false, isGuest = false,
    archived = false, onPatch, onOpen, onRenameRequested, onArchived, onDeleted,
    onMoved, onDuplicated, onShare, onRestored, onCustomReminder,
    className = "", triggerless = false,
  } = props;

  const confirm = useConfirm();
  const prompt = usePrompt();
  const { toast } = useOsToast();
  const types = useItemTypes();
  const [open, setOpen] = useState(false);
  const [movePicker, setMovePicker] = useState(false);
  const [lists, setLists] = useState<{ id: string; name: string; spaceName: string | null }[]>([]);
  // Three states, not two. "Still loading" and "the request failed" both used
  // to render as an empty list under the sentence "No other list you can write
  // to", which asserts something about the viewer's ACCESS that neither of
  // them knows.
  const [listsState, setListsState] = useState<"idle" | "ready" | "failed">("idle");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Lists the viewer may write to: the Move target set, and also the answer to
  // "is there anywhere to move this?". Loaded once the menu is first opened.
  //
  // `?editable=1` is the superset (it also feeds the create-task location
  // picker), so the Personal list comes back in it and is dropped here:
  // PATCH /api/items/[id] answers 403 for that destination, and a picker must
  // never offer a row the server will refuse.
  useEffect(() => {
    if (!open || lists.length) return;
    // No setState here: the state STARTS at "idle", which the picker already
    // reads as "still looking". Only the two outcomes are written.
    fetch("/api/boards?editable=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const rows: { id: string; name: string; spaceId: string | null; productSlug?: string | null }[] =
          Array.isArray(d?.boards) ? d.boards : [];
        // The route answers `{ boards, spaces }`, the Space names come back
        // once, not per row, so the picker's group labels are a join here.
        const spaces = new Map<string, string>(
          (Array.isArray(d?.spaces) ? d.spaces : []).map((s: { id: string; name: string }) => [s.id, s.name]),
        );
        setLists(
          moveDestinations(rows).map((b) => ({
            id: b.id,
            name: b.name,
            spaceName: b.spaceId ? spaces.get(b.spaceId) ?? null : null,
          })),
        );
        setListsState("ready");
      })
      .catch(() => {
        setLists([]);
        setListsState("failed");
      });
  }, [open, lists.length]);

  // A right-click opens the same menu at the pointer. `pinned` is set by the
  // ref so the effect below does not immediately move it back to the button,
  // which in triggerless mode does not exist.
  const pinned = useRef(false);
  useImperativeHandle(ref, () => ({
    openAtPoint: (x: number, y: number) => {
      pinned.current = true;
      setListsState((prev) => (prev === "failed" ? "idle" : prev));
      setPos({ top: y, left: Math.max(8, Math.min(x, window.innerWidth - 248)) });
      setOpen(true);
    },
  }));

  // Measured in the click handler rather than in an effect: the button is on
  // screen when it is pressed, so there is nothing to wait for and no second
  // render to pay for.
  const openFromButton = useCallback(() => {
    pinned.current = false;
    // A reopen after a failed load says "looking" again rather than leaving
    // the last error sentence standing over a live retry.
    setListsState((prev) => (prev === "failed" ? "idle" : prev));
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 240) });
    setOpen(true);
  }, []);

  const isDone = Boolean(statuses.find((s) => s.value === item.status)?.group === "DONE");
  const isAssignee = Boolean(currentUserId && item.assigneeIds?.includes(currentUserId));
  const isWatching = Boolean(currentUserId && watcherIds.includes(currentUserId));
  const canMoveElsewhere = lists.filter((l) => l.id !== item.boardId).length > 0 || lists.length === 0;

  const rows = buildItemMenu({
    host,
    role,
    isAssignee,
    isDone,
    isWatching,
    hasItemTypes: types.list.length > 1,
    timeTrackingOn,
    timerRunning,
    personalList,
    canMoveElsewhere,
    assigneeOnly,
    isCreator,
    isAgent,
    isGuest,
    archived,
  });

  const close = useCallback(() => setOpen(false), []);

  const act = useCallback(
    async (row: ItemMenuRow) => {
      switch (row.key) {
        case "open":
          close();
          onOpen?.();
          return;
        case "open-new-tab":
          close();
          window.open(`/item/${item.id}`, "_blank", "noopener,noreferrer");
          return;
        case "complete": {
          close();
          const next = isDone
            ? statuses.find((s) => s.group === "ACTIVE")?.value
            : statuses.find((s) => s.group === "DONE")?.value;
          if (next) onPatch({ status: next });
          return;
        }
        case "assign-to-me":
          close();
          if (currentUserId) onPatch({ assigneeIds: [...(item.assigneeIds ?? []), currentUserId] });
          return;
        case "rename":
          close();
          onRenameRequested?.();
          return;
        case "copy-link":
          close();
          void navigator.clipboard?.writeText(`${window.location.origin}/item/${item.id}`);
          toast("Link copied");
          return;
        case "copy-id":
          close();
          void navigator.clipboard?.writeText(item.id);
          toast("Task ID copied");
          return;
        case "duplicate": {
          close();
          const res = await fetch(`/api/items/${item.id}/duplicate`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast(accessMessage(data, "Couldn't duplicate this task."));
            return;
          }
          toast("Task duplicated");
          if (data.item?.id) onDuplicated?.(data.item.id);
          return;
        }
        case "move":
          setOpen(false);
          setMovePicker(true);
          return;
        case "watch":
          close();
          if (currentUserId) {
            onPatch({
              watcherIds: isWatching ? watcherIds.filter((id) => id !== currentUserId) : [...watcherIds, currentUserId],
            });
          }
          return;
        case "timer": {
          close();
          await fetch(timerRunning ? "/api/timers/stop" : "/api/timers/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entityType: "BOARD_ITEM", entityId: item.id }),
          });
          return;
        }
        case "save-template": {
          close();
          const name = await prompt({
            title: "Save as template",
            description: "Everyone at this workspace can apply it.",
            placeholder: "Template name",
            defaultValue: item.title,
            submitLabel: "Save",
            required: true,
          });
          if (!name) return;
          const res = await fetch("/api/item-templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, itemId: item.id }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            toast(accessMessage(data, "Couldn't save that template."));
            return;
          }
          toast("Template saved");
          return;
        }
        case "share":
          close();
          onShare?.();
          return;
        case "archive": {
          close();
          const ok = await confirm({
            title: "Archive task",
            description: "Archive this task? You can restore it from the task or from Trash.",
            confirmLabel: "Archive",
          });
          if (!ok) return;
          const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            toast(accessMessage(data, "Couldn't archive this task."));
            return;
          }
          toast("Task archived", {
            onUndo: async () => {
              const undo = await fetch(`/api/items/${item.id}/restore`, { method: "POST" });
              if (!undo.ok) {
                const d = await undo.json().catch(() => ({}));
                toast(accessMessage(d, "Couldn't restore this task."));
                return;
              }
              emitItemChanged(item.id, item.boardId ?? null);
              onRestored?.();
            },
          });
          emitItemChanged(item.id, item.boardId ?? null, true);
          onArchived?.();
          return;
        }
        case "delete": {
          close();
          const ok = await confirm({
            title: "Delete task",
            description: "Delete this task? It moves to Trash for 60 days.",
            destructive: true,
            confirmLabel: "Delete",
          });
          if (!ok) return;
          const res = await fetch(`/api/items/${item.id}?hard=1`, { method: "DELETE" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            toast(
              accessMessage(data, "Couldn't delete this task.", {
                role_too_low: "Only the person who created this task, or someone with full access, can delete it.",
              }),
            );
            return;
          }
          toast("Task deleted");
          emitItemChanged(item.id, item.boardId ?? null, true);
          onDeleted?.();
          return;
        }
        default:
          return;
      }
    },
    [
      close, item, isDone, statuses, onPatch, currentUserId, onRenameRequested, toast, onOpen,
      onDuplicated, isWatching, watcherIds, timerRunning, prompt, onShare, confirm, onArchived,
      onDeleted, onRestored,
    ],
  );

  const moveSections: PickerSectionDef[] = (() => {
    const bySpace = new Map<string, { id: string; name: string }[]>();
    for (const l of lists) {
      const key = l.spaceName ?? "My work";
      if (!bySpace.has(key)) bySpace.set(key, []);
      bySpace.get(key)!.push({ id: l.id, name: l.name });
    }
    return [...bySpace.entries()].map(([label, options]) => ({
      label,
      options: options.map((o) => ({ value: o.id, label: o.name })),
    }));
  })();

  return (
    <span className={`relative inline-flex ${className}`}>
      {triggerless ? null : (
      <button
        ref={btnRef}
        type="button"
        aria-label="Task actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openFromButton();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </button>
      )}

      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[70]" onMouseDown={close} aria-hidden="true" />
              <div
                role="menu"
                className="os-chrome fixed z-[71] w-[240px] rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]"
                style={{ top: pos.top, left: pos.left }}
              >
                <MenuList>
                  {rows.map((row) => {
                    if (row.separatorBefore) {
                      return (
                        <span key={row.key}>
                          <MenuSeparator />
                          <MenuItem label={row.label} destructive={row.destructive} onClick={() => void act(row)} />
                        </span>
                      );
                    }
                    if (row.key === "type") {
                      return (
                        <MenuSubmenu key={row.key} label={row.label}>
                          {/* Without a Default row a type that has been set
                              can never be cleared again. */}
                          <MenuItem
                            label="Default"
                            selected={!item.itemTypeId}
                            onClick={() => {
                              close();
                              onPatch({ itemTypeId: null });
                            }}
                          />
                          {types.list.map((t) => (
                            <MenuItem
                              key={t.id}
                              label={t.singular}
                              selected={t.id === item.itemTypeId}
                              onClick={() => {
                                close();
                                onPatch({ itemTypeId: t.id });
                              }}
                            />
                          ))}
                        </MenuSubmenu>
                      );
                    }
                    if (row.key === "remind") {
                      return (
                        <MenuSubmenu key={row.key} label={row.label}>
                          {onCustomReminder ? (
                            <MenuItem
                              label="Custom…"
                              onClick={() => {
                                close();
                                onCustomReminder();
                              }}
                            />
                          ) : null}
                          {REMINDER_PRESETS.map((p) => (
                            <MenuItem
                              key={p.label}
                              label={p.label}
                              onClick={() => {
                                close();
                                void fetch("/api/reminders", {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    title: item.title,
                                    remindAt: presetAt(p.minutes).toISOString(),
                                    entityType: "BOARD_ITEM",
                                    entityId: item.id,
                                  }),
                                }).then((r) => toast(r.ok ? "Reminder set" : "Couldn't set that reminder."));
                              }}
                            />
                          ))}
                        </MenuSubmenu>
                      );
                    }
                    return (
                      <MenuItem
                        key={row.key}
                        label={row.label}
                        destructive={row.destructive}
                        onClick={() => void act(row)}
                      />
                    );
                  })}
                </MenuList>
              </div>
            </>,
            document.body,
          )
        : null}

      <Picker
        open={movePicker}
        onClose={() => setMovePicker(false)}
        sections={moveSections}
        selected={item.boardId ?? null}
        align="end"
        ariaLabel="Move to list"
        searchPlaceholder="Search lists…"
        anchorPoint={triggerless ? pos : null}
        emptyLabel={
          listsState === "idle"
            ? "Finding lists…"
            : listsState === "failed"
              ? "Couldn't load your lists. Check your connection and try again."
              : "No other list you can write to"
        }
        onSelect={(boardId) => {
          setMovePicker(false);
          if (boardId === item.boardId) return;
          onPatch({ boardId });
          onMoved?.(boardId);
        }}
        footer={
          <p className="px-2 py-1.5 text-xs text-ink-2">
            Statuses map to the nearest status in the new list.
          </p>
        }
      />
    </span>
  );
});
