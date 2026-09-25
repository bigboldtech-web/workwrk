"use client";

// ItemSubtasks — inline subtask mini-table in the task detail. Subtasks
// are real Items with parentItemId = this item. Lists the children, shows
// a status pill + owner per row, lets you add a new subtask and open one.
//
// The children come from GET /api/items/[id]/subtasks (the same children in
// the same order, position then createdAt), not from a read of the whole
// List filtered in the browser. In a List the task is shown in through a
// link (Phase 5b) the read names that List, so each child is projected for
// it, and a new subtask is POSTed to that List, which creates it in the
// parent's home with its parent: it appears wherever its parent does.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ChevronRight } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { isDoneStatus } from "@/lib/board-items-shared";
import { accessMessage } from "@/lib/access-message";
import { PersonAvatar } from "./assignee-picker";

export function ItemSubtasks({
  item,
  canEdit,
  statuses,
  onOpenItem,
  onCountChange,
  autoFocus = false,
  contextBoardId = null,
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
  /**
   * Phase 5b: the List the task is open in THROUGH A LINK, when it is. The
   * read and the create name it; in the home the body is today's exactly.
   */
  contextBoardId?: string | null;
}) {
  const boardId = contextBoardId ?? item.boardId ?? null;
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
    try {
      const res = await fetch(
        `/api/items/${item.id}/subtasks${contextBoardId ? `?list=${encodeURIComponent(contextBoardId)}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) { setRows([]); return; }
      const data = await res.json();
      setRows(Array.isArray(data.subtasks) ? (data.subtasks as BoardItemRow[]) : []);
    } catch { setRows([]); }
  }, [item.id, contextBoardId]);

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
        setError(accessMessage(data, "Couldn't add subtask"));
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
        Subtasks {list.length > 0 ? <span className="text-xs text-zinc-400 normal-case tracking-normal">{doneCount}/{list.length}</span> : null}
      </h3>
      {rows === null ? (
        <div className="py-1"><Dots variant="pending" label="Loading subtasks" className="text-ink-3" /></div>
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
                <span className={`flex-1 text-base truncate ${isDoneStatus(statuses, r.status) ? "line-through text-zinc-400" : "text-zinc-800"}`}>{r.title}</span>
                {st ? <span className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: `${st.color}22`, color: st.color }}>{st.label}</span> : null}
                {r.owner ? <span className="shrink-0"><PersonAvatar person={{ ...r.owner, email: null }} size={18} /></span> : null}
              </button>
            );
          })}
          {list.length === 0 ? <div className="px-3 py-2 text-base text-zinc-400">No subtasks yet.</div> : null}
          {canEdit ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <Plus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); if (error) setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
                placeholder="Type a subtask and press Enter…"
                className="flex-1 text-base bg-transparent outline-none placeholder:text-zinc-400"
              />
              {adding ? <Dots variant="pending" label="Adding" className="shrink-0 text-ink-3" /> : null}
            </div>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-1.5 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
