"use client";

// BoardTableView — Phase 3b TABLE renderer for studio-item Boards.
//
// Renders a clean flat-table layout matching the ClickUp/Monday
// aesthetic the user committed to on 2026-06-02:
//   - One whitespace-driven row per item, no decorative borders.
//   - Title is inline-editable on click (input blur saves).
//   - Status is a pill picker with the default palette.
//   - "+ Add row" inline at the bottom (and one slim "+ New row"
//     button at the top of the action bar).
//
// Column set this phase: Name (title) · Status · Owner · Created.
// Phase 3c will replace the hardcoded set with the field shelf that
// reads Board.schema.fields.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2, X, ChevronDown, ChevronRight, Layers, MessageSquare, Paperclip, Link2, GripVertical, MoreHorizontal, ExternalLink, Copy } from "lucide-react";
import {
  DEFAULT_STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  type BoardItemRow,
  type ItemTag,
} from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { AssigneePicker, PersonAvatar } from "./assignee-picker";
import { FieldValue } from "./field-value";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import type { FieldChoice } from "@/lib/field-catalog";

interface BoardTableViewProps {
  boardId: string;
  /** Phase 74 — view this table is rendering inside. Used for config
   *  persistence (groupBy etc.). Null when no view exists yet. */
  viewId?: string | null;
  viewConfig?: Record<string, unknown>;
  initialItems: BoardItemRow[];
  /** Custom fields from Board.schema.fields. Each becomes a column. */
  initialFields?: FieldDef[];
  canEdit: boolean;
  /** When set, clicking a row's title opens the row drawer. The
   *  parent owns drawer state; we just emit the id. */
  onOpenItem?: (itemId: string) => void;
  /** "list" = ClickUp pills (default). "table" = Monday-style grid with
   *  full-cell colored status fills + always-on group summary. */
  gridStyle?: "list" | "table";
}

/** Patch shape rows can emit. `owner`/`tags` only update the local
 *  optimistic row — the API's zod schema strips unknown keys; `tagIds`
 *  is what the server persists. */
type RowPatch = Partial<Pick<BoardItemRow, "title" | "status" | "ownerId" | "owner" | "priority" | "tags">> & { tagIds?: string[] };

type StatusOption = { value: string; label: string; color: string };
const STATUS_BY_VALUE: Map<string, StatusOption> = new Map(
  DEFAULT_STATUS_OPTIONS.map((o) => [o.value as string, { ...o } as StatusOption]),
);

