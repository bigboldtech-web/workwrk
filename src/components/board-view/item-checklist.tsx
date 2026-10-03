"use client";

// ItemChecklist, metadata-backed checklist (metadata.checklist = array of
// { text, done }). Add / toggle / remove / reorder; each change persists the
// whole array via onSave. Mirrors the create-task modal's checklist shape.
// An item is dragged up or down by its handle, or moved with Alt and the
// arrow keys; the array order IS the checklist's order.

import { useMemo, useRef, useState } from "react";
import { Plus, X, CheckSquare, Square, GripVertical } from "lucide-react";
import type { BoardItemRow } from "@/lib/board-items-shared";

type ChecklistItem = { text: string; done: boolean };

function parse(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is ChecklistItem => !!x && typeof x === "object" && typeof (x as ChecklistItem).text === "string")
    .map((x) => ({ text: x.text, done: !!x.done }));
}

export function ItemChecklist({ item, canEdit, onSave }: { item: BoardItemRow; canEdit: boolean; onSave: (checklist: ChecklistItem[]) => void }) {
  const items = useMemo(() => parse(item.metadata?.checklist), [item.metadata]);
  const [draft, setDraft] = useState("");

  const done = items.filter((i) => i.done).length;
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onSave([...items, { text: t, done: false }]);
    setDraft("");
  };
  const toggle = (idx: number) => onSave(items.map((i, n) => (n === idx ? { ...i, done: !i.done } : i)));
  const remove = (idx: number) => onSave(items.filter((_, n) => n !== idx));
  // Move item `from` so it lands at `to` (an index in the list without it).
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || from >= items.length) return;
    const others = items.filter((_, n) => n !== from);
    const at = Math.max(0, Math.min(to, others.length));
    onSave([...others.slice(0, at), items[from], ...others.slice(at)]);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [over, setOver] = useState<{ idx: number; side: "before" | "after" } | null>(null);
  /** Where a drop on item `idx` lands, counted in the list without the dragged item. */
  const landing = (from: number, idx: number, side: "before" | "after") => {
    const target = side === "before" ? idx : idx + 1;
    return from < target ? target - 1 : target;
  };

  if (!canEdit && items.length === 0) return null;

  return (
    <div ref={rootRef}>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
        Checklist {items.length > 0 ? <span className="text-xs text-zinc-400 normal-case tracking-normal">{done}/{items.length}</span> : null}
      </h3>
      <div className="space-y-1">
        {items.map((it, idx) => (
          <div
            key={idx}
            draggable={canEdit}
            onDragStart={(e) => {
              if (!canEdit) return;
              e.dataTransfer.effectAllowed = "move";
              try { e.dataTransfer.setData("text/plain", String(idx)); } catch { /* still drags */ }
              setDragIdx(idx);
            }}
            onDragOver={(e) => {
              if (!canEdit || dragIdx === null) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const side = e.clientY < r.top + r.height / 2 ? "before" : "after";
              setOver((cur) => (cur && cur.idx === idx && cur.side === side ? cur : { idx, side }));
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null && over) move(dragIdx, landing(dragIdx, over.idx, over.side));
              setDragIdx(null);
              setOver(null);
            }}
            onDragEnd={() => { setDragIdx(null); setOver(null); }}
            className={`group flex items-center gap-2 text-xs ${dragIdx === idx ? "opacity-40" : ""} ${
              over && over.idx === idx && dragIdx !== null && dragIdx !== idx
                ? over.side === "before" ? "shadow-[inset_0_2px_0_0_var(--os-brand)]" : "shadow-[inset_0_-2px_0_0_var(--os-brand)]"
                : ""
            }`}
          >
            {canEdit ? (
              <button
                type="button"
                className="-ml-1 text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab"
                aria-label={`Move "${it.text}" (Alt with an arrow key moves it)`}
                title="Drag to reorder"
                data-grip-index={idx}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  if (!e.altKey) return;
                  e.preventDefault();
                  const to = e.key === "ArrowUp" ? idx - 1 : idx + 1;
                  if (to < 0 || to >= items.length) return;
                  move(idx, to);
                  // Rows are keyed by place, so focus follows the item it moved.
                  requestAnimationFrame(() => {
                    rootRef.current?.querySelector<HTMLButtonElement>(`[data-grip-index="${to}"]`)?.focus();
                  });
                }}
              >
                <GripVertical className="w-3 h-3" />
              </button>
            ) : null}
            <button type="button" onClick={() => canEdit && toggle(idx)} disabled={!canEdit} className="text-zinc-400 hover:text-[var(--os-brand)] disabled:hover:text-zinc-400">
              {it.done ? <CheckSquare className="w-4 h-4 text-[var(--os-brand)]" /> : <Square className="w-4 h-4" />}
            </button>
            <span className={`flex-1 ${it.done ? "line-through text-zinc-400" : "text-zinc-700"}`}>{it.text}</span>
            {canEdit ? (
              <button type="button" onClick={() => remove(idx)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <Plus className="w-3.5 h-3.5 text-zinc-400" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              onBlur={add}
              placeholder="Add a checklist item…"
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-zinc-400"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
