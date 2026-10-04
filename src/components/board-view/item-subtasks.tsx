"use client";

// ItemSubtasks — inline subtask mini-table in the task detail. Subtasks
// are real Items with parentItemId = this item. Lists the children, shows
// a status pill + owner per row, lets you add a new subtask and open one.
//
// The children come from GET /api/items/[id]/subtasks (the same children in
// the same order, position then id), not from a read of the whole
// List filtered in the browser. In a List the task is shown in through a
// link (Phase 5b) the read names that List, so each child is projected for
// it, and a new subtask is POSTed to that List, which creates it in the
// parent's home with its parent: it appears wherever its parent does.
//
// ORDER. Subtasks are dragged up and down by the handle (or moved with Alt
// and the arrow keys), landing at the midpoint of their new neighbours
// (src/lib/work/reorder.ts); siblings that share a position are renumbered
// under their parent first. Their order is the HOME List's, so in a List the
// task is only linked into they keep it and cannot be dragged there.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ChevronRight, GripVertical } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { isDoneStatus } from "@/lib/board-items-shared";
import { accessMessage } from "@/lib/access-message";
import { subtaskCreateBody, type LoadedListSettings } from "@/lib/list-defaults-client";
import { PersonAvatar } from "./assignee-picker";
import { dropSide, indexFor, planDrop } from "@/lib/work/reorder";