export function BoardTableView({ boardId, viewId, viewConfig, initialItems, initialFields, canEdit, onOpenItem, gridStyle = "list" }: BoardTableViewProps) {
  const monday = gridStyle === "table";
  const customFields: FieldDef[] = initialFields ?? [];
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Group-by axis seeded from the saved view config (Phase 74). Null
  // means "no grouping" — strings can be "status" / "owner" / a field key.
  const initialGroupBy = (() => {
    const raw = viewConfig?.groupBy;
    if (raw === null || raw === undefined) return null;
    return typeof raw === "string" ? raw : null;
  })();
  const [groupBy, setGroupByState] = useState<string | null>(initialGroupBy);

  // Direction for the grouped buckets. Default ascending. Persists per-view.
  const initialGroupDir: "asc" | "desc" = (() => {
    const raw = viewConfig?.groupDirection;
    return raw === "desc" ? "desc" : "asc";
  })();
  const [groupDirection, setGroupDirectionState] = useState<"asc" | "desc">(initialGroupDir);

  const persistView = useCallback((patch: Record<string, unknown>) => {
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { ...(viewConfig ?? {}), ...patch },
      }),
    }).catch(() => {});
  }, [viewId, boardId, viewConfig]);

  const setGroupBy = useCallback((next: string | null) => {
    setGroupByState(next);
    persistView({ groupBy: next });
  }, [persistView]);

  const setGroupDirection = useCallback((next: "asc" | "desc") => {
    setGroupDirectionState(next);
    persistView({ groupDirection: next });
  }, [persistView]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Multi-select state for bulk actions (Phase 70).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Drag-to-reorder state (Phase 71). Disabled while grouped — cross-
  // group drag is ambiguous (would change the row's group value too).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Phase 73 — expanded subtask sets per parent. Closed by default.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // Split top-level items from subtasks for the render. Subtasks are
  // rendered indented below their parent when expanded.
  const { topLevel, childrenByParent } = useMemo(() => {
    const top: BoardItemRow[] = [];
    const byParent = new Map<string, BoardItemRow[]>();
    for (const it of items) {
      if (it.parentItemId) {
        const arr = byParent.get(it.parentItemId) ?? [];
        arr.push(it);
        byParent.set(it.parentItemId, arr);
      } else {
        top.push(it);
      }
    }
    // Sort children by position so reorder within a parent works.
    for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);
    return { topLevel: top, childrenByParent: byParent };
  }, [items]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleDuplicate = useCallback(async (row: BoardItemRow) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${row.title} (copy)`,
          status: row.status ?? "TO_DO",
          ownerId: row.ownerId,
          metadata: row.metadata,
          parentItemId: row.parentItemId ?? null,
        }),
      });
      if (!res.ok) {
        setError("Failed to duplicate");
        return;
      }
      const data = await res.json();
      if (data?.item) setItems((prev) => [...prev, data.item]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate");
    }
  }, [boardId, canEdit]);

  const addSubtask = useCallback(async (parentId: string, parentStatus: string | null) => {
    if (!canEdit) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New subtask",
          status: parentStatus ?? "TO_DO",
          parentItemId: parentId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.item) {
          setItems((prev) => [...prev, data.item]);
          setExpandedParents((prev) => new Set(prev).add(parentId));
        }
      }
    } finally {
      setAdding(false);
    }
  }, [boardId, canEdit]);

  // Re-sync if the parent ever passes a refreshed initial set.
  useEffect(() => { setItems(initialItems); }, [initialItems]);

  // Group axes the user can pick: built-in Status/Owner + any SELECT custom field.
  const groupOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "__none__", label: "No grouping" },
      { key: "status", label: "Status" },
      { key: "owner", label: "Owner" },
      { key: "priority", label: "Priority" },
    ];
    for (const f of customFields) {
      if (f.type === "DROPDOWN" || f.type === "MULTI_SELECT" || f.type === "LABELS") {
        opts.push({ key: f.key, label: f.label });
      }
    }
    return opts;
  }, [customFields]);

  // Bucket items by group-by key. Returns an ordered Array<[key, rows]>.
  // Subtasks are NOT bucketed independently — they render under their
  // parent's bucket regardless of their own field values.
  type Bucket = { key: string; label: string; color: string | null; rows: BoardItemRow[] };
  const buckets = useMemo<Bucket[] | null>(() => {
    if (!groupBy) return null;
    const groupKeyFor = (it: BoardItemRow): string => {
      if (groupBy === "status") return it.status ?? "__unset__";
      if (groupBy === "owner") return it.ownerId ?? "__unset__";
      if (groupBy === "priority") return it.priority ?? "__unset__";
      const raw = it.metadata?.[groupBy];
      return raw == null || raw === "" ? "__unset__" : String(raw);
    };
    const map = new Map<string, BoardItemRow[]>();
    for (const it of topLevel) {
      const k = groupKeyFor(it);
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    const resolved: Bucket[] = [];
    if (groupBy === "status") {
      // Honor DEFAULT_STATUS_OPTIONS order; append Unset last if needed.
      for (const opt of DEFAULT_STATUS_OPTIONS) {
        const rows = map.get(opt.value) ?? [];
        if (rows.length > 0) {
          resolved.push({ key: opt.value, label: opt.label, color: opt.color, rows });
          map.delete(opt.value);
        }
      }
    } else if (groupBy === "priority") {
      // Honor URGENT→LOW severity order; Unset (no priority) appends last.
      for (const opt of PRIORITY_OPTIONS) {
        const rows = map.get(opt.value) ?? [];
        if (rows.length > 0) {
          resolved.push({ key: opt.value, label: opt.label, color: opt.color, rows });
          map.delete(opt.value);
        }
      }
    } else if (groupBy === "owner") {
      // Order by owner name (best-effort using row.owner from the first
      // item in each bucket).
      const tuples = Array.from(map.entries()).map(([k, rows]) => {
        const owner = rows[0]?.owner ?? null;
        const label = owner
          ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "Unknown"
          : k === "__unset__" ? "Unassigned" : "Unknown";
        return { key: k, label, color: null as string | null, rows };
      });
      tuples.sort((a, b) => a.label.localeCompare(b.label));
      resolved.push(...tuples);
      map.clear();
    } else {
      // Custom SELECT field — use field.options to resolve label + color.
      const field = customFields.find((f) => f.key === groupBy);
      const optionByValue = new Map<string, { label: string; color?: string }>();
      const fieldOpts = field && "options" in field ? (field.options as Array<{ value: string; label: string; color?: string }> | undefined) ?? [] : [];
      for (const o of fieldOpts) optionByValue.set(o.value, o);
      for (const opt of fieldOpts) {
        const rows = map.get(opt.value) ?? [];
        if (rows.length > 0) {
          resolved.push({ key: opt.value, label: opt.label, color: opt.color ?? null, rows });
          map.delete(opt.value);
        }
      }
      // Any leftover unmatched values (custom user input) append alphabetically.
      const leftover = Array.from(map.entries())
        .filter(([k]) => k !== "__unset__")
        .map(([k, rows]) => ({ key: k, label: k, color: null as string | null, rows }));
      leftover.sort((a, b) => a.label.localeCompare(b.label));
      resolved.push(...leftover);
      map.delete("__unset__"); // handled below
    }
    const unsetRows = (groupBy === "status" ? null : map.get("__unset__")) ?? [];
    // status branch may have left __unset__ in the map; pick it up here
    const statusUnset = groupBy === "status" ? map.get("__unset__") ?? [] : [];
    const finalUnset = unsetRows.length > 0 ? unsetRows : statusUnset;
    if (finalUnset.length > 0) {
      resolved.push({ key: "__unset__", label: "Unset", color: "#A1A1AA", rows: finalUnset });
    }
    if (groupDirection === "desc") resolved.reverse();
    return resolved;
  }, [groupBy, topLevel, customFields, groupDirection]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectAllVisible = useCallback(() => {
    setSelected(new Set(items.map((i) => i.id)));
  }, [items]);

  // Bulk actions — each runs Promise.allSettled over /api/items/[id]
  // since no server-side bulk endpoint exists yet. Optimistic local
  // state update + clear selection on success.
  const bulkArchive = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(`Archive ${selected.size} row${selected.size === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/items/${id}`, { method: "DELETE" })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) setError(`${failed} failed to archive — refreshing`);
    // Optimistic: drop archived from local state
    setItems((prev) => prev.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    setBulkBusy(false);
  }, [selected]);

  // Drag-to-reorder. Computes fractional midpoint position so we never
  // renumber the whole list — Linear/Folder pattern. Optimistic local
  // update + PATCH.
  const reorder = useCallback(async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const sorted = [...items].sort((a, b) => a.position - b.position);
    const draggedIdx = sorted.findIndex((r) => r.id === draggedId);
    const targetIdx = sorted.findIndex((r) => r.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;
    // Insert dragged BEFORE target. If dragging downward we land in the
    // slot vacated by the source so the midpoint math stays the same.
    const insertBefore = sorted[targetIdx];
    const insertBeforeIdx = targetIdx;
    let newPos: number;
    if (insertBeforeIdx === 0) {
      newPos = insertBefore.position - 1;
    } else {
      // The row physically before the target (in the current sort) — skip
      // the dragged row itself if it's adjacent.
      const candidates = sorted.slice(0, insertBeforeIdx).filter((r) => r.id !== draggedId);
      const before = candidates[candidates.length - 1];
      newPos = before ? (before.position + insertBefore.position) / 2 : insertBefore.position - 1;
    }
    setItems((prev) =>
      [...prev.map((r) => (r.id === draggedId ? { ...r, position: newPos } : r))]
        .sort((a, b) => a.position - b.position),
    );
    try {
      await fetch(`/api/items/${draggedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: newPos }),
      });
    } catch {
      // Revert by refetching the board on failure.
      const fresh = await fetch(`/api/boards/${boardId}/items`).then((r) => r.json()).catch(() => null);
      if (fresh?.items) setItems(fresh.items);
    }
  }, [items, boardId]);

  const bulkStatus = useCallback(async (status: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      ),
    );
    setItems((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, status } : r)));
    setSelected(new Set());
    setBulkBusy(false);
  }, [selected]);

  const bulkOwner = useCallback(async (ownerId: string | null) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ownerId }),
        }),
      ),
    );
    setItems((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, ownerId } : r)));
    setSelected(new Set());
    setBulkBusy(false);
  }, [selected]);

  const bulkDueAt = useCallback(async (iso: string | null) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dueAt: iso }),
        }),
      ),
    );
    setItems((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, dueAt: iso } : r)));
    setSelected(new Set());
    setBulkBusy(false);
  }, [selected]);

  const handleAdd = useCallback(async () => {
    if (!canEdit) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New item", status: "TO_DO" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to add item");
        return;
      }
      setItems((prev) => [...prev, data.item as BoardItemRow]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    } finally {
      setAdding(false);
    }
  }, [boardId, canEdit]);

  const handleUpdate = useCallback(async (id: string, patch: RowPatch) => {
    if (!canEdit) return;
    // Optimistic (zod on the API strips unknown keys like `owner`,
    // which only exists for the local optimistic row).
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save change");
        // Refetch on failure to revert optimistic state.
        const fresh = await fetch(`/api/boards/${boardId}/items`).then((r) => r.json()).catch(() => null);
        if (fresh?.items) setItems(fresh.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save change");
    }
  }, [boardId, canEdit]);

  const handleArchive = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!confirm("Archive this row? You can restore it later from Trash.")) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to archive — refreshing");
        const fresh = await fetch(`/api/boards/${boardId}/items`).then((r) => r.json()).catch(() => null);
        if (fresh?.items) setItems(fresh.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    }
  }, [boardId, canEdit]);

  const colCount = 8 + customFields.length; // select/handle + name + status + owner + priority + tags + created + actions

  const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));
  const someSelected = !allSelected && items.some((r) => selected.has(r.id));

  // Renders a row and (if expanded) its subtask subtree as a flat
  // sequence of <tr>s. Depth-first; subtasks of subtasks supported.
  const renderRowAndSubtasks = (row: BoardItemRow, indent: number): React.ReactNode[] => {
    const children = childrenByParent.get(row.id) ?? [];
    const expanded = expandedParents.has(row.id);
    const nodes: React.ReactNode[] = [
      <Row
        key={row.id}
        row={row}
        customFields={customFields}
        canEdit={canEdit}
        monday={monday}
        selected={selected.has(row.id)}
        onToggleSelect={toggleRow}
        onUpdate={handleUpdate}
        onArchive={handleArchive}
        onOpen={onOpenItem ? () => onOpenItem(row.id) : undefined}
        onDuplicate={handleDuplicate}
        dragEnabled={canEdit && !buckets && indent === 0}
        isDragging={dragId === row.id}
        isDragOver={dragOverId === row.id && dragId !== null && dragId !== row.id}
        onDragStart={(id) => setDragId(id)}
        onDragOver={(id) => setDragOverId(id)}
        onDrop={(targetId) => {
          if (dragId) reorder(dragId, targetId);
          setDragId(null);
          setDragOverId(null);
        }}
        onDragEnd={() => { setDragId(null); setDragOverId(null); }}
        indent={indent}
        hasSubtasks={children.length > 0}
        expanded={expanded}
        onToggleExpand={() => toggleExpand(row.id)}
      />,
    ];
    if (expanded) {
      for (const child of children) {
        nodes.push(...renderRowAndSubtasks(child, indent + 1));
      }
      if (canEdit) {
        nodes.push(
          <AddSubtaskRow
            key={`${row.id}-add-sub`}
            parentId={row.id}
            indent={indent + 1}
            colCount={colCount}
            onAdd={() => addSubtask(row.id, row.status)}
          />,
        );
      }
    }
    return nodes;
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      {error ? (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      {/* Group-by selector — ClickUp parity (2026-06-07). Toolbar pill
          shows the active field; click → "Group by" popover with field +
          direction dropdowns + trash to clear. */}
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
        <GroupByPill
          groupBy={groupBy}
          groupDirection={groupDirection}
          groupOptions={groupOptions}
          onGroupBy={setGroupBy}
          onDirection={setGroupDirection}
        />
        <span className="text-[11px] text-zinc-400">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200">
              <th className="px-2 py-2 w-[36px] text-center">
                {canEdit ? (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={() => (allSelected || someSelected ? clearSelection() : selectAllVisible())}
                    aria-label="Select all rows"
                    className="cursor-pointer"
                  />
                ) : null}
              </th>
              <th className="px-4 py-2 font-medium w-[36%]">Name</th>
              <th className="px-4 py-2 font-medium w-[140px]">Status</th>
              <th className="px-4 py-2 font-medium w-[180px]">Owner</th>
              <th className="px-4 py-2 font-medium w-[110px]">Priority</th>
              <th className="px-4 py-2 font-medium w-[160px]">Tags</th>
              {customFields.map((f) => (
                <th key={f.key} className="px-4 py-2 font-medium">{f.label}</th>
              ))}
              <th className="px-4 py-2 font-medium w-[120px]">Created</th>
              <th className="px-2 py-2 w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {buckets ? (
              buckets.map((b) => {
                const collapsed = collapsedGroups.has(b.key);
                return (
                  <React.Fragment key={b.key}>
                    <tr className="bg-zinc-50/80 border-y border-zinc-200">
                      <td colSpan={colCount} className="px-3 py-1.5" style={b.color ? { boxShadow: `inset 3px 0 0 ${b.color}` } : undefined}>
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleGroup(b.key)}
                            className="inline-flex items-center gap-2 text-[12px] font-semibold text-zinc-800 hover:text-zinc-900"
                          >
                            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {b.color ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-white" style={{ backgroundColor: b.color }}>
                                {b.label}
                              </span>
                            ) : (
                              <span>{b.label}</span>
                            )}
                            <span className="text-[10.5px] text-zinc-500 tabular-nums">{b.rows.length}</span>
                          </button>
                          <GroupStatusBreakdown rows={b.rows} />
                        </div>
                      </td>
                    </tr>
                    {!collapsed
                      ? b.rows.flatMap((row) => renderRowAndSubtasks(row, 0))
                      : null}
                    {/* Monday-style per-group summary footer — aggregates
                        every column (stacked bars, people, sums…). */}
                    <GroupSummaryRow rows={b.rows} customFields={customFields} railColor={b.color} />
                  </React.Fragment>
                );
              })
            ) : (
              <>
                {topLevel.flatMap((row) => renderRowAndSubtasks(row, 0))}
                {items.length > 0 ? <GroupSummaryRow rows={items} customFields={customFields} railColor={null} /> : null}
              </>
            )}
            {canEdit && !buckets ? (
              <tr className="hover:bg-zinc-50">
                <td colSpan={colCount} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding}
                    className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {adding ? "Adding…" : "Add row"}
                  </button>
                </td>
              </tr>
            ) : null}
            {items.length === 0 && !canEdit ? (
              <tr><td colSpan={colCount} className="px-4 py-8 text-center text-sm text-zinc-500">No items yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <BulkActionBar
        selectedCount={selected.size}
        busy={bulkBusy}
        onClear={clearSelection}
        onArchive={bulkArchive}
        onStatus={bulkStatus}
        onDueAt={bulkDueAt}
        onOwner={bulkOwner}
      />
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  busy,
  onClear,
  onArchive,
  onStatus,
  onDueAt,
  onOwner,
}: {
  selectedCount: number;
  busy: boolean;
  onClear: () => void;
  onArchive: () => void;
  onStatus: (status: string) => void;
  onDueAt: (iso: string | null) => void;
  onOwner: (ownerId: string | null) => void;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-full bg-zinc-900 text-white px-2 py-1.5 shadow-2xl">
      <span className="px-3 text-[12px] font-medium tabular-nums">
        {selectedCount} selected
      </span>
      <span className="w-px h-5 bg-white/20" aria-hidden />
      <details className="relative">
        <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] hover:bg-white/10 select-none">
          Set status
          <ChevronDown className="w-3 h-3" />
        </summary>
        <div className="absolute left-0 bottom-full mb-1 w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1 text-zinc-900">
          {DEFAULT_STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onStatus(o.value)}
              disabled={busy}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-zinc-50"
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} aria-hidden />
              {o.label}
            </button>
          ))}
        </div>
      </details>
      <BulkDueDate onSet={onDueAt} busy={busy} />
      <BulkOwner onSet={onOwner} busy={busy} />
      <button
        type="button"
        onClick={onArchive}
        disabled={busy}
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] hover:bg-white/10"
      >
        <Trash2 className="w-3 h-3" />
        Archive
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center justify-center w-7 h-7 rounded-full hover:bg-white/10"
        aria-label="Clear selection"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function BulkDueDate({ onSet, busy }: { onSet: (iso: string | null) => void; busy: boolean }) {
  const [value, setValue] = useState("");
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] hover:bg-white/10 select-none">
        Set due date
        <ChevronDown className="w-3 h-3" />
      </summary>
      <div className="absolute left-0 bottom-full mb-1 w-[260px] rounded-md border border-zinc-200 bg-white shadow-lg p-3 text-zinc-900">
        <label className="text-[11px] text-zinc-500 mb-1 block">Due date</label>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full h-8 px-2 border border-zinc-200 rounded text-sm focus:outline-none focus:border-zinc-400"
        />
        <div className="flex items-center gap-1.5 mt-2">
          <button
            type="button"
            disabled={busy || !value}
            onClick={() => onSet(`${value}T00:00:00.000Z`)}
            className="h-7 px-3 rounded-md text-[12px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setValue(""); onSet(null); }}
            className="h-7 px-3 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100"
          >
            Clear
          </button>
        </div>
      </div>
    </details>
  );
}

