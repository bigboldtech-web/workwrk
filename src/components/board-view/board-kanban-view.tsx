"use client";

// BoardKanbanView — Phase 3c KANBAN renderer for studio-item Boards.
//
// One column per status option from DEFAULT_STATUS_OPTIONS. Cards
// inside a column show the title, owner avatar, and created date.
// Native HTML5 drag-and-drop lets the user re-status a row by
// dropping it into another column; uses optimistic update + refetch
// on failure (same pattern as BoardTableView).
//
// Design rules from the 2026-06-02 Monday-clean spec:
//   - Column header = status pill + count + "+" button. No border on
//     the header; column has a subtle surface tint instead.
//   - Card = rounded-md surface, no left-border color rail, title
//     + small footer row with owner + date.
//   - Drop target highlight = 2px dashed brand outline on hover.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow } from "@/lib/board-items-shared";

interface BoardKanbanViewProps {
  boardId: string;
  initialItems: BoardItemRow[];
  canEdit: boolean;
  onOpenItem?: (itemId: string) => void;
}

const STATUS_ORDER = DEFAULT_STATUS_OPTIONS.map((o) => o.value);
const STATUS_LOOKUP: Record<string, { label: string; color: string }> = Object.fromEntries(
  DEFAULT_STATUS_OPTIONS.map((o) => [o.value, { label: o.label, color: o.color }]),
);

export function BoardKanbanView({ boardId, initialItems, canEdit, onOpenItem }: BoardKanbanViewProps) {
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);

  useEffect(() => { setItems(initialItems); }, [initialItems]);

  const grouped = useMemo(() => {
    const map = new Map<string, BoardItemRow[]>();
    for (const s of STATUS_ORDER) map.set(s, []);
    // Any rows with statuses outside the default palette get bucketed
    // into the first column so they don't disappear from the board.
    for (const row of items) {
      const bucket = row.status && map.has(row.status) ? row.status : STATUS_ORDER[0];
      map.get(bucket)!.push(row);
    }
    return map;
  }, [items]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.items) setItems(data.items);
    } catch {}
  }, [boardId]);

  const moveTo = useCallback(async (id: string, newStatus: string) => {
    if (!canEdit) return;
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to move card");
        await refetch();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move card");
      await refetch();
    }
  }, [canEdit, refetch]);

  const addCard = useCallback(async (status: string) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New item", status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to add card");
        return;
      }
      setItems((prev) => [...prev, data.item as BoardItemRow]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    }
  }, [boardId, canEdit]);

  return (
    <div className="space-y-2">
      {error ? (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 rounded-md flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_LOOKUP[status];
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
                if (card && card.status !== status) void moveTo(dragId, status);
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
                    card={card}
                    canEdit={canEdit}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(null); setHoverColumn(null); }}
                    isDragging={dragId === card.id}
                    onOpen={onOpenItem ? () => onOpenItem(card.id) : undefined}
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
  card,
  canEdit,
  onDragStart,
  onDragEnd,
  isDragging,
  onOpen,
}: {
  card: BoardItemRow;
  canEdit: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  onOpen?: () => void;
}) {
  return (
    <div
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ${
        canEdit ? "cursor-grab active:cursor-grabbing" : onOpen ? "cursor-pointer" : ""
      } ${isDragging ? "opacity-40" : ""} hover:shadow-sm transition-shadow`}
    >
      <div className="break-words">{card.title}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
        {card.owner ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-zinc-100 text-[10px] font-medium">
              {`${card.owner.firstName?.[0] ?? ""}${card.owner.lastName?.[0] ?? ""}`.toUpperCase() || "?"}
            </span>
            <span className="truncate max-w-[120px]">
              {card.owner.firstName} {card.owner.lastName}
            </span>
          </span>
        ) : (
          <span>Unassigned</span>
        )}
        <span>{new Date(card.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
