"use client";

// useTask(itemId), one task, loaded once, for all three hosts.
//
// The drawer, the page and the Inbox pane each used to fetch and patch a task
// their own way: three optimistic merges, three archive handlers, three ideas
// of what `canEdit` meant. This is the one of each.
//
// The two rules it exists to hold:
//
//   MERGE, NEVER BLIND-REPLACE. `PATCH /api/items/[id]` answers with the full
//   enriched row, but a failed or lean response must not strip counts and
//   links off the cached item. Every write merges over what is already there,
//   and a failure re-reads rather than guessing (data-integrity rule).
//
//   THE ROLE COMES FROM THE TASK. `decision.role` is the gate's own answer on
//   the item ref, so the drawer's editability no longer arrives from the host
//   page's `canEditSpace` (spaces-boards High #2) and an assignee is no longer
//   handed a fully editable task whose every save 403s.
//
// Realtime: the shell's SSE `item` event bumps `refreshToken`, which re-reads
// the task and the thread. While the tab is visible the page also polls every
// 30s, because the event only reaches people the server can tell are
// interested (owner, assignees, watchers, commenters).

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import type { ItemDecision } from "@/lib/item-role";
import type { ItemBreadcrumb } from "@/lib/item-gate";
import type { DetailPatch, ItemModuleGating } from "@/components/board-view/board-item-detail";
import { WINDOW_EVENTS, emitItemChanged, type RealtimeEvent } from "@/lib/realtime-events";

export interface TaskBoardCtx {
  id: string;
  slug: string;
  name: string;
  spaceId: string | null;
  folderId: string | null;
  fields: FieldDef[];
  statuses: StatusOption[];
  /** The List's sharing state, so "…" > Share can open the one dialog. */
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
  ownerId?: string | null;
}

/** Just enough of a person to name them. */
export interface TaskPerson {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
}

export interface UseTask {
  item: BoardItemRow | null;
  board: TaskBoardCtx | null;
  decision: ItemDecision | null;
  breadcrumb: ItemBreadcrumb | null;
  parent: { id: string; title: string } | null;
  watcherIds: string[];
  createdById: string | null;
  /** The author, for the meta line. Null when the CREATED row is gone. */
  createdBy: TaskPerson | null;
  /** The List owner, for the read-only banner. Null when the List has none. */
  listOwner: TaskPerson | null;
  /** The Space's module toggles. Undefined on a server that predates them. */
  moduleGating: ItemModuleGating | undefined;
  loading: boolean;
  /** A load failure that is not a 404. */
  error: string | null;
  /** Deleted, or no role: one state on purpose, so a 404 confirms nothing. */
  missing: boolean;
  /**
   * The task exists and the viewer may not open it.
   *
   * Kept apart from `missing` because the two are different sentences in the
   * user's words: "This task was deleted" and "You no longer have access to
   * this". The server has always answered them differently (404 vs 403); the
   * page merged them into one sentence that was wrong half the time.
   */
  denied: boolean;
  patch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => Promise<void>;
  /** What the hosts' AutosaveIndicator shows. Every write goes through patch. */
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  reload: () => Promise<void>;
  /** Bumped on every realtime event and poll, for the thread to re-read. */
  refreshToken: number;
}

interface TaskResponse {
  item: BoardItemRow;
  board: TaskBoardCtx | null;
  decision?: ItemDecision;
  breadcrumb?: ItemBreadcrumb;
  parent?: { id: string; title: string } | null;
  watcherIds?: string[];
  createdById?: string | null;
  createdBy?: TaskPerson | null;
  listOwner?: TaskPerson | null;
  moduleGating?: ItemModuleGating;
}

const PAGE_POLL_MS = 30_000;