interface BulkOwnerOption { id: string; firstName: string; lastName: string; avatar: string | null }

function BulkOwner({ onSet, busy }: { onSet: (ownerId: string | null) => void; busy: boolean }) {
  const [users, setUsers] = useState<BulkOwnerOption[] | null>(null);
  const [open, setOpen] = useState(false);
  // Lazy-fetch the org's users when the user first opens the menu.
  useEffect(() => {
    if (!open || users !== null) return;
    let active = true;
    fetch("/api/users?scope=all&limit=100", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => { if (active) setUsers(Array.isArray(d?.data) ? d.data : []); })
      .catch(() => { if (active) setUsers([]); });
    return () => { active = false; };
  }, [open, users]);
  return (
    <details className="relative" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] hover:bg-white/10 select-none">
        Set owner
        <ChevronDown className="w-3 h-3" />
      </summary>
      <div className="absolute left-0 bottom-full mb-1 w-[240px] max-h-[280px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1 text-zinc-900">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(null)}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-500 hover:bg-zinc-50 border-b border-zinc-100"
        >
          Unassign
        </button>
        {users === null ? (
          <div className="px-3 py-3 text-[11.5px] text-zinc-400">Loading…</div>
        ) : users.length === 0 ? (
          <div className="px-3 py-3 text-[11.5px] text-zinc-400">No users</div>
        ) : (
          users.map((u) => {
            const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.id;
            const initials = `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? ""}`.toUpperCase() || "?";
            return (
              <button
                key={u.id}
                type="button"
                disabled={busy}
                onClick={() => onSet(u.id)}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-zinc-50"
              >
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-zinc-100 text-zinc-600 text-[9px] font-semibold shrink-0">
                  {initials}
                </span>
                <span className="truncate">{name}</span>
              </button>
            );
          })
        )}
      </div>
    </details>
  );
}

