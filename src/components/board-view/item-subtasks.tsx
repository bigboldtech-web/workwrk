"use client";

// ItemSubtasks — inline subtask mini-table in the task detail. Subtasks
// are real Items with parentItemId = this item. Lists the children, shows
// a status pill + owner per row, lets you add a new subtask and open one.

import { useCallback, useEffect, useState } from "react";
import { Plus, ChevronRight, Loader2 } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { isDoneStatus } from "@/lib/board-items-shared";
import { PersonAvatar } from "./assignee-picker";

export function ItemSubtasks({
  item,
  canEdit,
  statuses,
  onOpenItem,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
}) {
  const boardId = item.boardId ?? null;
  const [rows, setRows] = useState<BoardItemRow[] | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!boardId) { setRows([]); return; }
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, { cache: "no-store" });
      if (!res.ok) { setRows([]); return; }
      const data = await res.json();
      const all: BoardItemRow[] = Array.isArray(data.items) ? data.items : [];
      setRows(all.filter((r) => r.parentItemId === item.id));
    } catch { setRows([]); }
  }, [boardId, item.id]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const title = draft.trim();
    if (!title || !boardId || adding) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, parentItemId: item.id, status: statuses[0]?.value }),
      });
      if (res.ok) { setDraft(""); await load(); }
    } finally { setAdding(false); }
  };

  const list = rows ?? [];
  const doneCount = list.filter((r) => isDoneStatus(statuses, r.status)).length;

  if (!canEdit && list.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
        Subtasks {list.length > 0 ? <span className="text-[10.5px] text-zinc-400 normal-case tracking-normal">{doneCount}/{list.length}</span> : null}
      </h3>
      {rows === null ? (
        <div className="flex items-center gap-2 text-[12.5px] text-zinc-400 py-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : (
        <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {list.map((r) => {
            const st = r.status ? statuses.find((o) => o.value === r.status) : null;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenItem?.(r.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50"
              >
                <ChevronRight className="w-3 h-3 text-zinc-300 shrink-0" />
                <span className={`flex-1 text-[13px] truncate ${isDoneStatus(statuses, r.status) ? "line-through text-zinc-400" : "text-zinc-800"}`}>{r.title}</span>
                {st ? <span className="text-[10.5px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: `${st.color}22`, color: st.color }}>{st.label}</span> : null}
                {r.owner ? <span className="shrink-0"><PersonAvatar person={{ ...r.owner, email: null }} size={18} /></span> : null}
              </button>
            );
          })}
          {list.length === 0 ? <div className="px-3 py-2 text-[12.5px] text-zinc-400">No subtasks yet.</div> : null}
          {canEdit ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <Plus className="w-3.5 h-3.5 text-zinc-400" />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                placeholder="Add a subtask…"
                className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400"
              />
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" /> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
