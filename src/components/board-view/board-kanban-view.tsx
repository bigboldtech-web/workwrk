"use client";

// BoardKanbanView — KANBAN renderer for studio-item Boards.
//
// One column per status option. Cards carry the full ClickUp toolset (parity
// with the List row): the title (inline-rename), an interactive meta row
// (Assignee / Due / Priority / Tags — value when set, faint affordance on hover
// when empty), and a hover action rail top-right (Mark complete / Add subtask /
// Rename / "..." menu). Native HTML5 drag re-statuses a card between columns.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Columns3, Network, Pencil, Plus, Repeat, X } from "lucide-react";
import { PRIORITY_OPTIONS, buildSubtaskBody, isDoneStatus, splitBulkResults, bulkFailureMessage, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { ItemRole } from "@/lib/item-role";
import { countSubtasksByParent, groupCardsByStatus } from "@/lib/kanban-columns";
import { buildRecurrenceSummary } from "@/lib/recurrence";
import type { FieldDef } from "@/lib/field-catalog";
import { FieldValue } from "./field-value";
import { MultiAssigneePicker, type PersonRef } from "./assignee-picker";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import { DatePlanner } from "./date-planner";
import { ItemMoreMenu, type ItemMenuListContext } from "./item-more-menu";
import { BulkActionBar } from "./bulk-action-bar";
import { type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { accessMessage } from "@/lib/access-message";
import {
  boardStatusFor,
  homeStatusForBoardStatus,
  itemsUrl,
  linkedMenuFlags,
  linkedRowEditable,
  linkedRowKind,
  mergeRefetchedRow,
  optimisticLinkedStatus,
  planBulkStatus,
  refetchedFromRow,
  writeContext,
} from "@/lib/list-link-rows";
import { applyDefaultsToCreateBody, type LoadedListSettings } from "@/lib/list-defaults-client";
import { LinkedRowIndicator } from "./linked-row-indicator";

interface BoardKanbanViewProps {
  boardId: string;
  initialItems: BoardItemRow[];
  /** Custom fields from Board.schema.fields — the first two choice-type
   *  fields render as chips on each card. */
  initialFields?: FieldDef[];
  /** Per-List statuses (backbone #1) — one column per entry, in order. */
  statuses: StatusOption[];
  canEdit: boolean;
  /** Full access on the List. Only gates the card menu's Delete row, which
   *  wants full access OR the task's creator, never plain Can edit. */
  canDeleteTasks?: boolean;
  /** Viewer id, so a card the viewer created keeps its Delete row. */
  currentUserId?: string | null;
  onOpenItem?: (itemId: string) => void;
  /** Item-state ownership contract (2026-08-12) — same as BoardTableView:
   *  the board keeps an optimistic local copy of `initialItems` and re-syncs
   *  whenever the prop changes identity, so a parent that re-renders items
   *  (BoardCanvas does on every drawer edit) MUST wire these so its copy
   *  learns about every card mutation — otherwise its next re-render clobbers
   *  the local copy (new cards vanish, archived cards resurrect). */
  onItemCreated?: (item: BoardItemRow) => void;
  onItemPatched?: (id: string, patch: Partial<BoardItemRow>) => void;
  onItemRemoved?: (id: string) => void;
  onItemsRefreshed?: (items: BoardItemRow[]) => void;
  /** Space-module gating — hides the card's Priority / Tags / Start-timer when off. */
  priorityEnabled?: boolean;
  tagsEnabled?: boolean;
  timeTrackingEnabled?: boolean;
  /** Phase 5b: the List's defaults, keyed by the List they were read for. */
  loadedSettings?: LoadedListSettings | null;
  /** Phase 5b: the status a card has in THIS List (a linked card's home status, remapped). */
  statusOf?: (row: BoardItemRow) => string | null;
  /** The owner's Personal List: its tasks are never added to other Lists. */
  personalList?: boolean;
}

// What a bulk refusal of a card shown here THROUGH A LINK means.
const LINKED_ARCHIVE_REFUSED = "Tasks shown here from other Lists can't be archived or deleted from this List. Remove them from this List instead, or open their home List.";

export function BoardKanbanView({ boardId, initialItems, initialFields, statuses, canEdit, canDeleteTasks, currentUserId, onOpenItem, onItemCreated, onItemPatched, onItemRemoved, onItemsRefreshed, priorityEnabled = true, tagsEnabled = true, timeTrackingEnabled = true, loadedSettings = null, statusOf: statusOfProp, personalList = false }: BoardKanbanViewProps) {
  const confirm = useConfirm();
  // The column a card belongs to HERE: a card shown through a link stores its
  // home status, remapped into this board's set (Done stays Done).
  const statusOf = useCallback(
    (row: BoardItemRow) => (statusOfProp ? statusOfProp(row) : boardStatusFor(row, boardId, statuses)),
    [statusOfProp, boardId, statuses],
  );
  // Show all choice-type custom fields as chips on cards (capped so a card with
  // many fields doesn't sprawl) — so switching List → Board keeps custom data
  // visible.
  const chipFields = useMemo(
    () => (initialFields ?? []).filter((f) => f.type === "DROPDOWN" || f.type === "LABELS" || f.type === "MULTI_SELECT").slice(0, 6),
    [initialFields],
  );
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const itemsRef = useRef<BoardItemRow[]>(initialItems);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  // Multi-select for bulk actions (shared bar with the List view).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastSelectedRef = useRef<string | null>(null);

  // ── Item-state ownership (2026-08-12) ────────────────────────────────────
  // Cards created/removed locally while the parent has NOT wired the matching
  // callback are tracked so the resync effect can re-apply them over a stale
  // parent snapshot instead of dropping/resurrecting them. Entries settle
  // once an incoming snapshot reflects them.
  const unreportedAddsRef = useRef<Map<string, BoardItemRow>>(new Map());
  const unreportedRemovesRef = useRef<Set<string>>(new Set());
  const reportCreated = useCallback((item: BoardItemRow) => {
    if (onItemCreated) onItemCreated(item);
    else unreportedAddsRef.current.set(item.id, item);
  }, [onItemCreated]);
  const reportRemoved = useCallback((id: string) => {
    unreportedAddsRef.current.delete(id);
    if (onItemRemoved) onItemRemoved(id);
    else unreportedRemovesRef.current.add(id);
  }, [onItemRemoved]);

  // Re-sync when the parent passes a refreshed set — non-destructively (the
  // parent snapshot wins, then unreported local creates/removals re-apply).
  useEffect(() => {
    setItems(() => {
      const adds = unreportedAddsRef.current;
      const removes = unreportedRemovesRef.current;
      if (adds.size === 0 && removes.size === 0) return initialItems;
      const incoming = new Set(initialItems.map((r) => r.id));
      for (const id of Array.from(adds.keys())) if (incoming.has(id)) adds.delete(id);
      for (const id of Array.from(removes)) if (!incoming.has(id)) removes.delete(id);
      let next = initialItems;
      if (removes.size > 0) next = next.filter((r) => !removes.has(r.id));
      if (adds.size > 0) next = [...next, ...adds.values()];
      return next;
    });
  }, [initialItems]);

  const statusOrder = useMemo(() => statuses.map((o) => o.value), [statuses]);
  const firstStatus = statusOrder[0] ?? "TO_DO";
  // Columns hold TOP-LEVEL cards only. A subtask drawn loose in a column beside
  // its parent is indistinguishable from an unrelated new task, which is how
  // the card's "+" got reported as "it makes a task, not a subtask". The
  // parent's subtask count is the signal; opening the parent shows the
  // children. A subtask whose parent is not on this board is re-rooted rather
  // than hidden. See lib/kanban-columns.ts for both rules and their tests.
  const grouped = useMemo(() => groupCardsByStatus(items, statusOrder, statusOf), [items, statusOrder, statusOf]);

  // Visible card order (column order, top→bottom) — the axis shift-select
  // ranges over.
  const orderedIds = useMemo(
    () => statusOrder.flatMap((s) => (grouped.get(s) ?? []).map((c) => c.id)),
    [statusOrder, grouped],
  );
  const toggleSelect = useCallback((id: string, shiftKey?: boolean) => {
    if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
      const a = orderedIds.indexOf(lastSelectedRef.current);
      const b = orderedIds.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = orderedIds.slice(lo, hi + 1);
        setSelected((prev) => { const next = new Set(prev); range.forEach((rid) => next.add(rid)); return next; });
        lastSelectedRef.current = id;
        return;
      }
    }
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    lastSelectedRef.current = id;
  }, [orderedIds]);
  const clearSelection = useCallback(() => { setSelected(new Set()); lastSelectedRef.current = null; }, []);
  // `refetch` is declared below (it needs `onItemsRefreshed`), so the bulk
  // handlers reach it through a ref rather than being reordered around it.
  const refetchRef = useRef<(() => Promise<void>) | null>(null);

  // Bulk actions. A field write is ONE request to /api/items/bulk, naming this
  // List (`contextBoardId`), the same as the List view: the server gates each
  // card on its own and answers per card, and a card shown here through a link
  // is written in this List's context. Archive and delete still go one
  // request per card. Either way the local (and parent-reported) change
  // applies ONLY to the cards the server accepted; the others stay visible,
  // unchanged and selected, and are named in the error banner for a retry.
  const runBulk = useCallback(async (ids: string[], patch: Record<string, unknown>): Promise<{ succeeded: string[]; failed: string[]; reasons: string[] }> => {
    try {
      const res = await fetch("/api/items/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, patch, contextBoardId: boardId }),
      });
      const data = (await res.json().catch(() => null)) as { results?: Array<{ id: string; ok: boolean; reason?: string }> } | null;
      if (res.ok && Array.isArray(data?.results)) {
        return {
          succeeded: data.results.filter((r) => r.ok).map((r) => r.id),
          failed: data.results.filter((r) => !r.ok).map((r) => r.id),
          reasons: data.results.filter((r) => !r.ok && r.reason).map((r) => r.reason as string),
        };
      }
    } catch {
      // Network failure: nothing applied, everything stays selected.
    }
    return { succeeded: [], failed: ids, reasons: [] };
  }, [boardId]);
  const reasonSentences = (reasons: string[]): string => {
    const out: string[] = [];
    if (reasons.includes("invalid_status")) out.push("Some tasks from other Lists weren't changed because that status isn't one of their home List's statuses.");
    if (reasons.includes("use_list_link")) out.push(LINKED_ARCHIVE_REFUSED);
    return out.length ? ` ${out.join(" ")}` : "";
  };
  const linkedIdsOf = useCallback((ids: string[]) => {
    const byId = new Map(itemsRef.current.map((r) => [r.id, r] as const));
    return new Set(ids.filter((id) => { const r = byId.get(id); return r ? linkedRowKind(r, boardId) !== "home" : false; }));
  }, [boardId]);

  const bulkPatch = useCallback(async (body: Record<string, unknown>, local: Partial<BoardItemRow>) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const touchesLinked = linkedIdsOf(ids).size > 0;
    const { succeeded, failed, reasons } = await runBulk(ids, body);
    setError(failed.length > 0 ? `${bulkFailureMessage("update", failed, ids.length, items)}${reasonSentences(reasons)}` : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.map((r) => (ok.has(r.id) ? { ...r, ...local } : r)));
    for (const id of succeeded) onItemPatched?.(id, local);
    setSelected(new Set(failed));
    setBulkBusy(false);
    if (touchesLinked && succeeded.length > 0) await refetchRef.current?.();
    // reasonSentences is a pure formatter recreated per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, onItemPatched, items, runBulk, linkedIdsOf]);

  // Status across a mixed selection: home cards get this board's value, each
  // card shown through a link its mapped HOME value, and a linked card whose
  // home statuses are not shared with the viewer is skipped and named.
  const bulkStatus = useCallback(async (status: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const byId = new Map(itemsRef.current.map((r) => [r.id, r] as const));
    const rows = Array.from(selected).map((id) => byId.get(id)).filter((r): r is BoardItemRow => !!r);
    const plan = planBulkStatus(rows, status, boardId, statuses);
    const groups = [...(plan.home.length ? [{ ids: plan.home, status }] : []), ...plan.linked];
    const succeeded: string[] = [];
    const failed: string[] = [];
    const reasons: string[] = [];
    for (const g of groups) {
      const r = await runBulk(g.ids, { status: g.status });
      succeeded.push(...r.succeeded);
      failed.push(...r.failed);
      reasons.push(...r.reasons);
    }
    const valueFor = new Map<string, string>();
    for (const g of groups) for (const id of g.ids) valueFor.set(id, g.status);
    const ok = new Set(succeeded);
    setItems((prev) => prev.map((r) => {
      if (!ok.has(r.id)) return r;
      const v = valueFor.get(r.id) ?? status;
      return linkedRowKind(r, boardId) === "home" ? { ...r, status: v } : optimisticLinkedStatus(r, v);
    }));
    for (const id of succeeded) {
      const row = byId.get(id);
      const v = valueFor.get(id) ?? status;
      onItemPatched?.(id, row && linkedRowKind(row, boardId) !== "home" ? optimisticLinkedStatus(row, v) : { status: v });
    }
    const messages: string[] = [];
    if (failed.length > 0) messages.push(`${bulkFailureMessage("update", failed, rows.length, items)}${reasonSentences(reasons)}`);
    if (plan.skipped.length > 0) messages.push(`${plan.skipped.length} task${plan.skipped.length === 1 ? "" : "s"} from other Lists weren't changed because their home List's statuses aren't shared with you.`);
    setError(messages.length ? messages.join(" ") : null);
    setSelected(new Set([...failed, ...plan.skipped]));
    setBulkBusy(false);
    if (plan.linked.length > 0 && succeeded.length > 0) await refetchRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, boardId, statuses, runBulk, onItemPatched, items]);

  // "Set owner" and "Clear assignees" are two different writes, because an
  // ownerId-only patch MERGES on the server (the named person moves to the
  // front of whoever is already on the task; a null merely drops the outgoing
  // owner and promotes the next assignee). Clearing therefore sends an
  // explicit empty set, the one write that means "nobody", and an owner change
  // re-reads the board because the merged result cannot be computed here.
  const bulkOwner = useCallback(async (ownerId: string | null) => {
    if (ownerId === null) {
      await bulkPatch({ assigneeIds: [] }, { ownerId: null, owner: null, assigneeIds: [], assignees: [] });
      return;
    }
    await bulkPatch({ ownerId }, { ownerId });
    await refetchRef.current?.();
  }, [bulkPatch]);

  const bulkArchive = useCallback(async () => {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Archive cards", description: `Archive ${selected.size} card${selected.size === 1 ? "" : "s"}?`, destructive: true, confirmLabel: "Archive" }))) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    // A card shown here through a link names this List, so the server refuses
    // it rather than archiving the task everywhere; the banner says why.
    const linked = linkedIdsOf(ids);
    const { succeeded, failed } = await splitBulkResults(ids, (id) =>
      fetch(`/api/items/${id}${linked.has(id) ? `?list=${encodeURIComponent(boardId)}` : ""}`, { method: "DELETE" }),
    );
    setError(failed.length > 0 ? `${bulkFailureMessage("archive", failed, ids.length, items)}${failed.some((id) => linked.has(id)) ? ` ${LINKED_ARCHIVE_REFUSED}` : ""}` : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.filter((r) => !ok.has(r.id)));
    for (const id of succeeded) reportRemoved(id);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, confirm, reportRemoved, items, linkedIdsOf, boardId]);
  const bulkTrash = useCallback(async () => {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Delete cards", description: `Delete ${selected.size} card${selected.size === 1 ? "" : "s"}? They move to Trash and can be restored for 60 days.`, destructive: true, confirmLabel: "Delete" }))) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const linked = linkedIdsOf(ids);
    const { succeeded, failed } = await splitBulkResults(ids, (id) =>
      fetch(`/api/items/${id}?hard=1${linked.has(id) ? `&list=${encodeURIComponent(boardId)}` : ""}`, { method: "DELETE" }),
    );
    setError(failed.length > 0 ? `${bulkFailureMessage("delete", failed, ids.length, items)}${failed.some((id) => linked.has(id)) ? ` ${LINKED_ARCHIVE_REFUSED}` : ""}` : null);
    const ok = new Set(succeeded);
    setItems((prev) => prev.filter((r) => !ok.has(r.id)));
    for (const id of succeeded) reportRemoved(id);
    setSelected(new Set(failed));
    setBulkBusy(false);
  }, [selected, confirm, reportRemoved, items, linkedIdsOf, boardId]);

  // Subtask counts per parent — shown on each card (ClickUp "N subtasks").
  const subtaskCountByParent = useMemo(() => countSubtasksByParent(items), [items]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(itemsUrl(boardId), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.items) {
        // Fresh server truth supersedes tracked local mutations; hand it to
        // the parent when wired (its resync flows back down) so a later
        // parent re-render can't regress below what we just fetched.
        unreportedAddsRef.current.clear();
        unreportedRemovesRef.current.clear();
        if (onItemsRefreshed) onItemsRefreshed(data.items);
        else setItems(data.items);
      }
    } catch {}
  }, [boardId, onItemsRefreshed]);

  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  // Optimistic PATCH — merges a display patch locally, sends the API body, and
  // refetches on failure. Backs assignee / due / priority / tags / status edits.
  const patchCard = useCallback(async (id: string, apiBody: Record<string, unknown>, localPatch: Partial<BoardItemRow>) => {
    const card = itemsRef.current.find((r) => r.id === id);
    // A card shown here through a link is edited only as far as the viewer's
    // role on the TASK goes.
    if (!canEdit || (card && !linkedRowEditable(card, canEdit))) return;
    const linked = card ? linkedRowKind(card, boardId) !== "home" : false;
    const optimisticFor = (r: BoardItemRow): BoardItemRow => {
      const next: BoardItemRow = { ...r, ...localPatch };
      return linked && typeof apiBody.status === "string" ? optimisticLinkedStatus(next, apiBody.status) : next;
    };
    setItems((prev) => prev.map((r) => (r.id === id ? optimisticFor(r) : r)));
    onItemPatched?.(id, linked && card ? optimisticFor(card) : localPatch);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Every write from a card shown here through a link names this List.
        body: JSON.stringify({ ...apiBody, ...writeContext(card, boardId) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(accessMessage(d, "Couldn't save that change.")); await refetch(); return; }
      const d = await res.json().catch(() => null);
      const fresh = d?.item as BoardItemRow | undefined;
      // A linked card takes the answer, which is the card as THIS List shows
      // it: its home status pill, its link and this List's values.
      if (linked && fresh && card) {
        const out = mergeRefetchedRow(optimisticFor(card), refetchedFromRow(fresh), boardId);
        if (out.action === "merge") {
          setItems((prev) => prev.map((r) => (r.id === id ? out.row : r)));
          onItemPatched?.(id, out.row);
        } else {
          await refetch();
        }
        return;
      }
      // Recurring task completed → server rolled it forward (reset status +
      // advanced dates). Apply the returned row so the card visibly recurs.
      if (d?.recurred && fresh) {
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...fresh } : r)));
        onItemPatched?.(id, fresh as Partial<BoardItemRow>);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed"); await refetch(); }
  }, [canEdit, refetch, onItemPatched, boardId]);

  // A drop into a column. A card shown here through a link writes the HOME
  // status that column maps to (its status belongs to its home set); with no
  // home set known, it cannot be dragged at all.
  const moveTo = useCallback((id: string, newStatus: string) => {
    const card = itemsRef.current.find((r) => r.id === id);
    if (card && linkedRowKind(card, boardId) !== "home") {
      const home = homeStatusForBoardStatus(card, newStatus, statuses);
      if (!home) return;
      void patchCard(id, { status: home }, { status: home });
      return;
    }
    void patchCard(id, { status: newStatus }, { status: newStatus });
  }, [patchCard, boardId, statuses]);

  const toggleComplete = useCallback((card: BoardItemRow) => {
    // A card shown through a link completes in its HOME set.
    const set = linkedRowKind(card, boardId) !== "home" ? card.listLink?.homeStatuses ?? [] : statuses;
    if (set.length === 0) return;
    const done = isDoneStatus(set, card.status);
    const first = set.find((s) => s.group === "ACTIVE")?.value ?? set[0]?.value;
    const doneValue = set.find((s) => s.group === "DONE")?.value ?? set.find((s) => s.group !== "ACTIVE")?.value ?? null;
    const next = done ? first : (doneValue ?? first);
    if (!next) return;
    void patchCard(card.id, { status: next }, { status: next });
  }, [statuses, patchCard, boardId]);

  // Newly-created card/subtask id to drop straight into title-edit (with the
  // placeholder text selected) so the user types the name — no click-to-rename.
  const [autoEditId, setAutoEditId] = useState<string | null>(null);

  const addCard = useCallback(async (status: string) => {
    if (!canEdit) return;
    try {
      // The column is the person's choice, so its status is never replaced by
      // the List's default; the other defaults still apply on the server.
      const body = applyDefaultsToCreateBody({ title: "New item", status }, loadedSettings, new Set(["status"]), boardId);
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(accessMessage(data, "Couldn't add a card here.")); return; }
      setItems((prev) => [...prev, data.item as BoardItemRow]);
      if (data?.item) reportCreated(data.item as BoardItemRow);
      if (data?.item?.id) setAutoEditId(data.item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    }
  }, [boardId, canEdit, reportCreated, loadedSettings]);

  // Type-first, same contract as the List view's inline subtask row: the title
  // the user typed is the only title ever POSTed. The old version sent the
  // literal "New subtask" and relied on a rename landing afterwards, so an
  // interrupted rename left that string in the database.
  //
  // The created child is kept in `items` (the parent's count badge reads it)
  // but never becomes a card of its own, because groupCardsByStatus folds
  // children away.
  const addSubtask = useCallback(async (
    parentId: string,
    parentStatus: string | null,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!canEdit) return { ok: false, error: "You don't have edit access to this list" };
    const built = buildSubtaskBody({ title, parentId, parentStatus, fallbackStatus: firstStatus });
    if (!built) return { ok: false };
    // A subtask under a card shown here through a link is created in the
    // parent's HOME (with the home's defaults); one at home here inherits the
    // parent's status, which counts as chosen.
    const parent = itemsRef.current.find((r) => r.id === parentId);
    const body = parent && linkedRowKind(parent, boardId) !== "home"
      ? built
      : applyDefaultsToCreateBody(built as unknown as Record<string, unknown>, loadedSettings, new Set(parentStatus ? ["status"] : []), boardId);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // accessMessage, not data.error: POST /api/boards/[id]/items answers
        // a refusal as the bare code "Forbidden", which is what the user read.
        const msg = accessMessage(data, `Save failed (HTTP ${res.status})`);
        setError(msg);
        return { ok: false, error: msg };
      }
      if (data?.item) { setItems((prev) => [...prev, data.item as BoardItemRow]); reportCreated(data.item as BoardItemRow); }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add subtask";
      setError(msg);
      return { ok: false, error: msg };
    }
  }, [boardId, canEdit, firstStatus, reportCreated, loadedSettings]);

  // One endpoint owns what a copy carries (POST /api/items/[id]/duplicate).
  // The body this used to send dropped the assignees, the tags, both dates and
  // the priority.
  const duplicateCard = useCallback(async (card: BoardItemRow) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/items/${card.id}/duplicate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // A copy of a card shown here through a link lives in its HOME, and is
      // here only if it was linked here too: the board is re-read.
      if (res.ok && linkedRowKind(card, boardId) !== "home") {
        await refetch();
        return;
      }
      if (res.ok && data?.item) {
        setItems((prev) => [...prev, data.item as BoardItemRow]);
        reportCreated(data.item as BoardItemRow);
        return;
      }
      // There was no else branch and the catch was empty, so a refused
      // Duplicate produced nothing at all and the row looked like a dead
      // button. Every refusal gets a sentence, the same way the List view's
      // Duplicate already does.
      setError(accessMessage(data, "Couldn't duplicate this task."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't duplicate this task.");
    }
  }, [canEdit, reportCreated, boardId, refetch]);

  const removeLocal = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    reportRemoved(id);
  }, [reportRemoved]);

  const archiveCard = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!(await confirm({ title: "Archive card", description: "Archive this card? You can restore it later from Trash.", destructive: true, confirmLabel: "Archive" }))) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    reportRemoved(id);
    try {
      const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // The card reappearing with no message reads as a glitch. Say why.
        const d = await res.json().catch(() => ({}));
        setError(accessMessage(d, "Couldn't archive that card."));
        await refetch();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't archive that card.");
      await refetch();
    }
  }, [canEdit, confirm, refetch, reportRemoved]);

  return (
    <div className="space-y-2">
      {error ? (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 rounded-md flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      {statuses.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
          <Columns3 className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
          <p className="text-base text-zinc-500">This board has no statuses yet. Add a status to group your cards into columns.</p>
        </div>
      ) : (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {statuses.map((meta) => {
          const status = meta.value;
          const cards = grouped.get(status) ?? [];
          const isHover = hoverColumn === status;
          return (
            <div
              key={status}
              className={`group/col flex flex-col w-[300px] flex-shrink-0 rounded-xl bg-zinc-100/60 p-2 transition-colors ${
                isHover ? "outline-2 outline-dashed -outline-offset-2 outline-[var(--os-brand)]" : ""
              }`}
              onDragOver={(e) => {
                if (!canEdit || !dragId) return;
                e.preventDefault();
                setHoverColumn(status);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setHoverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHoverColumn(null);
                if (!dragId || !canEdit) return;
                const card = items.find((r) => r.id === dragId);
                // "Already in this column" is the card's status HERE.
                if (card && statusOf(card) !== status) moveTo(dragId, status);
                setDragId(null);
              }}
            >
              <div className="flex items-center gap-2 px-1 pt-0.5 pb-2.5">
                <span
                  className="inline-flex items-center h-5 rounded-[5px] px-2 text-micro font-semibold uppercase tracking-wider text-white"
                  style={{ background: meta.color }}
                >
                  {meta.label}
                </span>
                <span className="text-xs font-medium text-zinc-400 tabular-nums">{cards.length}</span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/70 opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100 transition-opacity"
                    aria-label={`Add task to ${meta.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="flex-1 space-y-2 min-h-[40px]">
                {cards.map((card) => {
                  // A card shown here THROUGH A LINK: edited only as far as
                  // the task role goes, dragged only when its home set is
                  // known (a drop writes a home status), its menu from the
                  // link's own flags.
                  const kind = linkedRowKind(card, boardId);
                  const cardCanEdit = linkedRowEditable(card, canEdit);
                  const flags = linkedMenuFlags(card, boardId, canEdit, currentUserId ?? null, { personalList });
                  const draggable = cardCanEdit && (kind === "home" || homeStatusForBoardStatus(card, statuses[0]?.value ?? "", statuses) !== null);
                  const listContext: ItemMenuListContext | undefined = kind === "home"
                    ? (flags.canAddToList ? { boardId, kind: "home", canAddToList: true } : undefined)
                    : {
                        boardId,
                        kind: "linked",
                        homeBoardId: card.listLink?.homeList?.id ?? null,
                        homeStatuses: card.listLink?.homeStatuses,
                        canRemoveFromList: flags.canRemoveFromList,
                        canLinkMove: flags.canLinkMove,
                        canAddToList: flags.canAddToList,
                        linkedSubtask: flags.linkedSubtask,
                      };
                  return (
                  <KanbanCard
                    key={card.id}
                    boardId={boardId}
                    card={card}
                    chipFields={chipFields}
                    subtaskCount={subtaskCountByParent.get(card.id) ?? 0}
                    // A linked card's status is a value of its HOME set: its
                    // done state and date planner read that set, or at least
                    // its own home status when the set is not shared.
                    statuses={
                      kind === "home"
                        ? statuses
                        : card.listLink?.homeStatuses ?? (card.listLink?.homeStatus ? [card.listLink.homeStatus] : statuses)
                    }
                    canEdit={cardCanEdit}
                    draggableCard={draggable}
                    menuRole={kind === "home" ? undefined : flags.role}
                    menuIsCreator={kind === "home" ? undefined : flags.isCreator}
                    listContext={listContext}
                    homeBoardId={card.listLink?.homeList?.id ?? null}
                    currentUserId={currentUserId ?? null}
                    canDelete={
                      kind !== "home" || canDeleteTasks === undefined
                        ? undefined
                        : canDeleteTasks || (!!currentUserId && card.createdBy?.id === currentUserId)
                    }
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(null); setHoverColumn(null); }}
                    isDragging={dragId === card.id}
                    selected={selected.has(card.id)}
                    onToggleSelect={toggleSelect}
                    onOpen={onOpenItem ? () => onOpenItem(card.id) : undefined}
                    onPatch={patchCard}
                    onToggleComplete={() => toggleComplete(card)}
                    onAddSubtask={(title) => addSubtask(card.id, card.status, title)}
                    onDuplicate={() => duplicateCard(card)}
                    onArchive={() => archiveCard(card.id)}
                    onDeleted={() => removeLocal(card.id)}
                    autoEdit={autoEditId === card.id}
                    onAutoEditHandled={() => setAutoEditId(null)}
                    priorityEnabled={priorityEnabled}
                    tagsEnabled={tagsEnabled}
                    timeTrackingEnabled={timeTrackingEnabled}
                  />
                  );
                })}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    className="w-full inline-flex items-center gap-1.5 text-left text-xs font-medium text-zinc-400 hover:text-zinc-700 py-1.5 px-2 rounded-md hover:bg-zinc-200/60 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Task
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <BulkActionBar
        selectedCount={selected.size}
        busy={bulkBusy}
        statuses={statuses}
        priorities={PRIORITY_OPTIONS}
        onClear={clearSelection}
        onArchive={bulkArchive}
        onStatus={(status) => void bulkStatus(status)}
        onDueAt={(iso) => bulkPatch({ dueAt: iso }, { dueAt: iso })}
        onOwner={(ownerId) => void bulkOwner(ownerId)}
        boardId={boardId}
        onPriority={(priority) => bulkPatch({ priority }, { priority })}
        onTrash={bulkTrash}
      />
    </div>
  );
}

/** The stored watcher list on a card, so Watch reads "Unwatch" when it should. */
function cardWatcherIds(card: BoardItemRow): string[] {
  const md = (card.metadata as Record<string, unknown> | undefined) ?? {};
  return Array.isArray(md.watchers) ? (md.watchers as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

/** Everyone on the card, primary first. A legacy row carrying an ownerId and
 *  no assigneeIds still yields the one person, which is the same repair
 *  applyOwnerOnlyPatch does on the server. */
function cardAssignees(card: BoardItemRow): PersonRef[] {
  const people = card.assignees ?? [];
  if (people.length) return people.map((p) => ({ ...p, email: p.email ?? null }));
  return card.owner ? [{ ...card.owner, email: null }] : [];
}

function KanbanCard({
  boardId,
  card,
  chipFields,
  subtaskCount,
  statuses,
  canEdit,
  draggableCard,
  menuRole,
  menuIsCreator,
  listContext,
  homeBoardId,
  currentUserId,
  canDelete,
  onDragStart,
  onDragEnd,
  isDragging,
  selected,
  onToggleSelect,
  onOpen,
  onPatch,
  onToggleComplete,
  onAddSubtask,
  onDuplicate,
  onArchive,
  onDeleted,
  autoEdit = false,
  onAutoEditHandled,
  priorityEnabled = true,
  tagsEnabled = true,
  timeTrackingEnabled = true,
}: {
  boardId: string;
  card: BoardItemRow;
  chipFields: FieldDef[];
  subtaskCount: number;
  statuses: StatusOption[];
  canEdit: boolean;
  /** Phase 5b: a linked card drags only when its home set is known. */
  draggableCard: boolean;
  /** The TASK role for a card shown here through a link; undefined keeps the List's. */
  menuRole?: ItemRole | null;
  menuIsCreator?: boolean;
  listContext?: ItemMenuListContext;
  /** The task's home List, when the viewer can read it. */
  homeBoardId: string | null;
  /** undefined = the host could not work it out; the menu leaves Delete alone. */
  /** The viewer, for the card menu's "Assign to me" and "Watch". */
  currentUserId: string | null;
  canDelete?: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  selected: boolean;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onOpen?: () => void;
  onPatch: (id: string, apiBody: Record<string, unknown>, localPatch: Partial<BoardItemRow>) => void;
  onToggleComplete: () => void;
  /** Type-first: the card's inline input hands over the title the user typed. */
  onAddSubtask: (title: string) => Promise<{ ok: boolean; error?: string }>;
  onDuplicate: () => void;
  onArchive: () => void;
  onDeleted: () => void;
  autoEdit?: boolean;
  onAutoEditHandled?: () => void;
  priorityEnabled?: boolean;
  tagsEnabled?: boolean;
  timeTrackingEnabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const moreRef = useRef<ContextMenuHandle>(null);
  // Inline subtask composer (the card's "+"). Open means "type the name here",
  // never "a row called New subtask has already been saved".
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);
  // Seed the input from the current title only when entering edit mode — avoids
  // a prop-sync effect (which cascades renders).
  const startEdit = () => { setTitle(card.title); setEditing(true); };

  // Just-created card/subtask: drop into edit mode with the placeholder text
  // selected (the input's onFocus selects) so the user types the name directly.
  useEffect(() => {
    if (autoEdit && canEdit) { startEdit(); onAutoEditHandled?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit, canEdit]);

  const done = isDoneStatus(statuses, card.status);
  const tags = card.tags ?? [];
  const fieldChips = chipFields.filter((f) => {
    const v = card.metadata?.[f.key];
    return v != null && v !== "" && (!Array.isArray(v) || v.length > 0);
  });
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const iconBtn = "inline-flex items-center justify-center w-5 h-5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors";

  const saveTitle = () => {
    const next = title.trim();
    setEditing(false);
    if (next && next !== card.title) onPatch(card.id, { title: next }, { title: next });
    else setTitle(card.title);
  };

  const closeSubtask = () => { setSubtaskOpen(false); setSubtaskTitle(""); setSubtaskError(null); };
  // Stays open after each save so several subtasks can be typed in a row, the
  // same rhythm the List view's inline row has.
  const saveSubtask = async () => {
    const next = subtaskTitle.trim();
    if (subtaskBusy) return;
    if (!next) { closeSubtask(); return; }
    setSubtaskBusy(true);
    setSubtaskError(null);
    const res = await onAddSubtask(next);
    setSubtaskBusy(false);
    if (res.ok) { setSubtaskTitle(""); subtaskRef.current?.focus(); }
    else setSubtaskError(res.error ?? "Couldn't add subtask");
  };

  return (
    <div
      draggable={draggableCard && !editing && !subtaskOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => { if (!editing && !subtaskOpen) onOpen?.(); }}
      onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
      className={`group relative rounded-lg border bg-white px-3 py-2 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        selected ? "border-[var(--os-brand)] ring-1 ring-[var(--os-brand)]" : "border-zinc-200 hover:border-zinc-300"
      } ${
        draggableCard && !editing && !subtaskOpen ? "cursor-grab active:cursor-grabbing" : onOpen ? "cursor-pointer" : ""
      } ${isDragging ? "opacity-40" : ""} hover:shadow-[0_2px_8px_rgba(0,0,0,0.07)] transition-[box-shadow,border-color] duration-150`}
    >
      {/* Title + action rail */}
      <div className="flex items-start gap-1.5">
        {canEdit ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? "Deselect card" : "Select card"}
            onClick={(e) => { stop(e); onToggleSelect(card.id, e.shiftKey); }}
            className={`mt-[3px] inline-flex items-center justify-center w-3.5 h-3.5 rounded-[4px] shrink-0 transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            style={{ backgroundColor: selected ? "var(--os-brand)" : "#fff", border: selected ? "1px solid var(--os-brand)" : "1px solid #d4d4d8" }}
          >
            {selected ? <Check className="w-2.5 h-2.5 text-white" /> : null}
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onClick={stop}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); else if (e.key === "Escape") { setTitle(card.title); setEditing(false); } }}
              onBlur={saveTitle}
              className="w-full bg-white border border-[var(--os-brand)] rounded-md px-1.5 py-0.5 text-base font-medium text-zinc-900 focus:outline-none"
            />
          ) : (
            <div className="break-words text-base font-medium leading-snug text-zinc-800">
              {card.title}
              {/* Also in another List: the home List's name, after the title. */}
              {card.listLink ? (
                <span className="ml-1.5 inline-flex align-middle" onClick={stop}>
                  <LinkedRowIndicator row={card} boardId={boardId} />
                </span>
              ) : null}
              {card.recurRule ? (
                <span
                  className="inline-flex items-center align-middle ml-1 text-zinc-400"
                  title={buildRecurrenceSummary(card.recurRule)}
                  aria-label="Recurring task"
                >
                  <Repeat className="w-3 h-3" />
                </span>
              ) : null}
            </div>
          )}
        </div>
        {/* Mark complete — filled when done (always), else in the hover rail. */}
        {canEdit && done ? (
          <button type="button" onClick={(e) => { stop(e); onToggleComplete(); }} className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--signal-success-fg)] shrink-0" title="Mark incomplete" aria-label="Mark incomplete">
            <CheckCircle2 className="w-3.5 h-3.5" style={{ fill: "currentColor" }} />
          </button>
        ) : null}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 shrink-0" onClick={stop}>
          {canEdit && !done ? (
            <button type="button" onClick={(e) => { stop(e); onToggleComplete(); }} className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-[var(--signal-success-fg)] hover:bg-zinc-100" title="Mark complete" aria-label="Mark complete">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={(e) => { stop(e); setSubtaskOpen(true); setSubtaskError(null); requestAnimationFrame(() => subtaskRef.current?.focus()); }}
              className={iconBtn}
              title="Add subtask"
              aria-label="Add subtask"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" onClick={(e) => { stop(e); startEdit(); }} className={iconBtn} title="Rename" aria-label="Rename">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          ) : null}
          {/* Always rendered, as it always was: a reader who may do nothing
              else still gets Copy link, Copy task ID, reminders and Watch. */}
          <ItemMoreMenu
            ref={moreRef}
            host="row"
            role={menuRole ?? (canDelete ? "FULL" : canEdit ? "EDIT" : "VIEW")}
            // A card shown here through a link names its HOME (when the viewer
            // may know it): the menu's events and Move are about that task.
            item={{ id: card.id, boardId: card.listLink ? homeBoardId : boardId, title: card.title, status: card.status, assigneeIds: card.assigneeIds, itemTypeId: card.itemTypeId ?? null, parentItemId: card.parentItemId ?? null }}
            isCreator={menuIsCreator}
            listContext={listContext}
            onRemovedFromList={onDeleted}
            // Not null: ItemMoreMenu guards "Assign to me" and "Watch" on
            // this, so a null here renders both rows and makes both inert.
            currentUserId={currentUserId}
            watcherIds={cardWatcherIds(card)}
            statuses={statuses}
            timeTrackingOn={timeTrackingEnabled}
            onPatch={(body) => onPatch(card.id, body as Partial<BoardItemRow>, body as Partial<BoardItemRow>)}
            onOpen={onOpen}
            onRenameRequested={startEdit}
            onDuplicated={onDuplicate}
            onArchived={onArchive}
            onDeleted={onDeleted}
            // A moved task belongs to the destination List now, so its card
            // leaves this board. Without this it stayed on screen until a
            // reload, looking like the move had not happened, and any edit
            // made to the ghost went to a card this board no longer holds.
            // The PATCH's own failure path refetches, so a rejected move puts
            // the card back.
            onMoved={onDeleted}
          />
        </div>
      </div>

      {/* Meta row — Assignee / Due / Priority / Tags + field chips. Set values
          show always; empty affordances appear on hover. */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap" onClick={stop}>
        {/* THE WHOLE ASSIGNEE SET, not just the owner.
            This was a single-valued AssigneePicker that PATCHed { ownerId }
            alone, and the server's owner-only rule MERGES: each pick moved the
            chosen person to the front and kept everybody already on the task.
            On a card that only ever drew the owner, that meant every pick
            silently added a permanent assignee nobody could see or remove
            (1 to 5 in four clicks, past the 50-item cap), and the "Unassign"
            row handed the task to the next assignee instead of clearing it.
            The set is now both shown and sent in full, so what the card says is
            what the server stores, and Clear all really does clear. */}
        <span className={cardAssignees(card).length ? "inline-flex" : "hidden group-hover:inline-flex"}>
          <MultiAssigneePicker
            value={cardAssignees(card)}
            canEdit={canEdit}
            compact
            boardId={boardId}
            onChange={(people) =>
              onPatch(
                card.id,
                { assigneeIds: people.map((p) => p.id) },
                {
                  assigneeIds: people.map((p) => p.id),
                  ownerId: people[0]?.id ?? null,
                  owner: people[0]
                    ? { id: people[0].id, firstName: people[0].firstName ?? "", lastName: people[0].lastName ?? "", avatar: people[0].avatar }
                    : null,
                  assignees: people.map((p) => ({ id: p.id, firstName: p.firstName ?? "", lastName: p.lastName ?? "", avatar: p.avatar })),
                },
              )
            }
          />
        </span>

        {/* Due — full DatePlanner (Date / Reminder / Repeat) from the card icon. */}
        <span className={`relative ${card.dueAt ? "inline-flex" : "hidden group-hover:inline-flex"}`}>
          <DatePlanner
            item={card}
            canEdit={canEdit}
            statuses={statuses}
            done={done}
            compact
            onPatch={(body, opt) => onPatch(card.id, body as unknown as Record<string, unknown>, (opt ?? {}) as Partial<BoardItemRow>)}
          />
        </span>

        {/* Priority */}
        {priorityEnabled ? (
          <span className={card.priority ? "inline-flex" : "hidden group-hover:inline-flex"}>
            <PriorityPicker value={card.priority ?? null} canEdit={canEdit} compact onChange={(priority) => onPatch(card.id, { priority }, { priority })} />
          </span>
        ) : null}

        {/* Tags */}
        {tagsEnabled ? (
          <span className={tags.length > 0 ? "inline-flex" : "hidden group-hover:inline-flex"}>
            <TagPicker value={tags} canEdit={canEdit} compact onChange={(next) => onPatch(card.id, { tagIds: next.map((t) => t.id) }, { tags: next })} />
          </span>
        ) : null}

        {fieldChips.map((f) => (
          <FieldValue key={f.key} field={f} value={card.metadata?.[f.key]} mode="display" boardId={boardId} />
        ))}
      </div>

      {/* Inline subtask composer — type the name, Enter saves it under this
          card. The child does not become a card of its own; the count below
          is what moves. */}
      {subtaskOpen ? (
        <div className="mt-2" onClick={stop}>
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--os-brand)] bg-white px-1.5 py-1">
            <Plus className="w-3 h-3 text-ink-3 shrink-0" />
            <input
              ref={subtaskRef}
              autoFocus
              value={subtaskTitle}
              disabled={subtaskBusy}
              onChange={(e) => { setSubtaskTitle(e.target.value); if (subtaskError) setSubtaskError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void saveSubtask(); }
                else if (e.key === "Escape") { e.preventDefault(); closeSubtask(); }
              }}
              onBlur={() => { if (!subtaskTitle.trim() && !subtaskBusy) closeSubtask(); }}
              placeholder="Type a subtask and press Enter…"
              aria-label="New subtask name"
              className="flex-1 min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          {subtaskError ? <p className="mt-1 text-xs text-[var(--signal-danger-fg)]">{subtaskError}</p> : null}
        </div>
      ) : null}

      {/* Footer — subtask count only (ClickUp cards carry no created date). */}
      {subtaskCount > 0 ? (
        <div className="mt-2 flex items-center text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Network className="w-3 h-3" />
            {subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