// ── Inline row editor ──────────────────────────────────────────────

function Row({
  row,
  customFields,
  canEdit,
  monday = false,
  selected,
  onToggleSelect,
  onUpdate,
  onArchive,
  onOpen,
  onDuplicate,
  dragEnabled,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  indent = 0,
  hasSubtasks = false,
  expanded = false,
  onToggleExpand,
}: {
  row: BoardItemRow;
  customFields: FieldDef[];
  canEdit: boolean;
  monday?: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onUpdate: (id: string, patch: RowPatch) => void;
  onArchive: (id: string) => void;
  onOpen?: () => void;
  onDuplicate?: (row: BoardItemRow) => void;
  dragEnabled: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (targetId: string) => void;
  onDragEnd: () => void;
  indent?: number;
  hasSubtasks?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <tr
      draggable={dragEnabled}
      onDragStart={(e) => {
        if (!dragEnabled) return;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", row.id); } catch {}
        onDragStart(row.id);
      }}
      onDragOver={(e) => {
        if (!dragEnabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver(row.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(row.id);
      }}
      onDragEnd={onDragEnd}
      className={`border-b border-zinc-200 last:border-b-0 hover:bg-zinc-50 group ${
        selected ? "bg-violet-50/40" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        isDragOver ? "outline outline-2 outline-violet-400 outline-offset-[-2px]" : ""
      }`}
    >
      <td className="px-2 py-2 w-[36px]">
        <div className="flex items-center gap-0.5">
          {canEdit ? (
            <span
              className={`group-hover:text-zinc-400 ${dragEnabled ? "text-zinc-300 cursor-grab" : "text-zinc-200"}`}
              title={dragEnabled ? "Drag to reorder" : "Drag disabled while grouped"}
              aria-hidden
            >
              <GripVertical className="w-3 h-3" />
            </span>
          ) : null}
          {canEdit ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(row.id)}
              aria-label="Select row"
              className={`cursor-pointer transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            />
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2" style={{ paddingLeft: indent * 18 }}>
          {hasSubtasks ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 shrink-0"
              aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : indent > 0 ? (
            <span className="w-4 h-4 shrink-0" aria-hidden />
          ) : null}
          <div className="flex-1 min-w-0">
            <TitleCell row={row} canEdit={canEdit} onUpdate={onUpdate} onOpen={onOpen} />
          </div>
          <RowHoverActions itemId={row.id} />
        </div>
      </td>
      <td className={monday ? "p-0 align-middle border-l border-zinc-100" : "px-4 py-2"}>
        <StatusCell row={row} canEdit={canEdit} onUpdate={onUpdate} monday={monday} />
      </td>
      <td className="px-4 py-2">
        <OwnerCell row={row} canEdit={canEdit} onUpdate={onUpdate} />
      </td>
      <td className="px-4 py-2">
        <PriorityPicker
          value={row.priority ?? null}
          canEdit={canEdit}
          compact
          onChange={(priority) => onUpdate(row.id, { priority })}
        />
      </td>
      <td className="px-4 py-2">
        <TagPicker
          value={row.tags ?? []}
          canEdit={canEdit}
          compact
          onChange={(tags) => onUpdate(row.id, { tags, tagIds: tags.map((t) => t.id) })}
        />
      </td>
      {customFields.map((f) => (
        <td key={f.key} className="px-4 py-2">
          <FieldValue field={f} value={row.metadata?.[f.key]} mode="display" />
        </td>
      ))}
      <td className="px-4 py-2 text-xs text-zinc-500">
        {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}
      </td>
      <td className="px-2 py-2 text-right">
        {canEdit ? (
          <RowActionsMenu
            itemId={row.id}
            onOpen={onOpen}
            onDuplicate={onDuplicate ? () => onDuplicate(row) : undefined}
            onArchive={() => onArchive(row.id)}
          />
        ) : null}
      </td>
    </tr>
  );
}

function AddSubtaskRow({
  parentId,
  indent,
  colCount,
  onAdd,
}: {
  parentId: string;
  indent: number;
  colCount: number;
  onAdd: () => void;
}) {
  return (
    <tr className="hover:bg-zinc-50" data-parent-id={parentId}>
      <td colSpan={colCount} className="px-4 py-1.5">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-zinc-700"
          style={{ paddingLeft: indent * 18 + 18 }}
        >
          <Plus className="w-3 h-3" />
          Add subtask
        </button>
      </td>
    </tr>
  );
}

// ── Monday-style summary footer ────────────────────────────────────
//
// One <tr> aligned to the column set, each cell aggregating its column:
//   Name      → "N items"
//   Status    → proportional stacked color bar
//   Owner     → overlapping avatar stack of distinct people
//   Priority  → proportional stacked color bar
//   Tags      → distinct tag chips (+overflow)
//   custom    → sum (number/money) · average (percent/rating) ·
//               checked-count (checkbox) · choice-distribution bar
//               (dropdown/labels) · range (date)
//   Created   → blank
// Mirrors Monday.com's group summary row.

interface BarSeg { color: string; count: number; label: string }

function StackedBar({ segments }: { segments: BarSeg[] }) {
  const total = segments.reduce((n, s) => n + s.count, 0);
  if (total === 0) return <span className="text-[11px] text-zinc-300">—</span>;
  return (
    <div
      className="flex h-3.5 w-full max-w-[160px] rounded-sm overflow-hidden ring-1 ring-black/5"
      title={segments.map((s) => `${s.label}: ${s.count}`).join("  ·  ")}
    >
      {segments.map((s, i) => (
        <span key={i} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} aria-hidden />
      ))}
    </div>
  );
}

// Count rows by a key, resolve color/label, return ordered segments.
function choiceSegments(
  rows: BoardItemRow[],
  key: string,
  choices: FieldChoice[],
  multi: boolean,
): BarSeg[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = r.metadata?.[key];
    if (multi) {
      const arr = Array.isArray(raw) ? (raw as string[]) : [];
      for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
    } else if (raw != null && raw !== "") {
      const v = String(raw);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const byValue = new Map(choices.map((c) => [c.value, c] as const));
  // Choice order first, then any unmatched values.
  const segs: BarSeg[] = [];
  for (const c of choices) {
    const n = counts.get(c.value);
    if (n) { segs.push({ color: c.color ?? "#d4d4d8", count: n, label: c.label }); counts.delete(c.value); }
  }
  for (const [v, n] of counts) {
    const c = byValue.get(v);
    segs.push({ color: c?.color ?? "#d4d4d8", count: n, label: c?.label ?? v });
  }
  return segs;
}

function fmtNumber(field: FieldDef, value: number): string {
  const decimals = field.options?.decimals ?? (field.type === "MONEY" ? 2 : 0);
  if (field.type === "MONEY") {
    const cur = field.options?.currency ?? "USD";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
    } catch {
      return `${cur} ${value.toFixed(decimals)}`;
    }
  }
  if (field.type === "PERCENT") return `${value.toFixed(decimals)}%`;
  return value.toFixed(decimals);
}

function CustomFieldSummary({ field, rows }: { field: FieldDef; rows: BoardItemRow[] }) {
  const dash = <span className="text-[11px] text-zinc-300">—</span>;
  const nums = rows.map((r) => r.metadata?.[field.key]).filter((v): v is number => typeof v === "number");
  switch (field.type) {
    case "NUMBER":
    case "MONEY": {
      if (!nums.length) return dash;
      const sum = nums.reduce((a, b) => a + b, 0);
      return <span className="text-[12px] font-medium tabular-nums text-zinc-700" title="Sum">{fmtNumber(field, sum)}</span>;
    }
    case "PERCENT": {
      if (!nums.length) return dash;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return <span className="text-[12px] font-medium tabular-nums text-zinc-700" title="Average">{fmtNumber(field, avg)}</span>;
    }
    case "RATING": {
      if (!nums.length) return dash;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return <span className="text-[12px] font-medium tabular-nums text-zinc-700" title="Average">{avg.toFixed(1)}★</span>;
    }
    case "CHECKBOX": {
      const checked = rows.filter((r) => !!r.metadata?.[field.key]).length;
      return <span className="text-[12px] tabular-nums text-zinc-700" title="Checked">{checked}/{rows.length}</span>;
    }
    case "DROPDOWN":
    case "TSHIRT_SIZE":
      return <StackedBar segments={choiceSegments(rows, field.key, field.options?.choices ?? [], false)} />;
    case "MULTI_SELECT":
    case "LABELS":
      return <StackedBar segments={choiceSegments(rows, field.key, field.options?.choices ?? [], true)} />;
    default:
      return dash;
  }
}

function GroupSummaryRow({
  rows,
  customFields,
  railColor,
}: {
  rows: BoardItemRow[];
  customFields: FieldDef[];
  railColor: string | null;
}) {
  // Status + priority stacked bars.
  const statusSegs = useMemo<BarSeg[]>(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status ?? "__none__", (counts.get(r.status ?? "__none__") ?? 0) + 1);
    const segs: BarSeg[] = [];
    for (const o of DEFAULT_STATUS_OPTIONS) {
      const n = counts.get(o.value);
      if (n) { segs.push({ color: o.color, count: n, label: o.label }); counts.delete(o.value); }
    }
    for (const [v, n] of counts) segs.push({ color: "#d4d4d8", count: n, label: v === "__none__" ? "No status" : v });
    return segs;
  }, [rows]);

  const prioritySegs = useMemo<BarSeg[]>(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.priority) counts.set(r.priority, (counts.get(r.priority) ?? 0) + 1);
    const segs: BarSeg[] = [];
    for (const p of PRIORITY_OPTIONS) {
      const n = counts.get(p.value);
      if (n) segs.push({ color: p.color, count: n, label: p.label });
    }
    return segs;
  }, [rows]);

  // Distinct owners (avatar stack) + distinct tags.
  const owners = useMemo(() => {
    const map = new Map<string, NonNullable<BoardItemRow["owner"]>>();
    for (const r of rows) if (r.owner) map.set(r.owner.id, r.owner);
    return Array.from(map.values());
  }, [rows]);
  const tags = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string | null }>();
    for (const r of rows) for (const t of r.tags ?? []) map.set(t.id, t);
    return Array.from(map.values());
  }, [rows]);

  return (
    <tr className="bg-zinc-50/60 border-b border-zinc-200 text-[11px]">
      {/* checkbox spacer — carries the group color rail */}
      <td className="px-2 py-1.5" style={railColor ? { boxShadow: `inset 3px 0 0 ${railColor}` } : undefined} />
      {/* Name → count */}
      <td className="px-4 py-1.5 text-zinc-400">{rows.length} item{rows.length === 1 ? "" : "s"}</td>
      {/* Status */}
      <td className="px-4 py-1.5"><StackedBar segments={statusSegs} /></td>
      {/* Owner */}
      <td className="px-4 py-1.5">
        {owners.length === 0 ? (
          <span className="text-[11px] text-zinc-300">—</span>
        ) : (
          <span className="inline-flex items-center -space-x-1.5" title={owners.map((o) => `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim()).join(", ")}>
            {owners.slice(0, 5).map((o) => (
              <span key={o.id} className="rounded-full ring-2 ring-white">
                <PersonAvatar person={{ ...o, email: null }} size={20} />
              </span>
            ))}
            {owners.length > 5 ? <span className="pl-2.5 text-[10.5px] text-zinc-500">+{owners.length - 5}</span> : null}
          </span>
        )}
      </td>
      {/* Priority */}
      <td className="px-4 py-1.5">
        {prioritySegs.length ? <StackedBar segments={prioritySegs} /> : <span className="text-[11px] text-zinc-300">—</span>}
      </td>
      {/* Tags */}
      <td className="px-4 py-1.5">
        {tags.length === 0 ? (
          <span className="text-[11px] text-zinc-300">—</span>
        ) : (
          <span className="inline-flex items-center gap-1 flex-wrap">
            {tags.slice(0, 3).map((t) => {
              const c = t.color || "#94a3b8";
              return (
                <span key={t.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: `${c}22`, color: c }}>
                  {t.name}
                </span>
              );
            })}
            {tags.length > 3 ? <span className="text-[10px] text-zinc-500">+{tags.length - 3}</span> : null}
          </span>
        )}
      </td>
      {/* Custom fields */}
      {customFields.map((f) => (
        <td key={f.key} className="px-4 py-1.5"><CustomFieldSummary field={f} rows={rows} /></td>
      ))}
      {/* Created + actions spacers */}
      <td className="px-4 py-1.5" />
      <td className="px-2 py-1.5" />
    </tr>
  );
}

