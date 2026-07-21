"use client";

// ItemSubtasks — inline subtask mini-table in the task detail. Subtasks
// are real Items with parentItemId = this item. Lists the children, shows
// a status pill + owner per row, lets you add a new subtask and open one.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ChevronRight, Loader2 } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { isDoneStatus } from "@/lib/board-items-shared";
import { PersonAvatar } from "./assignee-picker";

export function ItemSubtasks({
  item,
  canEdit,
  statuses,
  onOpenItem,
  onCountChange,
  autoFocus = false,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
  /** Reports the loaded subtask count so a parent can collapse/expand the
   *  section (null while still loading — never reported until the first load). */
  onCountChange?: (n: number) => void;
  /** Focus the add-input on mount (used when revealed from an action row). */
  autoFocus?: boolean;
}) {
  const boardId = item.boardId ?? null;
  const [rows, setRows] = useState<BoardItemRow[] | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Report count to the parent whenever the loaded set changes (setState with
  // the same number is a no-op upstream, so this can't loop).
  useEffect(() => { if (rows !== null) onCountChange?.(rows.length); }, [rows, onCountChange]);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

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

  // Type-and-Enter: create with the typed title, append instantly, keep the
  // cursor in the box for rapid-fire entry. Errors surface instead of the old
  // silent no-op. Never sends an empty/"New subtask" placeholder.
  const add = async () => {
    const title = draft.trim();
    if (!title || adding) return;
    if (!boardId) { setError("Couldn't find this task's list. Reopen the task and try again."); return; }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, parentItemId: item.id, status: statuses[0]?.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't add subtask");
        return;
      }
      if (data?.item) setRows((prev) => [...(prev ?? []), data.item as BoardItemRow]);
      setDraft("");
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add subtask");
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
              <Plus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); if (error) setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
                placeholder="Type a subtask and press Enter…"
                className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400"
              />
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400 shrink-0" /> : null}
            </div>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-1.5 text-[11.5px] text-red-500">{error}</p> : null}
    </div>
  );
}
