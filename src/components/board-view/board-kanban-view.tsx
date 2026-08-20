"use client";

// BoardKanbanView — KANBAN renderer for studio-item Boards.
//
// One column per status option. Cards carry the full ClickUp toolset (parity
// with the List row): the title (inline-rename), an interactive meta row
// (Assignee / Due / Priority / Tags — value when set, faint affordance on hover
// when empty), and a hover action rail top-right (Mark complete / Add subtask /
// Rename / "..." menu). Native HTML5 drag re-statuses a card between columns.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Network, Pencil, Plus, Repeat, X } from "lucide-react";
import { PRIORITY_OPTIONS, isDoneStatus, splitBulkResults, bulkFailureMessage, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import { buildRecurrenceSummary } from "@/lib/recurrence";
import type { FieldDef } from "@/lib/field-catalog";
import { FieldValue } from "./field-value";
import { AssigneePicker } from "./assignee-picker";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import { DatePlanner } from "./date-planner";
import { ItemRowMoreMenu } from "./item-row-more-menu";
import { BulkActionBar } from "./bulk-action-bar";
import { type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";

interface BoardKanbanViewProps {
  boardId: string;
  initialItems: BoardItemRow[];
  /** Custom fields from Board.schema.fields — the first two choice-type
   *  fields render as chips on each card. */
  initialFields?: FieldDef[];
  /** Per-List statuses (backbone #1) — one column per entry, in order. */
  statuses: StatusOption[];
  canEdit: boolean;
  onOpenItem?: (itemId: string) => void;
  /** Item-state ownership contract (2026-08-12) — same as BoardTableView:
   *  the board keeps an optimistic local copy of `initialItems` and re-syncs
   *  whenever the prop changes identity, so a parent that re-renders items
   *  (BoardCanvas does on every drawer edit) MUST wire these so its copy
   *  learns about every card mutation — otherwise its next re-render clobbers
   *  the local copy (new cards vanish, archived cards resurrect). */
  onItemCreated?: (item: BoardItemRow) => void;
  onItemPatched?: (id: string, patch: Partial<BoardItemRow>) => void;
  onItemRemoved?: (id: string) => void;
  onItemsRefreshed?: (items: BoardItemRow[]) => void;
  /** Space-module gating — hides the card's Priority / Tags / Start-timer when off. */
  priorityEnabled?: boolean;
  tagsEnabled?: boolean;
  timeTrackingEnabled?: boolean;
}

export function BoardKanbanView({ boardId, initialItems, initialFields, statuses, canEdit, onOpenItem, onItemCreated, onItemPatched, onItemRemoved, onItemsRefreshed, priorityEnabled = true, tagsEnabled = true, timeTrackingEnabled = true }: BoardKanbanViewProps) {
  const confirm = useConfirm();
  // Show all choice-type custom fields as chips on cards (capped so a card with
  // many fields doesn't sprawl) — so switching List → Board keeps custom data
  // visible.
  const chipFields = useMemo(
    () => (initialFields ?? []).filter((f) => f.type === "DROPDOWN" || f.type === "LABELS" || f.type === "MULTI_SELECT").slice(0, 6),
    [initialFields],
  );
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  // Multi-select for bulk actions (shared bar with the List view).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastSelectedRef = useRef<string | null>(null);

  // ── Item-state ownership (2026-08-12) ────────────────────────────────────
  // Cards created/removed locally while the parent has NOT wired the matching
  // callback are tracked so the resync effect can re-apply them over a stale
  // parent snapshot instead of dropping/resurrecting them. Entries settle
  // once an incoming snapshot reflects them.
  const unreportedAddsRef = useRef<Map<string, BoardItemRow>>(new Map());
  const unreportedRemovesRef = useRef<Set<string>>(new Set());
  const reportCreated = useCallback((item: BoardItemRow) => {
    if (onItemCreated) onItemCreated(item);
    else unreportedAddsRef.current.set(item.id, item);
  }, [onItemCreated]);
  const reportRemoved = useCallback((id: string) => {
    unreportedAddsRef.current.delete(id);
    if (onItemRemoved) onItemRemoved(id);
    else unreportedRemovesRef.current.add(id);
  }, [onItemRemoved]);

  // Re-sync when the parent passes a refreshed set — non-destructively (the
  // parent snapshot wins, then unreported local creates/removals re-apply).
  useEffect(() => {
    setItems(() => {
      const adds = unreportedAddsRef.current;
      const removes = unreportedRemovesRef.current;
      if (adds.size === 0 && removes.size === 0) return initialItems;
      const incoming = new Set(initialItems.map((r) => r.id));
      for (const id of Array.from(adds.keys())) if (incoming.has(id)) adds.delete(id);
      for (const id of Array.from(removes)) if (!incoming.has(id)) removes.delete(id);
      let next = initialItems;
      if (removes.size > 0) next = next.filter((r) => !removes.has(r.id));
      if (adds.size > 0) next = [...next, ...adds.values()];
      return next;
    });
  }, [initialItems]);

  const statusOrder = useMemo(() => statuses.map((o) => o.value), [statuses]);
  const firstStatus = statusOrder[0] ?? "TO_DO";
  const doneStatusValue = useMemo(
    () => statuses.find((s) => s.group === "DONE")?.value ?? statuses.find((s) => s.group !== "ACTIVE")?.value ?? null,
    [statuses],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, BoardItemRow[]>();
    for (const s of statusOrder) map.set(s, []);
    // Any rows with statuses outside the board's set get bucketed
    // into the first column so they don't disappear from the board.
    for (const row of items) {
      const bucket = row.status && map.has(row.status) ? row.status : statusOrder[0];
      if (bucket) map.get(bucket)!.push(row);
    }
    return map;
  }, [items, statusOrder]);

  // Visible card order (column order, top→bottom) — the axis shift-select
  // ranges over.
  const orderedIds = useMemo(
    () => statusOrder.flatMap((s) => (grouped.get(s) ?? []).map((c) => c.id)),
    [statusOrder, grouped],
  );
  const toggleSelect = useCallback((id: string, shiftKey?: boolean) => {
    if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
      const a = orderedIds.indexOf(lastSelectedRef.current);
      const b = orderedIds.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = orderedIds.slice(lo, hi + 1);
        setSelected((prev) => { const next = new Set(prev); range.forEach((rid) => next.add(rid)); return next; });
        lastSelectedRef.current = id;
        return;
      }
    }
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    lastSelectedRef.current = id;
  }, [orderedIds]);
  const clearSelection = useCallback(() => { setSelected(new Set()); lastSelectedRef.current = null; }, []);

  // Bulk actions — fan out over /api/items/[id] (no server bulk endpoint yet).
  // The local (and parent-reported) mutation applies ONLY to ids whose request
  // genuinely succeeded (fulfilled AND res.ok — an HTTP error resolves
  // fulfilled, so rejections alone lie). Failed ids stay visible, unmutated
  // and selected, and get named in the error banner so the user can retry.
  const bulkPatch = useCallback(async (body: Record<string, unknown>, local: Partial<BoardItemRow>) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { succeeded, failed } = await splitBulkResults(ids, (id) =>
      fetch(`/api/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
    setError(failed.length > 0 ? bulkFailureMessage("update", failed, ids.length, items) : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.map((r) => (ok.has(r.id) ? { ...r, ...local } : r)));
    for (const id of succeeded) onItemPatched?.(id, local);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, onItemPatched, items]);
  const bulkArchive = useCallback(async () => {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Archive cards", description: `Archive ${selected.size} card${selected.size === 1 ? "" : "s"}?`, destructive: true, confirmLabel: "Archive" }))) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { succeeded, failed } = await splitBulkResults(ids, (id) => fetch(`/api/items/${id}`, { method: "DELETE" }));
    setError(failed.length > 0 ? bulkFailureMessage("archive", failed, ids.length, items) : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.filter((r) => !ok.has(r.id)));
    for (const id of succeeded) reportRemoved(id);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, confirm, reportRemoved, items]);
  const bulkTrash = useCallback(async () => {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Delete cards", description: `Delete ${selected.size} card${selected.size === 1 ? "" : "s"}? They move to Trash and can be restored for 60 days.`, destructive: true, confirmLabel: "Delete" }))) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { succeeded, failed } = await splitBulkResults(ids, (id) => fetch(`/api/items/${id}?hard=1`, { method: "DELETE" }));
    setError(failed.length > 0 ? bulkFailureMessage("delete", failed, ids.length, items) : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.filter((r) => !ok.has(r.id)));
    for (const id of succeeded) reportRemoved(id);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, confirm, reportRemoved, items]);

  // Subtask counts per parent — shown on each card (ClickUp "N subtasks").
  const subtaskCountByParent = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      if (it.parentItemId) m.set(it.parentItemId, (m.get(it.parentItemId) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.items) {
        // Fresh server truth supersedes tracked local mutations; hand it to
        // the parent when wired (its resync flows back down) so a later
        // parent re-render can't regress below what we just fetched.
        unreportedAddsRef.current.clear();
        unreportedRemovesRef.current.clear();
        if (onItemsRefreshed) onItemsRefreshed(data.items);
        else setItems(data.items);
      }
    } catch {}
  }, [boardId, onItemsRefreshed]);

  // Optimistic PATCH — merges a display patch locally, sends the API body, and
  // refetches on failure. Backs assignee / due / priority / tags / status edits.
  const patchCard = useCallback(async (id: string, apiBody: Record<string, unknown>, localPatch: Partial<BoardItemRow>) => {
    if (!canEdit) return;
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...localPatch } : r)));
    onItemPatched?.(id, localPatch);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(apiBody),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error ?? "Update failed"); await refetch(); return; }
      // Recurring task completed → server rolled it forward (reset status +
      // advanced dates). Apply the returned row so the card visibly recurs.
      const d = await res.json().catch(() => null);
      if (d?.recurred && d.item) {
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...d.item } : r)));
        onItemPatched?.(id, d.item as Partial<BoardItemRow>);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed"); await refetch(); }
  }, [canEdit, refetch, onItemPatched]);

  const moveTo = useCallback((id: string, newStatus: string) => {
    void patchCard(id, { status: newStatus }, { status: newStatus });
  }, [patchCard]);

  const toggleComplete = useCallback((card: BoardItemRow) => {
    const done = isDoneStatus(statuses, card.status);
    const next = done ? firstStatus : (doneStatusValue ?? firstStatus);
    void patchCard(card.id, { status: next }, { status: next });
  }, [statuses, firstStatus, doneStatusValue, patchCard]);

  // Newly-created card/subtask id to drop straight into title-edit (with the
  // placeholder text selected) so the user types the name — no click-to-rename.
  const [autoEditId, setAutoEditId] = useState<string | null>(null);

  const addCard = useCallback(async (status: string) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New item", status }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "Failed to add card"); return; }
      setItems((prev) => [...prev, data.item as BoardItemRow]);
      if (data?.item) reportCreated(data.item as BoardItemRow);
      if (data?.item?.id) setAutoEditId(data.item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    }
  }, [boardId, canEdit, reportCreated]);

  const addSubtask = useCallback(async (parentId: string, status: string | null) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New subtask", status: status ?? firstStatus, parentItemId: parentId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "Failed to add subtask"); return; }
      if (data?.item) { setItems((prev) => [...prev, data.item as BoardItemRow]); reportCreated(data.item as BoardItemRow); setAutoEditId(data.item.id); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add subtask");
    }
  }, [boardId, canEdit, firstStatus, reportCreated]);

  const duplicateCard = useCallback(async (card: BoardItemRow) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `${card.title} (copy)`, status: card.status ?? firstStatus, ownerId: card.ownerId, metadata: card.metadata }),
      });
      const data = await res.json();
      if (res.ok && data?.item) { setItems((prev) => [...prev, data.item as BoardItemRow]); reportCreated(data.item as BoardItemRow); }
    } catch {}
  }, [boardId, canEdit, firstStatus, reportCreated]);

  const removeLocal = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    reportRemoved(id);
  }, [reportRemoved]);

  const archiveCard = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!(await confirm({ title: "Archive card", description: "Archive this card? You can restore it later from Trash.", destructive: true, confirmLabel: "Archive" }))) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    reportRemoved(id);
    try { const res = await fetch(`/api/items/${id}`, { method: "DELETE" }); if (!res.ok) await refetch(); } catch { await refetch(); }
  }, [canEdit, confirm, refetch, reportRemoved]);

  return (
    <div className="space-y-2">
      {error ? (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 rounded-md flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {statuses.map((meta) => {
          const status = meta.value;
          const cards = grouped.get(status) ?? [];
          const isHover = hoverColumn === status;
          return (
            <div
              key={status}
              className={`group/col flex flex-col w-[300px] flex-shrink-0 rounded-xl bg-zinc-100/60 p-2 transition-colors ${
                isHover ? "outline-2 outline-dashed -outline-offset-2 outline-[var(--os-brand)]" : ""
              }`}
              onDragOver={(e) => {
                if (!canEdit || !dragId) return;
                e.preventDefault();
                setHoverColumn(status);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setHoverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHoverColumn(null);
                if (!dragId || !canEdit) return;
                const card = items.find((r) => r.id === dragId);
                if (card && card.status !== status) moveTo(dragId, status);
                setDragId(null);
              }}
            >
              <div className="flex items-center gap-2 px-1 pt-0.5 pb-2.5">
                <span
                  className="inline-flex items-center h-5 rounded-[5px] px-2 text-[11.5px] font-bold uppercase tracking-wider text-white"
                  style={{ background: meta.color }}
                >
                  {meta.label}
                </span>
                <span className="text-[12px] font-medium text-zinc-400 tabular-nums">{cards.length}</span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/70 opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100 transition-opacity"
                    aria-label={`Add task to ${meta.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="flex-1 space-y-2 min-h-[40px]">
                {cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    boardId={boardId}
                    card={card}
                    chipFields={chipFields}
                    subtaskCount={subtaskCountByParent.get(card.id) ?? 0}
                    statuses={statuses}
                    canEdit={canEdit}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(null); setHoverColumn(null); }}
                    isDragging={dragId === card.id}
                    selected={selected.has(card.id)}
                    onToggleSelect={toggleSelect}
                    onOpen={onOpenItem ? () => onOpenItem(card.id) : undefined}
                    onPatch={patchCard}
                    onToggleComplete={() => toggleComplete(card)}
                    onAddSubtask={() => addSubtask(card.id, card.status)}
                    onDuplicate={() => duplicateCard(card)}
                    onArchive={() => archiveCard(card.id)}
                    onDeleted={() => removeLocal(card.id)}
                    autoEdit={autoEditId === card.id}
                    onAutoEditHandled={() => setAutoEditId(null)}
                    priorityEnabled={priorityEnabled}
                    tagsEnabled={tagsEnabled}
                    timeTrackingEnabled={timeTrackingEnabled}
                  />
                ))}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    className="w-full inline-flex items-center gap-1.5 text-left text-xs font-medium text-zinc-400 hover:text-zinc-700 py-1.5 px-2 rounded-md hover:bg-zinc-200/60 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Task
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <BulkActionBar
        selectedCount={selected.size}
        busy={bulkBusy}
        statuses={statuses}
        priorities={PRIORITY_OPTIONS}
        onClear={clearSelection}
        onArchive={bulkArchive}
        onStatus={(status) => bulkPatch({ status }, { status })}
        onDueAt={(iso) => bulkPatch({ dueAt: iso }, { dueAt: iso })}
        onOwner={(ownerId) => bulkPatch({ ownerId }, { ownerId })}
        onPriority={(priority) => bulkPatch({ priority }, { priority })}
        onTrash={bulkTrash}
      />
    </div>
  );
}

