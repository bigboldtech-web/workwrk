"use client";

// TaskListsChip: where a task appears, in the task's own header (decision 7).
//
// ClickUp puts a "+N" beside the List crumb of a task that lives in more than
// one List; opening it lists every List, home first. That is this chip, and it
// renders NOTHING for a task that is in no other List, so a task with no links
// looks exactly as it did before links existed.
//
// Every row names only what the viewer may see (GET /api/items/[id]/lists):
// the home is a link when they can read it and a sentence when they cannot,
// and a List they cannot read is not in the answer at all. "Remove" appears
// only where the server said this viewer may remove it (canRemove), and never
// for a subtask shown through its parent, which leaves with its parent.
//
// Removing it from the List it is OPEN in (the "Here" row) goes through the
// host's one onRemovedFromList path, the same one the "…" menu's row uses, so
// the drawer never keeps showing a context the task has just left.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Layers, Plus, X } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { useLayer } from "@/components/layout/os/shell-context";
import { accessMessage } from "@/lib/access-message";
import { emitItemChanged, WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { AddToListPicker, type TaskListsAnswer } from "./add-to-list-picker";

/**
 * GET /api/items/[id]/lists, kept fresh: re-read when the task changes (a
 * link added or removed here or in another tab), and on demand.
 */
export function useTaskLists(itemId: string | null | undefined): {
  data: TaskListsAnswer | null;
  loaded: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<TaskListsAnswer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!itemId) return;
    try {
      const res = await fetch(`/api/items/${itemId}/lists`, { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as TaskListsAnswer);
    } catch {
      // A failed read keeps what was shown; the next event re-reads.
    } finally {
      setLoaded(true);
    }
  }, [itemId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!itemId) return;
    const onEvent = (e: Event) => {
      const ev = (e as CustomEvent<RealtimeEvent & { listIds?: string[]; leftListIds?: string[] }>).detail;
      if (!ev || ev.type !== "item" || ev.itemId !== itemId) return;
      // Only a link change moves this chip; an edit to the title does not.
      if (ev.listIds || ev.leftListIds) void reload();
    };
    window.addEventListener(WINDOW_EVENTS.realtime, onEvent as EventListener);
    return () => window.removeEventListener(WINDOW_EVENTS.realtime, onEvent as EventListener);
  }, [itemId, reload]);
  return { data, loaded, reload };
}

export function TaskListsChip({
  itemId,
  lists,
  contextBoardId,
  onRemovedHere,
  homeBoardId = null,
}: {
  itemId: string;
  lists: ReturnType<typeof useTaskLists>;
  /** The List the task is open IN through a link; null in its home. */
  contextBoardId: string | null;
  /** The host's one path for "it just left the List it is open in". */
  onRemovedHere: () => void;
  homeBoardId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayer(open, { kind: "popover", close: () => setOpen(false) });
  const data = lists.data;
  if (!data) return null;
  if (data.linked.length === 0 && !data.viaParentId) return null;

  const count = data.linked.length;
  const remove = async (boardId: string) => {
    if (busy) return;
    setBusy(boardId);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/links/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          accessMessage(body, "Couldn't take the task out of that List.", {
            list_read_only: "You need edit access to that List or to this task's home List to take it out.",
          }),
        );
        return;
      }
      if (boardId === contextBoardId) {
        setOpen(false);
        onRemovedHere();
        return;
      }
      emitItemChanged(itemId, homeBoardId, false, { leftListIds: [boardId] });
      await lists.reload();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setError(null); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`This task is in ${count + 1} Lists`}
        className="inline-flex h-6 items-center gap-1 rounded-[5px] bg-subtle px-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <Layers className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />+{count}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label={`In ${count + 1} Lists`}
            className="absolute start-0 top-full z-[61] mt-1 w-[300px] rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]"
          >
            <div className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-ink-3">In {count + 1} Lists</div>
            {data.viaParentId ? (
              <p className="px-2 pb-1 text-xs text-ink-2">This subtask appears wherever its parent does.</p>
            ) : null}
            <ul className="space-y-0.5">
              <li className="flex min-h-9 items-center gap-2 rounded-md px-2">
                {data.home.readable ? (
                  <Link href={`/boards/${data.home.slug}`} prefetch={false} className="min-w-0 flex-1 truncate text-base text-ink hover:underline">
                    {data.home.name}
                  </Link>
                ) : data.home.name ? (
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{data.home.name}</span>
                ) : (
                  <span className="min-w-0 flex-1 text-sm text-ink-2">Its home List isn&apos;t shared with you</span>
                )}
                <span className="shrink-0 rounded-[4px] bg-subtle px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-ink-2">Home</span>
              </li>
              {data.linked.map((l) => (
                <li key={l.boardId} className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-hover">
                  <Link href={`/boards/${l.slug}`} prefetch={false} className="min-w-0 flex-1 truncate text-base text-ink hover:underline">
                    {l.name}
                  </Link>
                  {l.boardId === contextBoardId ? (
                    <span className="shrink-0 text-xs text-ink-3">Here</span>
                  ) : null}
                  {l.canRemove ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void remove(l.boardId)}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-active hover:text-ink disabled:opacity-50"
                      aria-label={`Remove from ${l.name}`}
                    >
                      {busy === l.boardId ? <Dots variant="pending" /> : <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />}
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {error ? <p className="px-2 py-1.5 text-xs text-danger-text" role="alert">{error}</p> : null}
            {data.canShare ? (
              <div className="relative mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  Add to another List
                </button>
                <AddToListPicker
                  open={adding}
                  onClose={() => setAdding(false)}
                  itemId={itemId}
                  homeBoardId={homeBoardId}
                  align="start"
                  onAdded={() => void lists.reload()}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </span>
  );
}