function GroupStatusBreakdown({ rows }: { rows: BoardItemRow[] }) {
  // Compute open/in-progress/done buckets by mapping the row's status
  // through DEFAULT_STATUS_OPTIONS' group. Matches the ClickUp
  // "5 OPEN / 3 IN PROGRESS / 1 CLOSED" popover.
  const counts = { OPEN: 0, IN_PROGRESS: 0, CLOSED: 0 } as Record<string, number>;
  for (const r of rows) {
    const opt = STATUS_BY_VALUE.get(r.status ?? "");
    if (!opt) { counts.OPEN += 1; continue; }
    // Heuristic: TO_DO + IN_PROGRESS palette colors map to OPEN/IN_PROGRESS
    // groups; everything else (COMPLETE, DONE, CLOSED) counts as CLOSED.
    if (r.status === "IN_PROGRESS" || r.status === "IN_REVIEW") counts.IN_PROGRESS += 1;
    else if (r.status === "COMPLETE" || r.status === "DONE" || r.status === "CLOSED" || r.status === "CLOSED_WON" || r.status === "CLOSED_LOST" || r.status === "RESOLVED" || r.status === "RENEWED" || r.status === "EXPANSION" || r.status === "CHURNED") counts.CLOSED += 1;
    else counts.OPEN += 1;
  }
  return (
    <details className="relative inline-block">
      <summary
        className="list-none cursor-pointer inline-flex items-center text-[10px] text-zinc-400 hover:text-zinc-700 w-4 h-4 rounded hover:bg-zinc-100 justify-center select-none"
        title="Status breakdown"
      >
        …
      </summary>
      <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-zinc-200 bg-white shadow-lg py-1.5">
        {(["OPEN", "IN_PROGRESS", "CLOSED"] as const).map((bucket) => {
          const dotColor = bucket === "OPEN" ? "#71717A" : bucket === "IN_PROGRESS" ? "#6366F1" : "#10B981";
          const label = bucket === "IN_PROGRESS" ? "IN PROGRESS" : bucket;
          return (
            <div key={bucket} className="flex items-center gap-2 px-3 py-1 text-[11.5px]">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden />
              <span className="tabular-nums text-zinc-700 w-4">{counts[bucket]}</span>
              <span className="text-zinc-500">{label}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function RowActionsMenu({
  itemId,
  onOpen,
  onDuplicate,
  onArchive,
}: {
  itemId: string;
  onOpen?: () => void;
  onDuplicate?: () => void;
  onArchive: () => void;
}) {
  const copyLink = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}?item=${itemId}`;
      await navigator.clipboard.writeText(url);
    } catch {}
  };
  return (
    <details className="relative inline-block">
      <summary
        className="list-none cursor-pointer opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 select-none"
        title="More actions"
        aria-label="More actions"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-50 w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
          >
            <ExternalLink className="w-3 h-3 text-zinc-400" />
            Open
          </button>
        ) : null}
        <button
          type="button"
          onClick={copyLink}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
        >
          <Link2 className="w-3 h-3 text-zinc-400" />
          Copy link
        </button>
        {onDuplicate ? (
          <button
            type="button"
            onClick={onDuplicate}
            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
          >
            <Copy className="w-3 h-3 text-zinc-400" />
            Duplicate
          </button>
        ) : null}
        <div className="h-px bg-zinc-100 my-1" />
        <button
          type="button"
          onClick={onArchive}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50"
        >
          <Trash2 className="w-3 h-3" />
          Archive
        </button>
      </div>
    </details>
  );
}

function RowHoverActions({ itemId }: { itemId: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      // Build a deep-link URL that opens the drawer for this item via
      // Phase 62's ?item=<id> param on whatever board page hosts it.
      const url = `${window.location.origin}${window.location.pathname}?item=${itemId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // navigator.clipboard may reject (insecure context, denied). Silent fail.
    }
  };
  return (
    <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
        title={copied ? "Copied" : "Copy link"}
        aria-label="Copy link to this item"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Link2 className="w-3 h-3" />}
      </button>
    </span>
  );
}

function TitleCell({
  row,
  canEdit,
  onUpdate,
  onOpen,
}: {
  row: BoardItemRow;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<BoardItemRow, "title">>) => void;
  onOpen?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Derived-state-during-render (guarded setState) — avoids the
  // cascading-renders lint that fires on useEffect(setDraft).
  const [syncedTitle, setSyncedTitle] = useState(row.title);
  if (syncedTitle !== row.title) {
    setSyncedTitle(row.title);
    setDraft(row.title);
  }
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(row.title);
      setEditing(false);
      return;
    }
    if (trimmed !== row.title) onUpdate(row.id, { title: trimmed });
    setEditing(false);
  };

  if (!canEdit || !editing) {
    // Cmd/Ctrl-click → inline edit; plain click → open drawer (if
    // available). When read-only or no drawer wired, plain click does
    // nothing.
    return (
      <button
        type="button"
        onClick={(e) => {
          if (canEdit && (e.metaKey || e.ctrlKey)) {
            setEditing(true);
          } else if (onOpen) {
            onOpen();
          } else if (canEdit) {
            setEditing(true);
          }
        }}
        className="w-full text-left truncate hover:text-[var(--os-brand)] transition-colors inline-flex items-center gap-2"
        title={row.title}
      >
        <span className="truncate flex-1 min-w-0">{row.title}</span>
        {(row.subtaskCount ?? 0) > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] text-zinc-400 tabular-nums shrink-0"
            title={`${row.subtaskCount} subtask${row.subtaskCount === 1 ? "" : "s"}`}
          >
            <Layers className="w-3 h-3" />
            {row.subtaskCount}
          </span>
        ) : null}
        {(row.commentCount ?? 0) > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] text-zinc-400 tabular-nums shrink-0"
            title={`${row.commentCount} comment${row.commentCount === 1 ? "" : "s"}`}
          >
            <MessageSquare className="w-3 h-3" />
            {row.commentCount}
          </span>
        ) : null}
        {(row.attachmentCount ?? 0) > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] text-zinc-400 tabular-nums shrink-0"
            title={`${row.attachmentCount} attachment${row.attachmentCount === 1 ? "" : "s"}`}
          >
            <Paperclip className="w-3 h-3" />
            {row.attachmentCount}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(row.title); setEditing(false); }
      }}
      className="w-full bg-transparent outline-none border-b border-[var(--os-brand)]"
    />
  );
}