function KanbanCard({
  boardId,
  card,
  chipFields,
  subtaskCount,
  statuses,
  canEdit,
  onDragStart,
  onDragEnd,
  isDragging,
  selected,
  onToggleSelect,
  onOpen,
  onPatch,
  onToggleComplete,
  onAddSubtask,
  onDuplicate,
  onArchive,
  onDeleted,
  autoEdit = false,
  onAutoEditHandled,
  priorityEnabled = true,
  tagsEnabled = true,
  timeTrackingEnabled = true,
}: {
  boardId: string;
  card: BoardItemRow;
  chipFields: FieldDef[];
  subtaskCount: number;
  statuses: StatusOption[];
  canEdit: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  selected: boolean;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onOpen?: () => void;
  onPatch: (id: string, apiBody: Record<string, unknown>, localPatch: Partial<BoardItemRow>) => void;
  onToggleComplete: () => void;
  onAddSubtask: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDeleted: () => void;
  autoEdit?: boolean;
  onAutoEditHandled?: () => void;
  priorityEnabled?: boolean;
  tagsEnabled?: boolean;
  timeTrackingEnabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const moreRef = useRef<ContextMenuHandle>(null);
  // Seed the input from the current title only when entering edit mode — avoids
  // a prop-sync effect (which cascades renders).
  const startEdit = () => { setTitle(card.title); setEditing(true); };

  // Just-created card/subtask: drop into edit mode with the placeholder text
  // selected (the input's onFocus selects) so the user types the name directly.
  useEffect(() => {
    if (autoEdit && canEdit) { startEdit(); onAutoEditHandled?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit, canEdit]);

  const done = isDoneStatus(statuses, card.status);
  const tags = card.tags ?? [];
  const fieldChips = chipFields.filter((f) => {
    const v = card.metadata?.[f.key];
    return v != null && v !== "" && (!Array.isArray(v) || v.length > 0);
  });
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const iconBtn = "inline-flex items-center justify-center w-5 h-5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors";

  const saveTitle = () => {
    const next = title.trim();
    setEditing(false);
    if (next && next !== card.title) onPatch(card.id, { title: next }, { title: next });
    else setTitle(card.title);
  };

  return (
    <div
      draggable={canEdit && !editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => { if (!editing) onOpen?.(); }}
      onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
      className={`group relative rounded-lg border bg-white px-3 py-2 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        selected ? "border-[var(--os-brand)] ring-1 ring-[var(--os-brand)]" : "border-zinc-200 hover:border-zinc-300"
      } ${
        canEdit && !editing ? "cursor-grab active:cursor-grabbing" : onOpen ? "cursor-pointer" : ""
      } ${isDragging ? "opacity-40" : ""} hover:shadow-[0_2px_8px_rgba(0,0,0,0.07)] transition-[box-shadow,border-color] duration-150`}
    >
      {/* Title + action rail */}
      <div className="flex items-start gap-1.5">
        {canEdit ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? "Deselect card" : "Select card"}
            onClick={(e) => { stop(e); onToggleSelect(card.id, e.shiftKey); }}
            className={`mt-[3px] inline-flex items-center justify-center w-3.5 h-3.5 rounded-[4px] shrink-0 transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            style={{ backgroundColor: selected ? "var(--os-brand)" : "#fff", border: selected ? "1px solid var(--os-brand)" : "1px solid #d4d4d8" }}
          >
            {selected ? <Check className="w-2.5 h-2.5 text-white" /> : null}
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onClick={stop}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); else if (e.key === "Escape") { setTitle(card.title); setEditing(false); } }}
              onBlur={saveTitle}
              className="w-full bg-white border border-[var(--os-brand)] rounded-md px-1.5 py-0.5 text-[14px] font-medium text-zinc-900 focus:outline-none"
            />
          ) : (
            <div className="break-words text-[14px] font-medium leading-snug text-zinc-800">
              {card.title}
              {card.recurRule ? (
                <span
                  className="inline-flex items-center align-middle ml-1 text-zinc-400"
                  title={buildRecurrenceSummary(card.recurRule)}
                  aria-label="Recurring task"
                >
                  <Repeat className="w-3 h-3" />
                </span>
              ) : null}
            </div>
          )}
        </div>
        {/* Mark complete — filled when done (always), else in the hover rail. */}
        {canEdit && done ? (
          <button type="button" onClick={(e) => { stop(e); onToggleComplete(); }} className="inline-flex items-center justify-center w-5 h-5 rounded text-emerald-600 shrink-0" title="Mark incomplete" aria-label="Mark incomplete">
            <CheckCircle2 className="w-3.5 h-3.5" style={{ fill: "currentColor" }} />
          </button>
        ) : null}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 shrink-0" onClick={stop}>
          {canEdit && !done ? (
            <button type="button" onClick={(e) => { stop(e); onToggleComplete(); }} className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-emerald-600 hover:bg-zinc-100" title="Mark complete" aria-label="Mark complete">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" onClick={(e) => { stop(e); onAddSubtask(); }} className={iconBtn} title="Add subtask" aria-label="Add subtask">
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" onClick={(e) => { stop(e); startEdit(); }} className={iconBtn} title="Rename" aria-label="Rename">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <ItemRowMoreMenu
            ref={moreRef}
            item={{ id: card.id, boardId, title: card.title }}
            canEdit={canEdit}
            onOpen={onOpen}
            onRename={startEdit}
            onDuplicate={onDuplicate}
            onArchive={onArchive}
            onDeleted={onDeleted}
            itemTypeId={card.itemTypeId ?? null}
            onSetType={(t) => onPatch(card.id, { itemTypeId: t }, { itemTypeId: t })}
            timeTrackingEnabled={timeTrackingEnabled}
          />
        </div>
      </div>

      {/* Meta row — Assignee / Due / Priority / Tags + field chips. Set values
          show always; empty affordances appear on hover. */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap" onClick={stop}>
        <span className={card.ownerId ? "inline-flex" : "hidden group-hover:inline-flex"}>
          <AssigneePicker
            value={card.owner ? { ...card.owner, email: null } : null}
            canEdit={canEdit}
            compact
            onChange={(person) =>
              onPatch(
                card.id,
                { ownerId: person?.id ?? null },
                { ownerId: person?.id ?? null, owner: person ? { id: person.id, firstName: person.firstName ?? "", lastName: person.lastName ?? "", avatar: person.avatar } : null },
              )
            }
          />
        </span>

        {/* Due — full DatePlanner (Date / Reminder / Repeat) from the card icon. */}
        <span className={`relative ${card.dueAt ? "inline-flex" : "hidden group-hover:inline-flex"}`}>
          <DatePlanner
            item={card}
            canEdit={canEdit}
            statuses={statuses}
            done={done}
            compact
            onPatch={(body, opt) => onPatch(card.id, body as unknown as Record<string, unknown>, (opt ?? {}) as Partial<BoardItemRow>)}
          />
        </span>

        {/* Priority */}
        {priorityEnabled ? (
          <span className={card.priority ? "inline-flex" : "hidden group-hover:inline-flex"}>
            <PriorityPicker value={card.priority ?? null} canEdit={canEdit} compact onChange={(priority) => onPatch(card.id, { priority }, { priority })} />
          </span>
        ) : null}

        {/* Tags */}
        {tagsEnabled ? (
          <span className={tags.length > 0 ? "inline-flex" : "hidden group-hover:inline-flex"}>
            <TagPicker value={tags} canEdit={canEdit} compact onChange={(next) => onPatch(card.id, { tagIds: next.map((t) => t.id) }, { tags: next })} />
          </span>
        ) : null}

        {fieldChips.map((f) => (
          <FieldValue key={f.key} field={f} value={card.metadata?.[f.key]} mode="display" />
        ))}
      </div>

      {/* Footer — subtask count only (ClickUp cards carry no created date). */}
      {subtaskCount > 0 ? (
        <div className="mt-2 flex items-center text-[12px] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Network className="w-3 h-3" />
            {subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
