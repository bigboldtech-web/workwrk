"use client";

// useBirdseye: every read and write Bird's eye makes, and the state that
// holds their answers.
//
// Reads go through apiFetch to GET /api/spaces/[id]/birdseye. EVERY read
// carries a generation: the overview's is bumped by the search, Hide closed
// and a reload, the focus's by those and by the focused List, and an answer
// from an older generation is dropped on arrival (review #9). A superseded
// read is not aborted: apiFetch reads an aborted request as the network
// going away and would tell the whole shell it is offline, so the stale
// answer is simply ignored when it lands. One "Show more" per column is in
// flight at a time.
//
// Writes are the List's own: PATCH /api/items/[id] { status } (the Board
// view's path) and POST /api/boards/[id]/items { title, status }. A status
// change is optimistic; while it is in flight its new status is overlaid on
// every page that arrives, so a card can never land in two columns, and a
// failure is undone by the INVERSE move (never a snapshot restore, which
// could undo somebody else's update) with a toast whose Try again really
// sends the request again. A failed create keeps what was typed and says why.
//
// Other people's changes arrive as the shell's `item` event (and this tab's
// own drawer edits as the same event); a card on screen is re-read, coalesced
// per task for 300 ms.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { accessMessage } from "@/lib/access-message";
import { useOsToast } from "@/components/layout/os/toast";
import {
  applyStatusMove,
  bucketFor,
  bucketRank,
  cardFromRow,
  cardMatchesFilters,
  countDelta,
  keepJustAdded,
  mergeFocusPage,
  mergeOverviewPage,
  moveStatusCounts,
  type BirdseyeCard,
  type BirdseyeFocusBody,
  type BirdseyeFocusPageBody,
  type BirdseyeList,
  type BirdseyeListPageBody,
  type BirdseyeOverviewBody,
  type CardSourceRow,
} from "@/lib/work/birdseye";

export interface ColumnState {
  cards: BirdseyeCard[];
  /** Tasks added in this visit that the loaded page does not show in place. */
  justAdded: BirdseyeCard[];
  nextCursor: string | null;
  loadingMore: boolean;
  moreError: boolean;
}

export interface FocusColumnState {
  cards: BirdseyeCard[];
  /** Tasks added from this column's top row in this visit. */
  justAdded: BirdseyeCard[];
  nextCursor: string | null;
  total: number;
  loadingMore: boolean;
  moreError: boolean;
}

export interface FocusState {
  boardId: string;
  columns: Record<string, FocusColumnState>;
}

export type LoadMoreTarget = { kind: "list"; boardId: string } | { kind: "focus"; status: string };

export interface SubtaskRow {
  id: string;
  title: string;
  status: string | null;
}

export interface SubtaskEntry {
  state: "loading" | "ready" | "error";
  rows: SubtaskRow[];
}

type Phase = "loading" | "ready" | "error";

export interface ItemEventDetail {
  type?: string;
  itemId?: string;
  boardId?: string | null;
  gone?: boolean;
}

export interface ItemCreatedDetail {
  boardId?: string;
  item?: CardSourceRow & { parentItemId?: string | null };
}

interface ItemBody {
  item?: CardSourceRow & { parentItemId?: string | null; archivedAt?: string | null };
}

function emptyColumn(): ColumnState {
  return { cards: [], justAdded: [], nextCursor: null, loadingMore: false, moreError: false };
}

/** Every copy of a card, wherever it is on screen, through `fn`. */
function mapCards<C extends { cards: BirdseyeCard[]; justAdded: BirdseyeCard[] }>(
  columns: Record<string, C>,
  id: string,
  fn: (c: BirdseyeCard) => BirdseyeCard | null,
): Record<string, C> {
  let changed = false;
  const next: Record<string, C> = {};
  for (const [key, col] of Object.entries(columns)) {
    const touch = (list: BirdseyeCard[]) => {
      if (!list.some((c) => c.id === id)) return list;
      changed = true;
      return list.flatMap((c) => {
        if (c.id !== id) return [c];
        const out = fn(c);
        return out ? [out] : [];
      });
    };
    next[key] = { ...col, cards: touch(col.cards), justAdded: touch(col.justAdded) };
  }
  return changed ? next : columns;
}