export function ItemSubtasks({
  item,
  canEdit,
  canAdd,
  statuses,
  onOpenItem,
  onCountChange,
  autoFocus = false,
  contextBoardId = null,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  /**
   * May the viewer add subtasks and reorder them? Both write the List (POST
   * items, PUT order need Can edit on it), so an assignee who may change
   * this task still may not. Absent: canEdit.
   */
  canAdd?: boolean;
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

  // The HOME List's settings (gap 14): a subtask is created there, so its
  // default status, and under a linked parent its statuses, come from it.
  // Until they answer, or when the home is not readable, the body is today's
  // (outside a link) or names no status (under one).
  const homeBoardId = item.boardId ?? null;
  const [homeSettings, setHomeSettings] = useState<LoadedListSettings | null>(null);
  useEffect(() => {
    if (!canEdit || !homeBoardId) return;
    let alive = true;
    fetch(`/api/boards/${homeBoardId}/settings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setHomeSettings({
          boardId: homeBoardId,
          defaults: d.defaults && typeof d.defaults === "object" ? d.defaults : {},
          statuses: Array.isArray(d.statuses) ? d.statuses : [],
        });
      })
      .catch(() => { /* the body stays today's */ });
    return () => { alive = false; };
  }, [canEdit, homeBoardId]);

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
        body: JSON.stringify(subtaskCreateBody({
          title,
          parentItemId: item.id,
          homeBoardId,
          linked: !!contextBoardId && contextBoardId !== homeBoardId,
          firstStatus: statuses[0]?.value,
          home: homeSettings,
        })),
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

  // ── Order ──────────────────────────────────────────────────────────
  const mayAdd = canAdd ?? canEdit;
  const canReorder = mayAdd && !!homeBoardId && !(contextBoardId && contextBoardId !== homeBoardId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; side: "before" | "after" } | null>(null);
  /** Move one subtask to `index` among the others; saved, or put back with the reason. */
  const moveTo = async (id: string, index: number) => {
    const plan = planDrop(list, id, index);
    if (plan.kind === "none" || !homeBoardId) return;
    const others = list.filter((r) => r.id !== id);
    const moved = list.find((r) => r.id === id);
    if (!moved) return;
    const at = Math.max(0, Math.min(index, others.length));
    setRows([...others.slice(0, at), plan.kind === "position" ? { ...moved, position: plan.position } : moved, ...others.slice(at)]);
    setError(null);
    try {
      const res = plan.kind === "renumber"
        ? await fetch(`/api/boards/${homeBoardId}/order`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ movedId: id, afterId: plan.afterId, beforeId: plan.beforeId, parentId: item.id }),
          })
        : await fetch(`/api/items/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ position: plan.position }),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(accessMessage(d, "Couldn't save the new order."));
        await load();
        return;
      }
      if (plan.kind === "renumber") await load();
    } catch {
      setError("Couldn't save the new order. Check your connection and try again.");
      await load();
    }
  };

  // Nothing to show and nothing they may add (a reader, or someone who may
  // change this task only because it is assigned to them): no section at all.
  if (!mayAdd && list.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
        Subtasks {list.length > 0 ? <span className="text-xs text-zinc-400 normal-case tracking-normal">{doneCount}/{list.length}</span> : null}
      </h3>
      {rows === null ? (
        <div className="py-1"><Dots variant="pending" label="Loading subtasks" className="text-ink-3" /></div>
      ) : (
        <div data-subtask-list className="rounded-lg border border-line divide-y divide-line-soft">
          {list.map((r, i) => {
            const st = r.status ? statuses.find((o) => o.value === r.status) : null;
            const side = over && over.id === r.id && dragId && dragId !== r.id ? over.side : null;
            return (
              <div
                key={r.id}
                draggable={canReorder}
                onDragStart={(e) => {
                  if (!canReorder) return;
                  e.dataTransfer.effectAllowed = "move";
                  try { e.dataTransfer.setData("text/plain", r.id); } catch { /* a browser that refuses still drags */ }
                  setDragId(r.id);
                }}
                onDragOver={(e) => {
                  if (!canReorder || !dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const next = dropSide(e.clientY, e.currentTarget.getBoundingClientRect());
                  setOver((cur) => (cur && cur.id === r.id && cur.side === next ? cur : { id: r.id, side: next }));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) void moveTo(dragId, indexFor(list, dragId, r.id, dropSide(e.clientY, e.currentTarget.getBoundingClientRect())));
                  setDragId(null);
                  setOver(null);
                }}
                onDragEnd={() => { setDragId(null); setOver(null); }}
                className={`group/sub flex items-center ${dragId === r.id ? "opacity-40" : ""} ${
                  side === "before" ? "shadow-[inset_0_2px_0_0_var(--os-brand)]" : side === "after" ? "shadow-[inset_0_-2px_0_0_var(--os-brand)]" : ""
                }`}
              >
                {canReorder ? (
                  <span className="pl-1.5 text-ink-3 opacity-0 group-hover/sub:opacity-100 cursor-grab" title="Drag to reorder" aria-hidden>
                    <GripVertical className="w-3 h-3" />
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenItem?.(r.id)}
                  data-subtask-id={r.id}
                  onKeyDown={(e) => {
                    // Alt with an arrow moves it one place, for anyone not using a mouse.
                    if (!canReorder || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                    e.preventDefault();
                    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
                    if (to < 0 || to >= list.length) return;
                    const host = e.currentTarget.closest("[data-subtask-list]");
                    void moveTo(r.id, to);
                    // Moving a row's node blurs it in some browsers: focus stays on what moved.
                    requestAnimationFrame(() => {
                      host?.querySelector<HTMLButtonElement>(`[data-subtask-id="${r.id}"]`)?.focus();
                    });
                  }}
                  aria-keyshortcuts={canReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                  className={`min-w-0 flex-1 flex items-center gap-2 ${canReorder ? "pl-1.5" : "pl-3"} pr-3 py-2 text-left hover:bg-hover`}
                >
                  <ChevronRight className="w-3 h-3 text-ink-3 shrink-0" />
                  <span className={`flex-1 text-base truncate ${isDoneStatus(statuses, r.status) ? "line-through text-ink-3" : "text-ink"}`}>{r.title}</span>
                  {st ? <span className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: `${st.color}22`, color: st.color }}>{st.label}</span> : null}
                  {r.owner ? <span className="shrink-0"><PersonAvatar person={{ ...r.owner, email: null }} size={18} /></span> : null}
                </button>
              </div>
            );
          })}
          {list.length === 0 ? <div className="px-3 py-2 text-base text-zinc-400">No subtasks yet.</div> : null}
          {mayAdd ? (
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