export function useTask(itemId: string | null | undefined, opts: { poll?: boolean } = {}): UseTask {
  const [data, setData] = useState<TaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // The in-flight write count, so a realtime echo never clobbers a save that
  // has not answered yet.
  const writing = useRef(0);

  const reload = useCallback(async () => {
    if (!itemId) return;
    try {
      const res = await fetch(`/api/items/${itemId}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) setMissing(true);
        else if (res.status === 403) setDenied(true);
        else setError("Couldn't load this task");
        return;
      }
      setMissing(false);
      setDenied(false);
      setError(null);
      setData((await res.json()) as TaskResponse);
    } catch {
      setError("Couldn't load this task");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    setMissing(false);
    setDenied(false);
    void reload();
  }, [itemId, reload]);

  const patch = useCallback(
    async (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => {
      if (!itemId) return;
      // `metadataPatch` is a wire field, not a column: merged into the cached
      // `metadata` for the optimistic render and never pasted onto the row.
      setData((prev) => {
        if (!prev) return prev;
        const { metadataPatch, ...rest } = body as typeof body & { metadataPatch?: Record<string, unknown> };
        let metadata = prev.item.metadata;
        if (metadataPatch) {
          const next = { ...((metadata as Record<string, unknown> | null) ?? {}) };
          for (const [k, v] of Object.entries(metadataPatch)) {
            if (v === null) delete next[k];
            else next[k] = v;
          }
          metadata = next;
        }
        return { ...prev, item: { ...prev.item, metadata, ...rest, ...optimistic } as BoardItemRow };
      });
      writing.current += 1;
      setSaveStatus("saving");
      // KEEPALIVE. The title and the description flush themselves from an
      // unmount effect (Esc, the drawer's X, a click back to the list, a tab
      // close), and a plain fetch fired from there is cancelled the moment the
      // document goes away, so the words were lost with no record anywhere.
      // keepalive lets the request outlive the page. Its payload cap is 64KB
      // and a request over it is REJECTED outright, which would be the same
      // data loss by another route, so a big body goes as an ordinary fetch.
      const wire = JSON.stringify(body);
      try {
        const res = await fetch(`/api/items/${itemId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: wire,
          keepalive: wire.length < 60_000,
        });
        const payload = await res.json().catch(() => ({}));
        setSaveStatus(res.ok ? "saved" : "error");
        if (res.ok) {
          setLastSavedAt(new Date());
          // The host list is in another App Router slot: props cannot reach
          // it, and the SSE producer deliberately skips the actor. One window
          // event keeps the row under the drawer honest.
          emitItemChanged(itemId, (payload.item?.boardId as string | undefined) ?? null);
        }
        if (res.ok && payload.item) {
          // Merge: a lean response must never strip enriched fields.
          setData((prev) => (prev ? { ...prev, item: { ...prev.item, ...payload.item } } : prev));
          // A move or a watcher write changes the gate's answer and the
          // breadcrumb, so re-read those rather than inventing them.
          if (body.boardId || body.watcherIds) await reload();
        } else {
          await reload();
        }
      } catch {
        setSaveStatus("error");
        await reload();
      } finally {
        writing.current -= 1;
      }
    },
    [itemId, reload],
  );

  // Realtime: the one `item` event, debounced, and never while a write is out.
  useEffect(() => {
    if (!itemId) return;
    let timer: number | null = null;
    const onEvent = (e: Event) => {
      const ev = (e as CustomEvent<RealtimeEvent & { local?: boolean }>).detail;
      if (!ev || ev.type !== "item" || ev.itemId !== itemId) return;
      // This tab's own write: the merge already happened here.
      if (ev.local) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (writing.current > 0) return;
        void reload();
        setRefreshToken((n) => n + 1);
      }, 300);
    };
    window.addEventListener(WINDOW_EVENTS.realtime, onEvent as EventListener);
    return () => {
      window.removeEventListener(WINDOW_EVENTS.realtime, onEvent as EventListener);
      if (timer) window.clearTimeout(timer);
    };
  }, [itemId, reload]);

  // The fallback the spec names: the page polls every 30s while VISIBLE, so a
  // background tab costs nothing.
  useEffect(() => {
    if (!itemId || !opts.poll) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || writing.current > 0) return;
      void reload();
      setRefreshToken((n) => n + 1);
    };
    const id = window.setInterval(tick, PAGE_POLL_MS);
    return () => window.clearInterval(id);
  }, [itemId, opts.poll, reload]);

  return {
    item: data?.item ?? null,
    board: data?.board ?? null,
    decision: data?.decision ?? null,
    breadcrumb: data?.breadcrumb ?? null,
    parent: data?.parent ?? null,
    watcherIds: data?.watcherIds ?? [],
    createdById: data?.createdById ?? null,
    createdBy: data?.createdBy ?? null,
    listOwner: data?.listOwner ?? null,
    moduleGating: data?.moduleGating,
    loading,
    error,
    missing,
    denied,
    patch,
    saveStatus,
    lastSavedAt,
    reload,
    refreshToken,
  };
}
