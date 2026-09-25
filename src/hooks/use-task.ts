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
import {
  describeTaskLoadFailure,
  missingReasonFrom,
  type ItemFailureBody,
  type TaskMissingReason,
} from "@/lib/task-load-failure";

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

/**
 * Phase 5b: which List the task body is for. `linked` means the task is open
 * in a List it is shown in THROUGH A LINK (`?list=`): the body carries that
 * List's fields and values, and every write names it.
 */
export interface TaskContext {
  boardId: string;
  kind: "home" | "linked";
  home: { id: string; slug: string; name: string; readable: true } | { readable: false };
  homeStatus: StatusOption | null;
  homeStatuses?: StatusOption[];
}

/** What a write answered, for the one caller that must know (a Connect cell). */
export type TaskPatchResult = { ok: true } | { ok: false; status: number; payload: unknown };

export interface UseTask {
  item: BoardItemRow | null;
  board: TaskBoardCtx | null;
  /** Phase 5b: the List this body is for; null on a server that predates it. */
  context: TaskContext | null;
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
  /**
   * A load failure that is neither 404 nor 403, as one sentence that names
   * the cause (src/lib/task-load-failure.ts): the session lapsed, the server
   * failed with a status, the request never arrived. Never "could not load".
   */
  error: string | null;
  /** The HTTP status behind `error` (0 when the fetch itself threw). */
  errorStatus: number | null;
  /** What the server said, when it said anything a person can act on. */
  errorDetail: string | null;
  /** Deleted, or no role: one state on purpose, so a 404 confirms nothing. */
  missing: boolean;
  /**
   * The one 404 the server names: the id is a row on the legacy task list
   * that has not been migrated onto the Item model in this workspace.
   */
  missingReason: TaskMissingReason | null;
  /**
   * The task exists and the viewer may not open it.
   *
   * Kept apart from `missing` because the two are different sentences in the
   * user's words: "This task was deleted" and "You no longer have access to
   * this". The server has always answered them differently (404 vs 403); the
   * page merged them into one sentence that was wrong half the time.
   */
  denied: boolean;
  patch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => Promise<TaskPatchResult>;
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
  context?: TaskContext | null;
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

export function useTask(itemId: string | null | undefined, opts: { poll?: boolean; listId?: string | null } = {}): UseTask {
  // A task opened in a List it is shown in through a link (`?list=`): the
  // read asks for that List's body. Absent: exactly today's read.
  const listId = opts.listId ?? null;
  const readUrl = itemId ? `/api/items/${itemId}${listId ? `?list=${encodeURIComponent(listId)}` : ""}` : null;
  const [data, setData] = useState<TaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [missingReason, setMissingReason] = useState<TaskMissingReason | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // The in-flight write count, so a realtime echo never clobbers a save that
  // has not answered yet.
  const writing = useRef(0);

  const reload = useCallback(async () => {
    if (!itemId || !readUrl) return;
    try {
      const res = await fetch(readUrl, { cache: "no-store" });
      if (!res.ok) {
        // The body is read on EVERY failure: a 404 may name itself (the
        // legacy-task case) and a 500 now carries the line that explains it.
        const body = (await res.json().catch(() => null)) as ItemFailureBody | null;
        if (res.status === 404) {
          setMissing(true);
          setMissingReason(missingReasonFrom(body));
        } else if (res.status === 403) {
          setDenied(true);
        } else {
          const failure = describeTaskLoadFailure(res.status, body);
          setError(failure.message);
          setErrorStatus(failure.status);
          setErrorDetail(failure.detail);
        }
        return;
      }
      setMissing(false);
      setMissingReason(null);
      setDenied(false);
      setError(null);
      setErrorStatus(null);
      setErrorDetail(null);
      setData((await res.json()) as TaskResponse);
    } catch {
      const failure = describeTaskLoadFailure(0, null);
      setError(failure.message);
      setErrorStatus(0);
      setErrorDetail(null);
    } finally {
      setLoading(false);
    }
  }, [itemId, readUrl]);

  useEffect(() => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    setErrorDetail(null);
    setMissing(false);
    setMissingReason(null);
    setDenied(false);
    void reload();
  }, [itemId, reload]);

  // The context the last read answered with, for the writes below.
  const contextRef = useRef<TaskContext | null>(null);
  useEffect(() => { contextRef.current = data?.context ?? null; }, [data?.context]);

  const patch = useCallback(
    async (body: DetailPatch, optimistic?: Partial<BoardItemRow>): Promise<TaskPatchResult> => {
      if (!itemId) return { ok: false, status: 0, payload: null };
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
      // In a List the task is only shown in, every write names that List, so
      // its values land in that List's namespace (PATCH contextBoardId). In
      // its home, the body is exactly today's.
      const ctx = contextRef.current;
      const wire = JSON.stringify(ctx?.kind === "linked" ? { ...body, contextBoardId: ctx.boardId } : body);
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
          // Merge: a lean response must never strip enriched fields. In a
          // linked context the answer's boardId may name the home, and its
          // listLink is the row's in that List; the body keeps its own.
          setData((prev) => {
            if (!prev) return prev;
            const merged = { ...prev.item, ...payload.item } as BoardItemRow;
            if (ctx?.kind === "linked") merged.boardId = prev.item.boardId;
            return { ...prev, item: merged };
          });
          // A move or a watcher write changes the gate's answer and the
          // breadcrumb, so re-read those rather than inventing them.
          if (body.boardId || body.watcherIds) await reload();
        } else {
          await reload();
        }
        return res.ok ? { ok: true } : { ok: false, status: res.status, payload };
      } catch {
        setSaveStatus("error");
        await reload();
        return { ok: false, status: 0, payload: null };
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
    context: data?.context ?? null,
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
    errorStatus,
    errorDetail,
    missing,
    missingReason,
    denied,
    patch,
    saveStatus,
    lastSavedAt,
    reload,
    refreshToken,
  };
}