function StatusCell({
  row,
  canEdit,
  onUpdate,
  monday = false,
}: {
  row: BoardItemRow;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<BoardItemRow, "status">>) => void;
  /** Monday-style Table variant: status fills the whole cell with the
   *  status color + white label, instead of a soft pill. */
  monday?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = useMemo(() => (row.status ? STATUS_BY_VALUE.get(row.status) : null), [row.status]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Monday Table fill — the trigger is a full-cell colored block.
  if (monday) {
    const fill = current ? (
      <span
        className="flex items-center justify-center w-full h-full px-2 text-[12px] font-medium text-white"
        style={{ background: current.color }}
      >
        {current.label}
      </span>
    ) : (
      <span className="flex items-center justify-center w-full h-full bg-zinc-100 text-[11px] text-zinc-400">—</span>
    );
    if (!canEdit) return fill;
    return (
      <div className="relative w-full h-full" ref={ref}>
        <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full h-full min-h-[34px]">
          {fill}
        </button>
        {open ? (
          <div className="absolute z-10 mt-1 left-0 min-w-[160px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
            {DEFAULT_STATUS_OPTIONS.map((opt) => {
              const active = opt.value === row.status;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onUpdate(row.id, { status: opt.value }); setOpen(false); }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                >
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white" style={{ background: opt.color }}>
                    {opt.label}
                  </span>
                  {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  const pill = current ? (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: `${current.color}22`, color: current.color }}
    >
      {current.label}
    </span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );

  if (!canEdit) return pill;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5"
      >
        {pill}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[160px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
          {DEFAULT_STATUS_OPTIONS.map((opt) => {
            const active = opt.value === row.status;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onUpdate(row.id, { status: opt.value }); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
              >
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: `${opt.color}22`, color: opt.color }}
                >
                  {opt.label}
                </span>
                {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function OwnerCell({
  row,
  canEdit,
  onUpdate,
}: {
  row: BoardItemRow;
  canEdit: boolean;
  onUpdate: (id: string, patch: RowPatch) => void;
}) {
  return (
    <AssigneePicker
      value={row.owner ? { ...row.owner, email: null } : null}
      canEdit={canEdit}
      onChange={(person) =>
        onUpdate(row.id, {
          ownerId: person?.id ?? null,
          owner: person
            ? {
                id: person.id,
                firstName: person.firstName ?? "",
                lastName: person.lastName ?? "",
                avatar: person.avatar,
              }
            : null,
        })
      }
    />
  );
}

function GroupByPill({
  groupBy,
  groupDirection,
  groupOptions,
  onGroupBy,
  onDirection,
}: {
  groupBy: string | null;
  groupDirection: "asc" | "desc";
  groupOptions: Array<{ key: string; label: string }>;
  onGroupBy: (next: string | null) => void;
  onDirection: (next: "asc" | "desc") => void;
}) {
  const [open, setOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);

  const activeField = groupBy ? groupOptions.find((o) => o.key === groupBy) : null;
  const activeLabel = activeField?.label ?? "None";
  const fieldOptions = groupOptions.filter((o) => o.key !== "__none__");

  if (!groupBy) {
    // Compact dropdown like ClickUp's collapsed state — single pill that
    // opens the field picker directly.
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 bg-white text-[11.5px] text-zinc-500 hover:bg-zinc-50"
        >
          <Layers className="w-3 h-3" />
          <span>Group</span>
        </button>
        {open ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute left-0 top-full mt-1 z-40 w-[200px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
              {fieldOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => { onGroupBy(o.key); setOpen(false); }}
                  className="flex items-center w-full text-left px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-zinc-100 text-[11.5px] text-zinc-800 hover:bg-zinc-200"
      >
        <Layers className="w-3 h-3" />
        <span className="font-medium">{activeLabel}</span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-1 z-40 w-[340px] rounded-lg border border-zinc-200 bg-white shadow-lg p-3">
            <p className="text-[11.5px] text-zinc-500 mb-2">Group by</p>
            <div className="flex items-center gap-2">
              {/* Field picker */}
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => { setFieldOpen((v) => !v); setDirOpen(false); }}
                  className="w-full inline-flex items-center justify-between gap-1.5 h-8 px-2.5 rounded-md border border-zinc-200 bg-white text-[12px] text-zinc-800 hover:bg-zinc-50"
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Layers className="w-3 h-3 text-zinc-500 shrink-0" />
                    <span className="truncate">{activeLabel}</span>
                  </span>
                  <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
                </button>
                {fieldOpen ? (
                  <div className="absolute left-0 top-full mt-1 z-50 w-full rounded-md border border-zinc-200 bg-white shadow-lg py-1">
                    {fieldOptions.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => { onGroupBy(o.key); setFieldOpen(false); }}
                        className={`flex items-center w-full text-left px-3 py-1.5 text-[12.5px] ${
                          o.key === groupBy ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {/* Direction picker */}
              <div className="relative w-[120px]">
                <button
                  type="button"
                  onClick={() => { setDirOpen((v) => !v); setFieldOpen(false); }}
                  className="w-full inline-flex items-center justify-between gap-1.5 h-8 px-2.5 rounded-md border border-zinc-200 bg-white text-[12px] text-zinc-800 hover:bg-zinc-50"
                >
                  <span className="truncate">{groupDirection === "asc" ? "Ascending" : "Descending"}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
                </button>
                {dirOpen ? (
                  <div className="absolute left-0 top-full mt-1 z-50 w-full rounded-md border border-zinc-200 bg-white shadow-lg py-1">
                    <button
                      type="button"
                      onClick={() => { onDirection("asc"); setDirOpen(false); }}
                      className={`flex items-center w-full text-left px-3 py-1.5 text-[12.5px] ${
                        groupDirection === "asc" ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      Ascending
                    </button>
                    <button
                      type="button"
                      onClick={() => { onDirection("desc"); setDirOpen(false); }}
                      className={`flex items-center w-full text-left px-3 py-1.5 text-[12.5px] ${
                        groupDirection === "desc" ? "bg-zinc-50 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      Descending
                    </button>
                  </div>
                ) : null}
              </div>
              {/* Clear grouping */}
              <button
                type="button"
                onClick={() => { onGroupBy(null); setOpen(false); }}
                aria-label="Remove grouping"
                title="Remove grouping"
                className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
