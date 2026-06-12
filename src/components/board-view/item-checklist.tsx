"use client";

// ItemChecklist — metadata-backed checklist (metadata.checklist = array of
// { text, done }). Add / toggle / remove; each change persists the whole
// array via onSave. Mirrors the create-task modal's checklist shape.

import { useMemo, useState } from "react";
import { Plus, X, CheckSquare, Square } from "lucide-react";
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

  if (!canEdit && items.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
        Checklist {items.length > 0 ? <span className="text-[10.5px] text-zinc-400 normal-case tracking-normal">{done}/{items.length}</span> : null}
      </h3>
      <div className="space-y-1">
        {items.map((it, idx) => (
          <div key={idx} className="group flex items-center gap-2 text-sm">
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
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-zinc-400"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
