"use client";

// BoardKanbanView — KANBAN renderer for studio-item Boards.
//
// One column per status option. Cards carry the full ClickUp toolset (parity
// with the List row): the title (inline-rename), an interactive meta row
// (Assignee / Due / Priority / Tags — value when set, faint affordance on hover
// when empty), and a hover action rail top-right (Mark complete / Add subtask /
// Rename / "..." menu). Native HTML5 drag re-statuses a card between columns.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, CheckCircle2, Network, Pencil, Plus, X } from "lucide-react";
import { isDoneStatus, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { FieldValue } from "./field-value";
import { AssigneePicker } from "./assignee-picker";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import { ItemRowMoreMenu } from "./item-row-more-menu";
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
  /** Space-module gating — hides the card's Priority / Tags / Start-timer when off. */
  priorityEnabled?: boolean;
  tagsEnabled?: boolean;
  timeTrackingEnabled?: boolean;
}

export function BoardKanbanView({ boardId, initialItems, initialFields, statuses, canEdit, onOpenItem, priorityEnabled = true, tagsEnabled = true, timeTrackingEnabled = true }: BoardKanbanViewProps) {
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

  useEffect(() => { setItems(initialItems); }, [initialItems]);

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
      if (data?.items) setItems(data.items);
    } catch {}
  }, [boardId]);

  // Optimistic PATCH — merges a display patch locally, sends the API body, and
  // refetches on failure. Backs assignee / due / priority / tags / status edits.
  const patchCard = useCallback(async (id: string, apiBody: Record<string, unknown>, localPatch: Partial<BoardItemRow>) => {
    if (!canEdit) return;
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...localPatch } : r)));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(apiBody),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error ?? "Update failed"); await refetch(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed"); await refetch(); }
  }, [canEdit, refetch]);

  const moveTo = useCallback((id: string, newStatus: string) => {
    void patchCard(id, { status: newStatus }, { status: newStatus });
  }, [patchCard]);

  const toggleComplete = useCallback((card: BoardItemRow) => {
    const done = isDoneStatus(statuses, card.status);
    const next = done ? firstStatus : (doneStatusValue ?? firstStatus);
    void patchCard(card.id, { status: next }, { status: next });
  }, [statuses, firstStatus, doneStatusValue, patchCard]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    }
  }, [boardId, canEdit]);

  const addSubtask = useCallback(async (parentId: string, status: string | null) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New subtask", status: status ?? firstStatus, parentItemId: parentId }),
      });
      const data = await res.json();
      if (res.ok && data?.item) setItems((prev) => [...prev, data.item as BoardItemRow]);
    } catch {}
  }, [boardId, canEdit, firstStatus]);

  const duplicateCard = useCallback(async (card: BoardItemRow) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `${card.title} (copy)`, status: card.status ?? firstStatus, ownerId: card.ownerId, metadata: card.metadata }),
      });
      const data = await res.json();
      if (res.ok && data?.item) setItems((prev) => [...prev, data.item as BoardItemRow]);
    } catch {}
  }, [boardId, canEdit, firstStatus]);

  const removeLocal = useCallback((id: string) => setItems((prev) => prev.filter((r) => r.id !== id)), []);

  const archiveCard = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!(await confirm({ title: "Archive card", description: "Archive this card? You can restore it later from Trash.", destructive: true, confirmLabel: "Archive" }))) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    try { const res = await fetch(`/api/items/${id}`, { method: "DELETE" }); if (!res.ok) await refetch(); } catch { await refetch(); }
  }, [canEdit, confirm, refetch]);

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
              className={`flex flex-col w-[300px] flex-shrink-0 rounded-lg p-2 transition-colors ${
                isHover ? "outline-2 outline-dashed outline-[var(--os-brand)]" : ""
              }`}
              style={{ background: `${meta.color}0d` /* ~5% tint */ }}
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
              <div className="flex items-center gap-2 px-1 py-1 mb-2">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: `${meta.color}22`, color: meta.color }}
                >
                  {meta.label}
                </span>
                <span className="text-xs text-zinc-500">{cards.length}</span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                    aria-label={`Add card to ${meta.label}`}
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
                    onOpen={onOpenItem ? () => onOpenItem(card.id) : undefined}
                    onPatch={patchCard}
                    onToggleComplete={() => toggleComplete(card)}
                    onAddSubtask={() => addSubtask(card.id, card.status)}
                    onDuplicate={() => duplicateCard(card)}
                    onArchive={() => archiveCard(card.id)}
                    onDeleted={() => removeLocal(card.id)}
                    priorityEnabled={priorityEnabled}
                    tagsEnabled={tagsEnabled}
                    timeTrackingEnabled={timeTrackingEnabled}
                  />
                ))}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    className="w-full text-left text-xs text-zinc-500 hover:text-zinc-900 py-1.5 px-2 rounded hover:bg-zinc-50"
                  >
                    + Add card
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
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
  onOpen,
  onPatch,
  onToggleComplete,
  onAddSubtask,
  onDuplicate,
  onArchive,
  onDeleted,
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
  onOpen?: () => void;
  onPatch: (id: string, apiBody: Record<string, unknown>, localPatch: Partial<BoardItemRow>) => void;
  onToggleComplete: () => void;
  onAddSubtask: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDeleted: () => void;
  priorityEnabled?: boolean;
  tagsEnabled?: boolean;
  timeTrackingEnabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [dueOpen, setDueOpen] = useState(false);
  const moreRef = useRef<ContextMenuHandle>(null);
  // Seed the input from the current title only when entering edit mode — avoids
  // a prop-sync effect (which cascades renders).
  const startEdit = () => { setTitle(card.title); setEditing(true); };

  const done = isDoneStatus(statuses, card.status);
  const due = card.dueAt ? new Date(card.dueAt) : null;
  const overdue = !!due && due < new Date() && !done;
  const tags = card.tags ?? [];
  const fieldChips = chipFields.filter((f) => {
    const v = card.metadata?.[f.key];
    return v != null && v !== "" && (!Array.isArray(v) || v.length > 0);
  });
  const dueInput = due
    ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`
    : "";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const iconBtn = "inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100";

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
      className={`group relative rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm ${
        canEdit && !editing ? "cursor-grab active:cursor-grabbing" : onOpen ? "cursor-pointer" : ""
      } ${isDragging ? "opacity-40" : ""} hover:shadow-sm transition-shadow`}
    >
      {/* Title + action rail */}
      <div className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onClick={stop}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); else if (e.key === "Escape") { setTitle(card.title); setEditing(false); } }}
              onBlur={saveTitle}
              className="w-full bg-white border border-[var(--os-brand)] rounded px-1 py-0.5 text-sm text-zinc-900 focus:outline-none"
            />
          ) : (
            <div className="break-words">{card.title}</div>
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
            timeTrackingEnabled={timeTrackingEnabled}
          />
        </div>
      </div>

      {/* Meta row — Assignee / Due / Priority / Tags + field chips. Set values
          show always; empty affordances appear on hover. */}
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap" onClick={stop}>
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

        {/* Due */}
        <span className={`relative ${due ? "inline-flex" : "hidden group-hover:inline-flex"}`}>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => canEdit && setDueOpen((v) => !v)}
            className={`inline-flex items-center gap-1 rounded text-[10.5px] font-medium ${
              due ? `px-1.5 py-0.5 ${overdue ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-600"}` : "text-zinc-400 hover:text-zinc-600"
            }`}
            title={due ? "Edit due date" : "Set due date"}
          >
            <CalendarPlus className={due ? "w-3 h-3" : "w-[17px] h-[17px]"} />
            {due ? due.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null}
          </button>
          {dueOpen && canEdit ? (
            <input
              type="date"
              autoFocus
              value={dueInput}
              onChange={(e) => { onPatch(card.id, { dueAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }, { dueAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }); setDueOpen(false); }}
              onBlur={() => setDueOpen(false)}
              className="absolute left-0 top-6 z-20 h-7 px-1 text-[12px] border border-zinc-200 rounded bg-white shadow-md focus:outline-none focus:border-[var(--os-brand)]"
            />
          ) : null}
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

      {/* Footer — subtask count (ClickUp) + created date. */}
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
        {subtaskCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Network className="w-3 h-3" />
            {subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}
          </span>
        ) : <span />}
        <span>{new Date(card.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
