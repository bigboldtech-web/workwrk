"use client";

// useBirdseye: every read and write Bird's eye makes, and the state that
// holds their answers.
//
// Reads go through apiFetch to GET /api/spaces/[id]/birdseye, or a Folder's
// GET /api/folders/[id]/birdseye (the same answer). EVERY read
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
import { boardStatusFor, homeStatusTarget, linkedStatusRefusal } from "@/lib/list-link-rows";
import type { BoardItemRow } from "@/lib/board-items-shared";
import { useOsToast } from "@/components/layout/os/toast";
import { planDrop } from "@/lib/work/reorder";
import {
  arrivalCard,
  copiesOf,
  copyKey,
  findCopy,
  focusColumnOf,
  insertInOrder,
  keyOf,
  mapCards,
  mapFocusCopy,
  mapOverviewCopy,
  pendingIn,
  reachesLoaded,
  refreshLinkedCopy,
  shownStatusOf,
  type TaskBody,
} from "@/lib/work/birdseye-copies";

export { copyKey } from "@/lib/work/birdseye-copies";
import {
  cardClosedHere,
  cardOf,
  columnForHomeValue,
  linkedCardFromRow,
  linkedRowOf,
  withHomeValue,
  type StatusPick,
} from "@/lib/work/birdseye-linked";
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

export interface ItemCreatedDetail {
  boardId?: string;
  item?: CardSourceRow & { parentItemId?: string | null };
}

interface ItemBody {
  item?: CardSourceRow & { parentItemId?: string | null; archivedAt?: string | null };
}

export interface ItemEventDetail {
  type?: string;
  itemId?: string;
  boardId?: string | null;
  gone?: boolean;
  /** Every List the task appears in (its home and the Lists it is linked into). */
  listIds?: string[];
  /** Lists the task just left (a link removed or moved). */
  leftListIds?: string[];
}

function emptyColumn(): ColumnState {
  return { cards: [], justAdded: [], nextCursor: null, loadingMore: false, moreError: false };
}