function findCard(columns: Record<string, { cards: BirdseyeCard[]; justAdded: BirdseyeCard[] }>, id: string): BirdseyeCard | null {
  for (const col of Object.values(columns)) {
    const hit = col.cards.find((c) => c.id === id) ?? col.justAdded.find((c) => c.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The status a card shows right now, from the overview or the focus columns.
 * `undefined` when the card is not on screen at all (only the counts know it).
 */
function shownStatusOf(
  overview: Record<string, { cards: BirdseyeCard[]; justAdded: BirdseyeCard[] }>,
  focus: FocusState | null,
  id: string,
): string | null | undefined {
  const hit = findCard(overview, id) ?? (focus ? findCard(focus.columns, id) : null);
  return hit ? hit.status : undefined;
}

function focusColumnOf(focus: FocusState | null, id: string): string | null {
  if (!focus) return null;
  for (const [key, col] of Object.entries(focus.columns)) {
    if (col.cards.some((c) => c.id === id) || col.justAdded.some((c) => c.id === id)) return key;
  }
  return null;
}

export function useBirdseye({
  spaceId,
  focusId,
  q,
  hideClosed,
  onFocusMissing,
  onOverviewLoaded,
}: {
  spaceId: string;
  focusId: string | null;
  q: string;
  hideClosed: boolean;
  /** The focused List is not one the viewer can read (the route answered list_not_found). */
  onFocusMissing?: (boardId: string) => void;
  /** An overview load landed, with the Lists it shows. */
  onOverviewLoaded?: (lists: BirdseyeList[]) => void;
}) {
  const { toast } = useOsToast();
  // The latest callbacks, read when a load lands, so a new closure from the
  // parent never re-creates the loaders.
  const callbacks = useRef({ onFocusMissing, onOverviewLoaded });
  useEffect(() => {
    callbacks.current = { onFocusMissing, onOverviewLoaded };
  });
  // The loaders' own retry doors, read through refs for the same reason:
  // a toast's Try again must call the loader as it is when it is pressed.
  const retry = useRef({ overview: () => {}, focus: () => {} });

  // What is on screen, and the filters it was loaded under. Loading and
  // refreshing are DERIVED from these (never set when a load starts), so a
  // load an effect kicks off changes no state until its answer lands.
  const filterKey = `${q}\u0000${hideClosed ? 1 : 0}`;
  const [overviewLists, setOverviewLists] = useState<BirdseyeList[] | null>(null);
  const [overview, setOverview] = useState<Record<string, ColumnState>>({});
  const [overviewLoadedKey, setOverviewLoadedKey] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<{ key: string; message: string } | null>(null);
  const [overviewStale, setOverviewStale] = useState(true);
  const [overviewManual, setOverviewManual] = useState(false);

  const [focusLists, setFocusLists] = useState<BirdseyeList[] | null>(null);
  const [focus, setFocus] = useState<(FocusState & { loadedKey: string }) | null>(null);
  const [focusError, setFocusError] = useState<{ boardId: string; key: string; message: string } | null>(null);
  const [focusManual, setFocusManual] = useState(false);

  const [subtasks, setSubtasks] = useState<Record<string, SubtaskEntry>>({});

  // The search and Hide closed reload what is showing, and mark the overview
  // stale so it reloads the moment it is shown again.
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey);
    setOverviewStale(true);
  }

  const overviewGen = useRef(0);
  const focusGen = useRef(0);
  const pending = useRef(new Map<string, string | null>());
  const inFlightMore = useRef(new Set<string>());
  // Tasks this view created itself: the shell's item-created event it sends
  // for the rest of the app comes straight back here and is not news.
  const createdHere = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The latest state, for callbacks that must read it without re-binding.
  // Refreshed after every commit, before any handler can run against it.
  const stateRef = useRef({ overview, focus, overviewLists, focusLists, q, hideClosed, focusId, subtasks });
  useLayoutEffect(() => {
    stateRef.current = { overview, focus, overviewLists, focusLists, q, hideClosed, focusId, subtasks };
  });

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (hideClosed) sp.set("closed", "hide");
      for (const [k, v] of Object.entries(extra)) sp.set(k, v);
      const s = sp.toString();
      return `/api/spaces/${encodeURIComponent(spaceId)}/birdseye${s ? `?${s}` : ""}`;
    },
    [spaceId, q, hideClosed],
  );

  const listById = useCallback((id: string): BirdseyeList | undefined => {
    const s = stateRef.current;
    return s.overviewLists?.find((l) => l.id === id) ?? s.focusLists?.find((l) => l.id === id);
  }, []);

  /** A page's cards take the status of any write still in flight, in place. */
  const overlayPending = useCallback((cards: BirdseyeCard[]) => {
    if (pending.current.size === 0) return cards;
    return cards.map((c) => (pending.current.has(c.id) ? { ...c, status: pending.current.get(c.id) ?? null } : c));
  }, []);

  // ── Loads ─────────────────────────────────────────────────────────

  const loadOverview = useCallback(async () => {
    const gen = ++overviewGen.current;
    const key = filterKey;
    const r = await apiFetch<BirdseyeOverviewBody>(query(), { cache: "no-store" });
    if (!mounted.current || gen !== overviewGen.current) return;
    setOverviewManual(false);
    if (!r.ok) {
      // A refresh that fails keeps what is on screen and says so; only a
      // first load turns into the error state.
      setOverviewError({ key, message: r.error });
      if (stateRef.current.overviewLists !== null) {
        toast("Couldn't refresh the bird's eye view.", { tone: "danger", action: { label: "Try again", onClick: () => retry.current.overview() } });
      }
      return;
    }
    const s = stateRef.current;
    const next: Record<string, ColumnState> = {};
    for (const list of r.data.lists) {
      const col = r.data.columns[list.id] ?? { cards: [], nextCursor: null };
      const cards = overlayPending(col.cards);
      const loaded = new Set(cards.map((c) => c.id));
      const prior = s.overview[list.id]?.justAdded ?? [];
      const { keep } = keepJustAdded(prior, loaded, s.q, s.hideClosed, list.statuses);
      next[list.id] = { cards, justAdded: keep, nextCursor: col.nextCursor, loadingMore: false, moreError: false };
    }
    setOverviewLists(r.data.lists);
    setOverview(next);
    setOverviewLoadedKey(key);
    setOverviewError(null);
    setOverviewStale(false);
    callbacks.current.onOverviewLoaded?.(r.data.lists);
  }, [filterKey, query, overlayPending, toast]);

  const loadFocus = useCallback(async () => {
    if (!focusId) return;
    const gen = ++focusGen.current;
    const boardId = focusId;
    const key = filterKey;
    const r = await apiFetch<BirdseyeFocusBody>(query({ focus: boardId }), { cache: "no-store" });
    if (!mounted.current || gen !== focusGen.current) return;
    setFocusManual(false);
    if (!r.ok) {
      if (r.status === 404 && r.error === "list_not_found") {
        callbacks.current.onFocusMissing?.(boardId);
        return;
      }
      setFocusError({ boardId, key, message: r.error });
      if (stateRef.current.focus?.boardId === boardId) {
        toast("Couldn't refresh this List.", { tone: "danger", action: { label: "Try again", onClick: () => retry.current.focus() } });
      }
      return;
    }
    const s = stateRef.current;
    const prior = s.focus?.boardId === boardId ? s.focus.columns : {};
    const list = r.data.lists.find((l) => l.id === boardId);
    const columns: Record<string, FocusColumnState> = {};
    for (const [status, col] of Object.entries(r.data.focus.columns)) {
      const cards = overlayPending(col.cards);
      const loaded = new Set(cards.map((c) => c.id));
      const { keep } = keepJustAdded(prior[status]?.justAdded ?? [], loaded, s.q, s.hideClosed, list?.statuses ?? []);
      columns[status] = { cards, justAdded: keep, nextCursor: col.nextCursor, total: col.total, loadingMore: false, moreError: false };
    }
    setFocusLists(r.data.lists);
    setFocus({ boardId, columns, loadedKey: key });
    setFocusError(null);
  }, [focusId, filterKey, query, overlayPending, toast]);

  useEffect(() => {
    retry.current = { overview: () => void loadOverview(), focus: () => void loadFocus() };
  }, [loadOverview, loadFocus]);

  // The loads are wrapped rather than called directly, so neither effect body
  // sets state before its first await (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (focusId || !overviewStale) return;
    const run = async () => {
      await loadOverview();
    };
    void run();
  }, [focusId, overviewStale, loadOverview]);

  useEffect(() => {
    // loadFocus changes with the focused List and the filters, which are
    // exactly the reloads focus needs.
    if (!focusId) return;
    const run = async () => {
      await loadFocus();
    };
    void run();
  }, [focusId, loadFocus]);

  /** Try again, from the error state or a toast: a handler, so it may say it is working. */
  const reload = useCallback(() => {
    if (stateRef.current.focusId) {
      setFocusError(null);
      setFocusManual(true);
      setOverviewStale(true);
      void loadFocus();
    } else {
      setOverviewError(null);
      setOverviewManual(true);
      void loadOverview();
    }
  }, [loadFocus, loadOverview]);

  // ── Show more ─────────────────────────────────────────────────────

  const loadMore = useCallback(
    async (target: LoadMoreTarget) => {
      const s = stateRef.current;
      if (target.kind === "list") {
        const col = s.overview[target.boardId];
        const key = `list:${target.boardId}`;
        if (!col?.nextCursor || inFlightMore.current.has(key)) return;
        inFlightMore.current.add(key);
        const gen = overviewGen.current;
        setOverview((prev) => (prev[target.boardId] ? { ...prev, [target.boardId]: { ...prev[target.boardId], loadingMore: true, moreError: false } } : prev));
        const r = await apiFetch<BirdseyeListPageBody>(query({ list: target.boardId, after: col.nextCursor }), { cache: "no-store" });
        inFlightMore.current.delete(key);
        if (!mounted.current || gen !== overviewGen.current) return;
        setOverview((prev) => {
          const cur = prev[target.boardId];
          if (!cur) return prev;
          if (!r.ok) return { ...prev, [target.boardId]: { ...cur, loadingMore: false, moreError: true } };
          const merged = mergeOverviewPage(cur, { cards: overlayPending(r.data.cards), nextCursor: r.data.nextCursor });
          return { ...prev, [target.boardId]: { ...merged, loadingMore: false, moreError: false } };
        });
        return;
      }
      const f = s.focus;
      if (!f) return;
      const col = f.columns[target.status];
      const key = `focus:${f.boardId}:${target.status}`;
      if (!col?.nextCursor || inFlightMore.current.has(key)) return;
      inFlightMore.current.add(key);
      const gen = focusGen.current;
      const boardId = f.boardId;
      setFocus((prev) =>
        prev && prev.boardId === boardId && prev.columns[target.status]
          ? { ...prev, columns: { ...prev.columns, [target.status]: { ...prev.columns[target.status], loadingMore: true, moreError: false } } }
          : prev,
      );
      const r = await apiFetch<BirdseyeFocusPageBody>(
        query({ focus: boardId, status: target.status, after: col.nextCursor }),
        { cache: "no-store" },
      );
      inFlightMore.current.delete(key);
      if (!mounted.current || gen !== focusGen.current) return;
      const statuses = listById(boardId)?.statuses ?? [];
      setFocus((prev) => {
        if (!prev || prev.boardId !== boardId || !prev.columns[target.status]) return prev;
        const cur = prev.columns[target.status];
        if (!r.ok) return { ...prev, columns: { ...prev.columns, [target.status]: { ...cur, loadingMore: false, moreError: true } } };
        const merged = mergeFocusPage(prev.columns, target.status, { cards: r.data.cards, nextCursor: r.data.nextCursor }, pending.current, statuses);
        return { ...prev, columns: { ...merged, [target.status]: { ...merged[target.status], loadingMore: false, moreError: false } } };
      });
    },
    [query, overlayPending, listById],
  );

  // ── Counts ────────────────────────────────────────────────────────

  const adjustLists = useCallback((boardId: string, fn: (l: BirdseyeList) => BirdseyeList) => {
    const apply = (lists: BirdseyeList[] | null) => (lists ? lists.map((l) => (l.id === boardId ? fn(l) : l)) : lists);
    setOverviewLists(apply);
    setFocusLists(apply);
  }, []);

  // ── Status change ─────────────────────────────────────────────────

  /** Put a card's status to `to` wherever it shows (and keep the counts true). */
  const moveEverywhere = useCallback(
    (card: BirdseyeCard, from: string | null, to: string | null) => {
      const list = listById(card.boardId);
      const statuses = list?.statuses ?? [];
      const hide = stateRef.current.hideClosed;
      // A card that already shows something other than `from` was changed
      // since (a later pick, someone else's edit): nothing moves, and the
      // counts stay put too, or they would drift from what the cards say.
      const shown = shownStatusOf(stateRef.current.overview, stateRef.current.focus, card.id);
      if (shown !== undefined && shown !== from) return;
      setOverview((prev) =>
        mapCards(prev, card.id, (c) => (c.status === from ? { ...c, status: to, rank: bucketRank(statuses, to) } : c)),
      );
      setFocus((prev) => {
        if (!prev || prev.boardId !== card.boardId) return prev;
        const at = focusColumnOf(prev, card.id);
        if (!at) return prev;
        const col = prev.columns[at];
        const current = col.cards.find((c) => c.id === card.id) ?? col.justAdded.find((c) => c.id === card.id);
        if (!current || current.status !== from) return prev;
        if (col.justAdded.some((c) => c.id === card.id)) {
          // A just-added card leaves the top slot and joins its new column.
          const without = { ...col, justAdded: col.justAdded.filter((c) => c.id !== card.id), total: Math.max(0, col.total - 1) };
          const target = bucketFor(statuses, to);
          const dst = prev.columns[target];
          const moved = { ...current, status: to };
          if (!dst || target === at) {
            return { ...prev, columns: { ...prev.columns, [at]: { ...col, justAdded: col.justAdded.map((c) => (c.id === card.id ? moved : c)) } } };
          }
          return {
            ...prev,
            columns: {
              ...prev.columns,
              [at]: without,
              [target]: { ...dst, justAdded: [moved, ...dst.justAdded], total: dst.total + 1 },
            },
          };
        }
        return { ...prev, columns: applyStatusMove(prev.columns, card.id, at, bucketFor(statuses, to), to) };
      });
      if (list) adjustLists(card.boardId, (l) => moveStatusCounts(l, l.statuses, from, to, hide));
    },
    [listById, adjustLists],
  );

  // Try again sends the same change through the current changeStatus, but
  // only while the card still shows the status the failure rolled it back to.
  // A person who picked another status since has moved on, and resending the
  // old target would overwrite their newer choice on the server.
  const resendRef = useRef<(card: BirdseyeCard, next: string) => Promise<void>>(async () => {});
  const changeStatus = useCallback(
    async (card: BirdseyeCard, next: string): Promise<void> => {
      const from = card.status;
      if (from === next) return;
      pending.current.set(card.id, next);
      moveEverywhere(card, from, next);
      // A later pick on the same card owns the pending mark; this write only
      // clears its own.
      const settle = () => {
        if (pending.current.get(card.id) === next) pending.current.delete(card.id);
      };
      const resend = () => {
        const s = stateRef.current;
        const shown = shownStatusOf(s.overview, s.focus, card.id);
        if (pending.current.has(card.id) || (shown !== undefined && shown !== from)) {
          toast("The status was changed since, so nothing was resent.", { tone: "info" });
          return;
        }
        void resendRef.current({ ...card, status: from }, next);
      };
      const fail = (body: unknown) => {
        settle();
        moveEverywhere({ ...card, status: next }, next, from);
        toast(accessMessage(body, "Couldn't change the status."), { tone: "danger", action: { label: "Try again", onClick: resend } });
      };
      let res: Response;
      try {
        // fetch, not apiFetch: the refusal body is what names the reason.
        res = await fetch(`/api/items/${encodeURIComponent(card.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
      } catch {
        fail(null);
        return;
      }
      const body = (await res.json().catch(() => null)) as (ItemBody & { recurred?: boolean }) | null;
      if (!res.ok) {
        fail(body);
        return;
      }
      settle();
      const saved = body?.item;
      if (saved) {
        const landed = saved.status ?? null;
        // A recurring task completed on the server rolls forward (its status
        // resets): the card follows what was written, not what was asked.
        if (landed !== next) moveEverywhere({ ...card, status: next }, next, landed);
        const merge = (c: BirdseyeCard) => ({ ...cardFromRow(saved, c), status: c.status, rank: c.rank });
        setOverview((prev) => mapCards(prev, card.id, merge));
        setFocus((prev) => (prev ? { ...prev, columns: mapCards(prev.columns, card.id, merge) } : prev));
      }
    },
    [moveEverywhere, toast],
  );
  useEffect(() => {
    resendRef.current = changeStatus;
  }, [changeStatus]);

  // ── Create ────────────────────────────────────────────────────────

  const placeNew = useCallback(
    (card: BirdseyeCard, place: "top" | "bottom") => {
      const s = stateRef.current;
      const list = listById(card.boardId);
      const statuses = list?.statuses ?? [];
      if (findCard(s.overview, card.id) || focusColumnOf(s.focus, card.id)) return false;
      setOverview((prev) => {
        const col = prev[card.boardId] ?? emptyColumn();
        return { ...prev, [card.boardId]: { ...col, justAdded: [card, ...col.justAdded] } };
      });
      setFocus((prev) => {
        if (!prev || prev.boardId !== card.boardId) return prev;
        const bucket = bucketFor(statuses, card.status);
        const col = prev.columns[bucket];
        if (!col) return prev;
        const nextCol =
          place === "top"
            ? { ...col, justAdded: [card, ...col.justAdded], total: col.total + 1 }
            : { ...col, cards: [...col.cards, card], total: col.total + 1 };
        return { ...prev, columns: { ...prev.columns, [bucket]: nextCol } };
      });
      if (list && cardMatchesFilters(card, s.q, s.hideClosed, statuses)) {
        adjustLists(card.boardId, (l) => countDelta(l, l.statuses, card.status, 1, s.hideClosed));
      }
      return true;
    },
    [listById, adjustLists],
  );

  const createTask = useCallback(
    async (boardId: string, title: string, status: string, place: "top" | "bottom" = "top"): Promise<{ ok: true } | { ok: false; error: string }> => {
      let res: Response;
      try {
        // The status is always sent: the bare create falls back to TO_DO,
        // which a List with its own statuses may not declare.
        res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, status }),
        });
      } catch {
        return { ok: false, error: "Couldn't add the task. Check your connection and try again." };
      }
      const body = (await res.json().catch(() => null)) as ItemBody | null;
      if (!res.ok || !body?.item) return { ok: false, error: accessMessage(body, "Couldn't add the task.") };
      const statuses = listById(boardId)?.statuses ?? [];
      const card = { ...cardFromRow(body.item), boardId, rank: bucketRank(statuses, body.item.status) };
      createdHere.current.add(card.id);
      placeNew(card, place);
      // The rest of the shell (My work, the sidebar counts) hears about it the
      // way it hears about the create modal's tasks.
      try {
        window.dispatchEvent(new CustomEvent("workwrk:item-created", { detail: { boardId, item: body.item } }));
      } catch {
        // A tab that refuses CustomEvent still has the card on screen.
      }
      return { ok: true };
    },
    [listById, placeNew],
  );

  // ── Subtasks ──────────────────────────────────────────────────────

  const loadSubtasks = useCallback(async (parentId: string) => {
    setSubtasks((prev) => ({ ...prev, [parentId]: { state: "loading", rows: prev[parentId]?.rows ?? [] } }));
    const r = await apiFetch<{ subtasks: Array<{ id: string; title: string; status: string | null }> }>(
      `/api/items/${encodeURIComponent(parentId)}/subtasks`,
      { cache: "no-store" },
    );
    if (!mounted.current) return;
    if (!r.ok) {
      setSubtasks((prev) => ({ ...prev, [parentId]: { state: "error", rows: prev[parentId]?.rows ?? [] } }));
      return;
    }
    const rows = (r.data.subtasks ?? []).map((st) => ({ id: st.id, title: st.title, status: st.status ?? null }));
    setSubtasks((prev) => ({ ...prev, [parentId]: { state: "ready", rows } }));
    // The pill counts what this route opens, so a fresh answer is the count.
    const setCount = (c: BirdseyeCard) => (c.subtaskCount === rows.length ? c : { ...c, subtaskCount: rows.length });
    setOverview((prev) => mapCards(prev, parentId, setCount));
    setFocus((prev) => (prev ? { ...prev, columns: mapCards(prev.columns, parentId, setCount) } : prev));
  }, []);

  // ── Other people's changes ────────────────────────────────────────

  const removeCard = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const card = findCard(s.overview, id) ?? (s.focus ? findCard(s.focus.columns, id) : null);
      if (!card) return;
      setOverview((prev) => mapCards(prev, id, () => null));
      setFocus((prev) => {
        if (!prev) return prev;
        const at = focusColumnOf(prev, id);
        const columns = mapCards(prev.columns, id, () => null);
        if (at && columns[at]) columns[at] = { ...columns[at], total: Math.max(0, columns[at].total - 1) };
        return { ...prev, columns };
      });
      adjustLists(card.boardId, (l) => countDelta(l, l.statuses, card.status, -1, s.hideClosed));
    },
    [adjustLists],
  );

  const shownListIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of overviewLists ?? []) ids.add(l.id);
    for (const l of focusLists ?? []) ids.add(l.id);
    return ids;
  }, [overviewLists, focusLists]);
  const shownRef = useRef(shownListIds);
  useLayoutEffect(() => {
    shownRef.current = shownListIds;
  }, [shownListIds]);

  const refreshTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = refreshTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const refreshCard = useCallback(
    async (id: string) => {
      const r = await apiFetch<ItemBody>(`/api/items/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!mounted.current) return;
      const s = stateRef.current;
      const onScreen = findCard(s.overview, id) ?? (s.focus ? findCard(s.focus.columns, id) : null);
      if (!r.ok) {
        if (r.status === 404 && onScreen) removeCard(id);
        return;
      }
      const item = r.data.item;
      if (!item) return;
      if (!onScreen) {
        // A subtask of a card on screen: its parent's count, and its list
        // when expanded, come from the subtasks route.
        const parentId = item.parentItemId ?? null;
        if (parentId && (findCard(s.overview, parentId) || (s.focus && findCard(s.focus.columns, parentId)))) {
          void loadSubtasks(parentId);
        }
        return;
      }
      // It became a subtask of a card on screen: it is no longer a card of its
      // own. (A child whose parent is not a live row of its List stays a card,
      // the Board's rule, and such a parent is never on screen.)
      const pid = item.parentItemId ?? null;
      const stillTop = !pid || !(findCard(s.overview, pid) || (s.focus && findCard(s.focus.columns, pid)));
      const boardId = item.boardId ?? onScreen.boardId;
      if (item.archivedAt || !stillTop || !shownRef.current.has(boardId) || boardId !== onScreen.boardId) {
        removeCard(id);
        if (!item.archivedAt && stillTop && shownRef.current.has(boardId) && boardId !== onScreen.boardId) {
          // Moved between two Lists on screen: it arrives at the top of its new one.
          const statuses = listById(boardId)?.statuses ?? [];
          placeNew({ ...cardFromRow(item, onScreen), boardId, rank: bucketRank(statuses, item.status) }, "top");
        }
        return;
      }
      if ((item.status ?? null) !== onScreen.status && !pending.current.has(id)) {
        moveEverywhere(onScreen, onScreen.status, item.status ?? null);
      }
      const merge = (c: BirdseyeCard) => ({ ...cardFromRow(item, c), status: pending.current.has(id) ? c.status : (item.status ?? null), rank: c.rank });
      setOverview((prev) => mapCards(prev, id, merge));
      setFocus((prev) => (prev ? { ...prev, columns: mapCards(prev.columns, id, merge) } : prev));
      if (stateRef.current.subtasks[id]) void loadSubtasks(id);
    },
    [removeCard, loadSubtasks, listById, placeNew, moveEverywhere],
  );

  const applyItemEvent = useCallback(
    (detail: ItemEventDetail | null | undefined) => {
      if (!detail || detail.type !== "item" || !detail.itemId) return;
      const id = detail.itemId;
      const s = stateRef.current;
      const onScreen = !!(findCard(s.overview, id) || (s.focus && findCard(s.focus.columns, id)));
      if (detail.gone) {
        if (onScreen) removeCard(id);
        return;
      }
      if (!onScreen && !(detail.boardId && shownRef.current.has(detail.boardId))) return;
      const timers = refreshTimers.current;
      const existing = timers.get(id);
      if (existing) clearTimeout(existing);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void refreshCard(id);
        }, 300),
      );
    },
    [removeCard, refreshCard],
  );

  const applyItemCreated = useCallback(
    (detail: ItemCreatedDetail | null | undefined) => {
      const item = detail?.item;
      const boardId = detail?.boardId ?? item?.boardId ?? null;
      if (!item?.id || !boardId || !shownRef.current.has(boardId)) return;
      const s = stateRef.current;
      if (item.parentItemId) {
        if (findCard(s.overview, item.parentItemId) || (s.focus && findCard(s.focus.columns, item.parentItemId))) {
          void loadSubtasks(item.parentItemId);
        }
        return;
      }
      if (createdHere.current.has(item.id)) return;
      if (findCard(s.overview, item.id) || focusColumnOf(s.focus, item.id)) return;
      // Re-read it: the event carries whatever row its sender had, and the
      // card is built from the task as it is now.
      void apiFetch<ItemBody>(`/api/items/${encodeURIComponent(item.id)}`, { cache: "no-store" }).then((r) => {
        if (!mounted.current || !r.ok || !r.data.item || r.data.item.parentItemId || r.data.item.archivedAt) return;
        const statuses = listById(boardId)?.statuses ?? [];
        placeNew({ ...cardFromRow(r.data.item), boardId, rank: bucketRank(statuses, r.data.item.status) }, "top");
      });
    },
    [loadSubtasks, listById, placeNew],
  );

  // ── What the view reads ───────────────────────────────────────────

  const inFocus = focusId !== null;
  const lists = (inFocus ? (focusLists ?? overviewLists) : (overviewLists ?? focusLists)) ?? [];
  const shownFocus = focus && focus.boardId === focusId ? focus : null;
  const overviewErrorNow = overviewError && overviewError.key === filterKey ? overviewError.message : null;
  const focusErrorNow =
    focusError && focusError.boardId === focusId && focusError.key === filterKey ? focusError.message : null;
  const overviewPhase: Phase = overviewLists !== null ? "ready" : overviewErrorNow ? "error" : "loading";
  const focusPhase: Phase = shownFocus ? "ready" : focusErrorNow ? "error" : "loading";
  const phase = inFocus ? focusPhase : overviewPhase;
  const refreshing = inFocus
    ? !!shownFocus && !focusErrorNow && (shownFocus.loadedKey !== filterKey || focusManual)
    : overviewLists !== null && !overviewErrorNow && (overviewLoadedKey !== filterKey || overviewManual);

  return {
    status: phase,
    refreshing,
    error: inFocus ? focusErrorNow : overviewErrorNow,
    lists,
    overviewLists: overviewLists ?? [],
    overviewReady: overviewLists !== null,
    overview,
    focus: shownFocus,
    subtasks,
    reload,
    loadMore,
    changeStatus,
    createTask,
    loadSubtasks,
    refreshCard,
    applyItemEvent,
    applyItemCreated,
  };
}

export type BirdseyeData = ReturnType<typeof useBirdseye>;