export function useBirdseye({
  endpoint,
  focusId,
  q,
  hideClosed,
  onFocusMissing,
  onOverviewLoaded,
}: {
  /** The Bird's eye route of this scope (birdseyeScopePaths). */
  endpoint: string;
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
  const stateRef = useRef({ overview, focus, overviewLists, focusLists, q, hideClosed, focusId, subtasks, overviewStale });
  useLayoutEffect(() => {
    stateRef.current = { overview, focus, overviewLists, focusLists, q, hideClosed, focusId, subtasks, overviewStale };
  });

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (hideClosed) sp.set("closed", "hide");
      for (const [k, v] of Object.entries(extra)) sp.set(k, v);
      const s = sp.toString();
      return `${endpoint}${s ? `?${s}` : ""}`;
    },
    [endpoint, q, hideClosed],
  );

  const listById = useCallback((id: string): BirdseyeList | undefined => {
    const s = stateRef.current;
    return s.overviewLists?.find((l) => l.id === id) ?? s.focusLists?.find((l) => l.id === id);
  }, []);

  /** A page's cards take the status of any write still in flight, in place. */
  const overlayPending = useCallback((cards: BirdseyeCard[]) => {
    if (pending.current.size === 0) return cards;
    return cards.map((c) => (pending.current.has(keyOf(c)) ? { ...c, status: pending.current.get(keyOf(c)) ?? null } : c));
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
        const merged = mergeFocusPage(prev.columns, target.status, { cards: r.data.cards, nextCursor: r.data.nextCursor }, pendingIn(pending.current, boardId), statuses);
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

  /**
   * Put one copy's status to `to`, in the overview and in focus (and keep
   * that List's counts true). `closed` says whether the card counts as closed
   * before and after, when the columns alone do not (a linked card done in
   * its home set); a move that changes only that adjusts only the counts.
   */
  const moveEverywhere = useCallback(
    (card: BirdseyeCard, from: string | null, to: string | null, closed?: { from: boolean; to: boolean }) => {
      const list = listById(card.boardId);
      const statuses = list?.statuses ?? [];
      const hide = stateRef.current.hideClosed;
      // A copy that already shows something other than `from` was changed
      // since (a later pick, someone else's edit): nothing moves, and the
      // counts stay put too, or they would drift from what the cards say.
      const shown = shownStatusOf(stateRef.current.overview, stateRef.current.focus, card.boardId, card.id);
      if (shown !== undefined && shown !== from) return;
      if (from !== to) {
        setOverview((prev) =>
          mapOverviewCopy(prev, card.boardId, card.id, (c) => (c.status === from ? { ...c, status: to, rank: bucketRank(statuses, to) } : c)),
        );
        setFocus((prev) => {
          if (!prev || prev.boardId !== card.boardId) return prev;
          const at = focusColumnOf(prev, card.boardId, card.id);
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
      }
      if (list) adjustLists(card.boardId, (l) => moveStatusCounts(l, l.statuses, from, to, hide, closed));
    },
    [listById, adjustLists],
  );

  // refreshCopy is declared further down; a write reaches it here.
  const refreshCopyRef = useRef<(card: BirdseyeCard) => Promise<void>>(async () => {});
  /** Every copy of a task in the other Lists on screen, re-read in their own List after this copy changed. */
  const refreshOthers = useCallback((card: { boardId: string; id: string }) => {
    const s = stateRef.current;
    for (const other of copiesOf(s.overview, s.focus, card.id)) {
      if (other.boardId !== card.boardId) void refreshCopyRef.current(other);
    }
  }, []);

  // Try again sends the same change through the current changeStatus, but
  // only while the card still shows the status the failure rolled it back to.
  // A person who picked another status since has moved on, and resending the
  // old target would overwrite their newer choice on the server.
  const resendRef = useRef<(card: BirdseyeCard, next: string, pick?: StatusPick) => Promise<void>>(async () => {});
  // Each card's latest write: an older answer never clears a newer mark or
  // rolls back a newer pick.
  const writeSeq = useRef(new Map<string, number>());
  const changeStatus = useCallback(
    async (card: BirdseyeCard, next: string, pick?: StatusPick): Promise<void> => {
      const from = card.status;
      const list = listById(card.boardId);
      const statusesHere = list?.statuses ?? [];
      // What is written, and the column the card lands in. A home row: the
      // status is the column. A linked card is written in its HOME set: a
      // column (a drop, or a pick from this List's statuses) maps to the home
      // value the Board would write, or is refused with the Board's own
      // sentence (nothing moves, nothing is saved); a status picked from its
      // own home set, the Board's pill, is written as it is and lands where
      // the Board places it.
      let column = next;
      let homeValue: string | null = null;
      if (card.linked) {
        if (pick?.home) {
          if (next === card.linked.homeValue || !list) return;
          homeValue = next;
          column = columnForHomeValue(card, list, next) ?? from ?? next;
        } else {
          if (from === next) return;
          const t = homeStatusTarget(linkedRowOf(card), next, statusesHere);
          if (!t.ok) {
            const label = statusesHere.find((st) => st.value === next)?.label ?? next;
            toast(linkedStatusRefusal(linkedRowOf(card), label, t.reason), { tone: "danger" });
            return;
          }
          homeValue = t.status;
        }
      } else if (from === next) {
        return;
      }
      const wire: Record<string, unknown> = homeValue !== null ? { status: homeValue, contextBoardId: card.boardId } : { status: next };
      const key = keyOf(card);
      const mine = (writeSeq.current.get(key) ?? 0) + 1;
      writeSeq.current.set(key, mine);
      const latest = () => writeSeq.current.get(key) === mine;
      pending.current.set(key, column);
      // A linked card counts as closed by the server's rule (its column, or
      // done in its home set), before and after the pick.
      const before = card.linked;
      const after = before && homeValue !== null && list ? withHomeValue(card, list, homeValue) : card;
      const closed = before ? { from: cardClosedHere(card, statusesHere), to: cardClosedHere(after, statusesHere, column) } : undefined;
      if (column !== from || (closed && closed.from !== closed.to)) moveEverywhere(card, from, column, closed);
      // The new home value shows at once (its picker, its reason line).
      if (before && after !== card) {
        const linked = after.linked;
        const show = (c: BirdseyeCard) => ({ ...c, linked });
        setOverview((prev) => mapOverviewCopy(prev, card.boardId, card.id, show));
        setFocus((prev) => mapFocusCopy(prev, card.boardId, card.id, show));
      }
      const settle = () => {
        if (latest()) pending.current.delete(key);
      };
      const resend = () => {
        const s = stateRef.current;
        const shown = shownStatusOf(s.overview, s.focus, card.boardId, card.id);
        if (pending.current.has(key) || (shown !== undefined && shown !== from)) {
          toast("The status was changed since, so nothing was resent.", { tone: "info" });
          return;
        }
        void resendRef.current({ ...card, status: from, linked: before }, next, pick);
      };
      const fail = (body: unknown) => {
        const own = latest();
        settle();
        // Rolled back only while it is still the card's latest pick.
        if (own) {
          const back = closed ? { from: closed.to, to: closed.from } : undefined;
          if (column !== from || (back && back.from !== back.to)) moveEverywhere({ ...after, status: column }, column, from, back);
          if (before) {
            const restore = (c: BirdseyeCard) => ({ ...c, linked: before });
            setOverview((prev) => mapOverviewCopy(prev, card.boardId, card.id, restore));
            setFocus((prev) => mapFocusCopy(prev, card.boardId, card.id, restore));
          }
        }
        // Unlinked from this List since it loaded: a retry can never land, so
        // the card is re-read (it leaves) and the toast says why.
        if (card.linked && (body as { error?: unknown } | null)?.error === "invalid_context") {
          toast("This task is no longer linked into this List, so its status wasn't changed here.", { tone: "info" });
          void refreshCopyRef.current(card);
          return;
        }
        toast(accessMessage(body, "Couldn't change the status."), { tone: "danger", action: { label: "Try again", onClick: resend } });
      };
      let res: Response;
      try {
        // fetch, not apiFetch: the refusal body is what names the reason.
        res = await fetch(`/api/items/${encodeURIComponent(card.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(wire),
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
      const own = latest();
      settle();
      const saved = body?.item;
      if (saved && card.linked) {
        // The answer is projected for THIS List: the card is rebuilt from it,
        // so it lands where the Board would place the home value written, and
        // its reason line names the new home status. No link here in the
        // answer (unlinked meanwhile): re-read, and it leaves. A newer pick in
        // flight keeps its own column and home value.
        const link = (saved as { listLink?: BoardItemRow["listLink"] }).listLink;
        const fresh = list && link && link.boardId === card.boardId ? linkedCardFromRow(saved as unknown as BoardItemRow, list) : null;
        if (!fresh) {
          void refreshCopyRef.current(card);
          refreshOthers(card);
          return;
        }
        const rebuilt = cardOf(fresh);
        if (own && rebuilt.status !== column) {
          moveEverywhere({ ...after, status: column }, column, rebuilt.status, {
            from: cardClosedHere(after, statusesHere, column),
            to: cardClosedHere(rebuilt, statusesHere),
          });
        }
        const merge = (c: BirdseyeCard): BirdseyeCard => ({
          ...rebuilt,
          subtaskCount: c.subtaskCount,
          status: c.status,
          rank: c.rank,
          linked: own ? rebuilt.linked : c.linked,
        });
        setOverview((prev) => mapOverviewCopy(prev, card.boardId, card.id, merge));
        setFocus((prev) => mapFocusCopy(prev, card.boardId, card.id, merge));
        // The task's copies in other Lists on screen follow, each by its own rule.
        refreshOthers(card);
        return;
      }
      if (saved) {
        const landed = saved.status ?? null;
        // A recurring task completed on the server rolls forward (its status
        // resets): the card follows what was written, not what was asked.
        if (landed !== next) moveEverywhere({ ...card, status: next }, next, landed);
        const merge = (c: BirdseyeCard) => ({ ...cardFromRow(saved, c), status: c.status, rank: c.rank });
        setOverview((prev) => mapOverviewCopy(prev, card.boardId, card.id, merge));
        setFocus((prev) => mapFocusCopy(prev, card.boardId, card.id, merge));
        refreshOthers(card);
      }
    },
    [moveEverywhere, toast, listById, refreshOthers],
  );
  useEffect(() => {
    resendRef.current = changeStatus;
  }, [changeStatus]);

  // ── Order in a Focus column ───────────────────────────────────────

  /**
   * Move a card up or down in its Focus column, to `index` among the
   * column's OTHER loaded cards (the ones in their own place; a card added
   * this visit sits on top until the next read). The midpoint of its new
   * neighbours, one write: a card homed here moves its task's position, a
   * card shown here through a link its LINK's place in this List; neighbours
   * with no room between them get the List renumbered on the server, over
   * the whole List (src/lib/work/reorder.ts, PUT /api/boards/[id]/order).
   * Optimistic; a failure says why and the column is read again.
   */
  const reorderCard = useCallback(
    async (card: BirdseyeCard, index: number) => {
      const f = stateRef.current.focus;
      if (!f || f.boardId !== card.boardId) return;
      const bucket = focusColumnOf(f, card.boardId, card.id);
      const col = bucket ? f.columns[bucket] : null;
      if (!bucket || !col) return;
      const plan = planDrop(col.cards, card.id, index);
      if (plan.kind === "none") return;
      const others = col.cards.filter((c) => c.id !== card.id);
      const at = Math.max(0, Math.min(index, others.length));
      const moved: BirdseyeCard = plan.kind === "position" ? { ...card, position: plan.position } : card;
      setFocus((prev) => {
        if (!prev || prev.boardId !== card.boardId || !prev.columns[bucket]) return prev;
        const c = prev.columns[bucket];
        const rest = c.cards.filter((x) => x.id !== card.id);
        const to = Math.max(0, Math.min(at, rest.length));
        return {
          ...prev,
          columns: { ...prev.columns, [bucket]: { ...c, justAdded: c.justAdded.filter((x) => x.id !== card.id), cards: [...rest.slice(0, to), moved, ...rest.slice(to)] } },
        };
      });
      if (plan.kind === "position") setOverview((prev) => mapOverviewCopy(prev, card.boardId, card.id, (c) => ({ ...c, position: plan.position })));
      const failed = async (body: unknown) => {
        toast(accessMessage(body, "Couldn't save the new order."), { tone: "danger" });
        await retry.current.focus();
      };
      try {
        const res =
          plan.kind === "renumber"
            ? await fetch(`/api/boards/${encodeURIComponent(card.boardId)}/order`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ movedId: card.id, afterId: plan.afterId, beforeId: plan.beforeId }),
              })
            : card.linked
              ? await fetch(`/api/boards/${encodeURIComponent(card.boardId)}/links/${encodeURIComponent(card.id)}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ position: plan.position }),
                })
              : await fetch(`/api/items/${encodeURIComponent(card.id)}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ position: plan.position }),
                });
        if (!res.ok) {
          await failed(await res.json().catch(() => null));
          return;
        }
        // A renumber moved every card's number: the column is read back whole,
        // and the overview with it the next time it shows.
        if (plan.kind === "renumber") {
          setOverviewStale(true);
          await retry.current.focus();
        }
      } catch {
        await failed(null);
      }
    },
    [toast],
  );

  // ── Create ────────────────────────────────────────────────────────

  const placeNew = useCallback(
    (card: BirdseyeCard, place: "top" | "bottom") => {
      const s = stateRef.current;
      const list = listById(card.boardId);
      const statuses = list?.statuses ?? [];
      if (findCopy(s.overview, s.focus, card.boardId, card.id)) return false;
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
      if (list && cardMatchesFilters(card, s.q, s.hideClosed && !card.linked, statuses) && !(s.hideClosed && cardClosedHere(card, statuses))) {
        adjustLists(card.boardId, (l) => countDelta(l, l.statuses, card.status, 1, s.hideClosed, cardClosedHere(card, l.statuses)));
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

  /** One copy's subtasks: a linked card's are read in the List it is shown in. */
  const loadSubtasks = useCallback(
    async (listId: string, parentId: string) => {
      const key = copyKey(listId, parentId);
      setSubtasks((prev) => ({ ...prev, [key]: { state: "loading", rows: prev[key]?.rows ?? [] } }));
      const parent = findCopy(stateRef.current.overview, stateRef.current.focus, listId, parentId);
      const ctx = parent?.linked ? `?list=${encodeURIComponent(listId)}` : "";
      const r = await apiFetch<{ subtasks: BoardItemRow[] }>(`/api/items/${encodeURIComponent(parentId)}/subtasks${ctx}`, {
        cache: "no-store",
      });
      if (!mounted.current) return;
      if (!r.ok) {
        setSubtasks((prev) => ({ ...prev, [key]: { state: "error", rows: prev[key]?.rows ?? [] } }));
        return;
      }
      // A linked parent's subtasks keep their home statuses; each shows under
      // this List's matching status, as the Board shows them.
      const statusesHere = parent?.linked ? (listById(listId)?.statuses ?? []) : null;
      const rows = (r.data.subtasks ?? []).map((st) => ({
        id: st.id,
        title: st.title,
        status: (statusesHere ? boardStatusFor(st, listId, statusesHere) : st.status) ?? null,
      }));
      setSubtasks((prev) => ({ ...prev, [key]: { state: "ready", rows } }));
      // The pill counts what this route opens, so a fresh answer is the count.
      const setCount = (c: BirdseyeCard) => (c.subtaskCount === rows.length ? c : { ...c, subtaskCount: rows.length });
      setOverview((prev) => mapOverviewCopy(prev, listId, parentId, setCount));
      setFocus((prev) => mapFocusCopy(prev, listId, parentId, setCount));
    },
    [listById],
  );

  /** The subtasks of every copy of a task on screen (its drawer closed, a subtask changed). */
  const loadSubtasksOf = useCallback(
    (parentId: string) => {
      const s = stateRef.current;
      for (const copy of copiesOf(s.overview, s.focus, parentId)) void loadSubtasks(copy.boardId, parentId);
    },
    [loadSubtasks],
  );

  // ── Other people's changes ────────────────────────────────────────

  /** One copy leaves the screen (the task left that List), and that List's counts follow. */
  const removeCopy = useCallback(
    (listId: string, id: string) => {
      const s = stateRef.current;
      const card = findCopy(s.overview, s.focus, listId, id);
      if (!card) return;
      setOverview((prev) => mapOverviewCopy(prev, listId, id, () => null));
      setFocus((prev) => {
        if (!prev || prev.boardId !== listId) return prev;
        const at = focusColumnOf(prev, listId, id);
        const columns = mapCards(prev.columns, id, () => null);
        if (at && columns[at]) columns[at] = { ...columns[at], total: Math.max(0, columns[at].total - 1) };
        return { ...prev, columns };
      });
      adjustLists(listId, (l) => countDelta(l, l.statuses, card.status, -1, s.hideClosed, cardClosedHere(card, l.statuses)));
    },
    [adjustLists],
  );

  /** Every copy of a task leaves (it is archived, deleted, or no longer readable at all). */
  const removeTask = useCallback(
    (id: string) => {
      const s = stateRef.current;
      for (const copy of copiesOf(s.overview, s.focus, id)) removeCopy(copy.boardId, id);
    },
    [removeCopy],
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

  /** Re-read the view without a spinner: a task whose kind in a List changed (linked there, now its home). */
  const reloadQuietly = useCallback(() => {
    if (stateRef.current.focusId) {
      setOverviewStale(true);
      void retry.current.focus();
    } else {
      void retry.current.overview();
    }
  }, []);

  /**
   * A task that has just come into List `listId` (linked there, moved there)
   * while no copy of it is on screen there. It is read in that List and
   * placed only where the loaded pages reach: a column with more pages to
   * come gets it with Show more, in its own place, never twice.
   *
   * COUNTED ONLY WHEN PROVEN. An event names every List a task is in, so a
   * task that was always in the List but sits past the loaded pages looks
   * the same as one that just arrived; it is already in the counts. So the
   * counts move only for a card that was placed (the loaded pages reach it:
   * then it was not there before), or with `known` (this view saw it leave
   * another List on screen), which also puts it at the top of its new column
   * when the loaded pages do not reach it, as a task made here would be.
   */
  const arriveIn = useCallback(
    async (listId: string, id: string, known = false) => {
      const list = listById(listId);
      if (!list || findCopy(stateRef.current.overview, stateRef.current.focus, listId, id)) return;
      const r = await apiFetch<TaskBody>(`/api/items/${encodeURIComponent(id)}?list=${encodeURIComponent(listId)}`, { cache: "no-store" });
      if (!mounted.current || !r.ok) return;
      const s = stateRef.current;
      if (findCopy(s.overview, s.focus, listId, id)) return;
      const card = arrivalCard(r.data, list);
      if (!card) return;
      if (!cardMatchesFilters(card, s.q, false, list.statuses) || (s.hideClosed && cardClosedHere(card, list.statuses))) return;
      let placed = false;
      const col = s.overview[listId];
      // A hidden overview under older filters reloads when it is shown again.
      if (col && !s.overviewStale && reachesLoaded(card, col.cards, col.nextCursor)) {
        placed = true;
        setOverview((prev) => (prev[listId] ? { ...prev, [listId]: { ...prev[listId], cards: insertInOrder(prev[listId].cards, card) } } : prev));
      }
      if (s.focus && s.focus.boardId === listId) {
        const bucket = bucketFor(list.statuses, card.status);
        const fcol = s.focus.columns[bucket];
        if (fcol && reachesLoaded(card, fcol.cards, fcol.nextCursor)) {
          placed = true;
          setFocus((prev) => {
            if (!prev || prev.boardId !== listId || !prev.columns[bucket]) return prev;
            const c = prev.columns[bucket];
            return { ...prev, columns: { ...prev.columns, [bucket]: { ...c, cards: insertInOrder(c.cards, card), total: c.total + 1 } } };
          });
        }
      }
      if (placed) {
        adjustLists(listId, (l) => countDelta(l, l.statuses, card.status, 1, s.hideClosed, cardClosedHere(card, l.statuses)));
      } else if (known) {
        // placeNew counts it once and shows it at the top of its column.
        placeNew(card, "top");
      }
    },
    [listById, adjustLists, placeNew],
  );

  /**
   * Re-read ONE copy in the List it is shown in. A linked copy is read with
   * ?list= and folded in by the Board's own merge (mergeRefetchedRow), then
   * rebuilt by the server's card builder, so its column, reason line and drag
   * follow a new home status or a new role; it leaves when the answer is no
   * longer for this List. A home copy follows its status and leaves when it
   * moved, became a subtask of a card here, or was archived.
   */
  const refreshCopy = useCallback(
    async (copy: BirdseyeCard) => {
      const listId = copy.boardId;
      const id = copy.id;
      const ctx = copy.linked ? `?list=${encodeURIComponent(listId)}` : "";
      const r = await apiFetch<TaskBody>(`/api/items/${encodeURIComponent(id)}${ctx}`, { cache: "no-store" });
      if (!mounted.current) return;
      if (!r.ok) {
        // Not readable at all any more: no List on screen may keep it.
        if (r.status === 404) removeTask(id);
        return;
      }
      const s = stateRef.current;
      const onScreen = findCopy(s.overview, s.focus, listId, id);
      const item = r.data.item;
      if (!item || !onScreen) return;
      const key = keyOf(onScreen);
      const busy = pending.current.has(key);
      if (onScreen.linked) {
        const list = listById(listId);
        const outcome = list ? refreshLinkedCopy(onScreen, r.data, list) : ({ action: "drop" } as const);
        if (outcome.action === "reload") {
          reloadQuietly();
          return;
        }
        if (outcome.action === "drop" || !list) {
          removeCopy(listId, id);
          return;
        }
        const rebuilt = outcome.card;
        const placed = rebuilt.status;
        const closed = { from: cardClosedHere(onScreen, list.statuses), to: cardClosedHere(rebuilt, list.statuses) };
        if (!busy && (placed !== onScreen.status || closed.from !== closed.to)) moveEverywhere(onScreen, onScreen.status, placed, closed);
        // While a status change is in flight its optimistic column and home
        // value stand; the answer after it lands brings the rest.
        const mergeLinked = (c: BirdseyeCard): BirdseyeCard => ({
          ...rebuilt,
          subtaskCount: c.subtaskCount,
          status: busy ? c.status : placed,
          rank: c.rank,
          linked: busy ? c.linked : rebuilt.linked,
        });
        setOverview((prev) => mapOverviewCopy(prev, listId, id, mergeLinked));
        setFocus((prev) => mapFocusCopy(prev, listId, id, mergeLinked));
        if (stateRef.current.subtasks[key]) void loadSubtasks(listId, id);
        return;
      }
      // It became a subtask of a card on screen in this List: it is no longer
      // a card of its own. (A child whose parent is not a live row of its List
      // stays a card, the Board's rule, and such a parent is never on screen.)
      const pid = item.parentItemId ?? null;
      const stillTop = !pid || !findCopy(s.overview, s.focus, listId, pid);
      const home = item.boardId ?? listId;
      if (item.archivedAt || !stillTop || home !== listId) {
        removeCopy(listId, id);
        if (!item.archivedAt && stillTop && home !== listId && shownRef.current.has(home)) {
          // Moved between two Lists on screen: read in its new List (a
          // reader who reaches it there only through a link gets that List's
          // linked card, never a bare home card), at its place or the top.
          void arriveIn(home, id, true);
        }
        return;
      }
      if ((item.status ?? null) !== onScreen.status && !busy) {
        moveEverywhere(onScreen, onScreen.status, item.status ?? null);
      }
      const merge = (c: BirdseyeCard) => ({ ...cardFromRow(item, c), status: busy ? c.status : (item.status ?? null), rank: c.rank });
      setOverview((prev) => mapOverviewCopy(prev, listId, id, merge));
      setFocus((prev) => mapFocusCopy(prev, listId, id, merge));
      if (stateRef.current.subtasks[key]) void loadSubtasks(listId, id);
    },
    [removeTask, removeCopy, loadSubtasks, listById, moveEverywhere, reloadQuietly, arriveIn],
  );
  useEffect(() => {
    refreshCopyRef.current = refreshCopy;
  }, [refreshCopy]);

  /**
   * Re-read every copy of a task on screen, each in its own List. A task
   * with no copy on screen may be a subtask of one that is: those parents'
   * subtasks are re-read. `arriving` names Lists on screen it has just come
   * into without a copy there.
   */
  const refreshTask = useCallback(
    async (id: string, arriving: readonly string[] = []) => {
      const s = stateRef.current;
      const copies = copiesOf(s.overview, s.focus, id);
      if (copies.length > 0) {
        await Promise.all(copies.map((copy) => refreshCopy(copy)));
      } else {
        const r = await apiFetch<ItemBody>(`/api/items/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!mounted.current) return;
        const parentId = r.ok ? (r.data.item?.parentItemId ?? null) : null;
        if (parentId) loadSubtasksOf(parentId);
      }
      for (const listId of arriving) void arriveIn(listId, id);
    },
    [refreshCopy, loadSubtasksOf, arriveIn],
  );

  const applyItemEvent = useCallback(
    (detail: ItemEventDetail | null | undefined) => {
      if (!detail || detail.type !== "item" || !detail.itemId) return;
      const id = detail.itemId;
      const s = stateRef.current;
      if (detail.gone) {
        removeTask(id);
        return;
      }
      // The Lists it just left drop their copy, as their Boards drop the row.
      const left = new Set(detail.leftListIds ?? []);
      for (const listId of left) removeCopy(listId, id);
      const copies = copiesOf(s.overview, s.focus, id).filter((c) => !left.has(c.boardId));
      const shownHere = (listId: string) => shownRef.current.has(listId) && !left.has(listId) && !copies.some((c) => c.boardId === listId);
      // Lists on screen it now appears in without a copy there: the home it
      // names, and every List it is linked into.
      const arriving = [...new Set([...(detail.listIds ?? []), ...(detail.boardId ? [detail.boardId] : [])])].filter(shownHere);
      if (copies.length === 0 && arriving.length === 0 && !(detail.boardId && shownRef.current.has(detail.boardId))) return;
      const timers = refreshTimers.current;
      const existing = timers.get(id);
      if (existing) clearTimeout(existing);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void refreshTask(id, arriving);
        }, 300),
      );
    },
    [removeTask, removeCopy, refreshTask],
  );

  const applyItemCreated = useCallback(
    (detail: ItemCreatedDetail | null | undefined) => {
      const item = detail?.item;
      const boardId = detail?.boardId ?? item?.boardId ?? null;
      if (!item?.id || !boardId || !shownRef.current.has(boardId)) return;
      const s = stateRef.current;
      if (item.parentItemId) {
        // Its parent's subtasks, in every List the parent is shown in.
        loadSubtasksOf(item.parentItemId);
        return;
      }
      if (createdHere.current.has(item.id)) return;
      if (findCopy(s.overview, s.focus, boardId, item.id)) return;
      // Re-read it: the event carries whatever row its sender had, and the
      // card is built from the task as it is now.
      void apiFetch<ItemBody>(`/api/items/${encodeURIComponent(item.id)}`, { cache: "no-store" }).then((r) => {
        if (!mounted.current || !r.ok || !r.data.item || r.data.item.parentItemId || r.data.item.archivedAt) return;
        const statuses = listById(boardId)?.statuses ?? [];
        placeNew({ ...cardFromRow(r.data.item), boardId, rank: bucketRank(statuses, r.data.item.status) }, "top");
      });
    },
    [loadSubtasksOf, listById, placeNew],
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
    loadSubtasksOf,
    refreshTask,
    reorderCard,
    applyItemEvent,
    applyItemCreated,
  };
}

export type BirdseyeData = ReturnType<typeof useBirdseye>;
