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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2, X, ChevronDown } from "lucide-react";
import {
  DEFAULT_STATUS_OPTIONS,
  type BoardItemRow,
} from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { FieldValue } from "./field-value";

interface BoardTableViewProps {
  boardId: string;
  initialItems: BoardItemRow[];
  /** Custom fields from Board.schema.fields. Each becomes a column. */
  initialFields?: FieldDef[];
  canEdit: boolean;
  /** When set, clicking a row's title opens the row drawer. The
   *  parent owns drawer state; we just emit the id. */
  onOpenItem?: (itemId: string) => void;
}

type StatusOption = { value: string; label: string; color: string };
const STATUS_BY_VALUE: Map<string, StatusOption> = new Map(
  DEFAULT_STATUS_OPTIONS.map((o) => [o.value as string, { ...o } as StatusOption]),
);

export function BoardTableView({ boardId, initialItems, initialFields, canEdit, onOpenItem }: BoardTableViewProps) {
  const customFields: FieldDef[] = initialFields ?? [];
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync if the parent ever passes a refreshed initial set.
  useEffect(() => { setItems(initialItems); }, [initialItems]);

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

  const handleUpdate = useCallback(async (id: string, patch: Partial<Pick<BoardItemRow, "title" | "status">>) => {
    if (!canEdit) return;
    // Optimistic
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

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {error ? (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-muted hover:text-foreground"><X className="w-3 h-3" /></button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
              <th className="px-4 py-2 font-medium w-[36%]">Name</th>
              <th className="px-4 py-2 font-medium w-[140px]">Status</th>
              <th className="px-4 py-2 font-medium w-[180px]">Owner</th>
              {customFields.map((f) => (
                <th key={f.key} className="px-4 py-2 font-medium">{f.label}</th>
              ))}
              <th className="px-4 py-2 font-medium w-[120px]">Created</th>
              <th className="px-2 py-2 w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <Row
                key={row.id}
                row={row}
                customFields={customFields}
                canEdit={canEdit}
                onUpdate={handleUpdate}
                onArchive={handleArchive}
                onOpen={onOpenItem ? () => onOpenItem(row.id) : undefined}
              />
            ))}
            {canEdit ? (
              <tr className="hover:bg-surface-2">
                <td colSpan={5 + customFields.length} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding}
                    className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {adding ? "Adding…" : "Add row"}
                  </button>
                </td>
              </tr>
            ) : null}
            {items.length === 0 && !canEdit ? (
              <tr><td colSpan={5 + customFields.length} className="px-4 py-8 text-center text-sm text-muted">No items yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Inline row editor ──────────────────────────────────────────────

function Row({
  row,
  customFields,
  canEdit,
  onUpdate,
  onArchive,
  onOpen,
}: {
  row: BoardItemRow;
  customFields: FieldDef[];
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<BoardItemRow, "title" | "status">>) => void;
  onArchive: (id: string) => void;
  onOpen?: () => void;
}) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-2 group">
      <td className="px-4 py-2">
        <TitleCell row={row} canEdit={canEdit} onUpdate={onUpdate} onOpen={onOpen} />
      </td>
      <td className="px-4 py-2">
        <StatusCell row={row} canEdit={canEdit} onUpdate={onUpdate} />
      </td>
      <td className="px-4 py-2">
        <OwnerCell row={row} />
      </td>
      {customFields.map((f) => (
        <td key={f.key} className="px-4 py-2">
          <FieldValue field={f} value={row.metadata?.[f.key]} mode="display" />
        </td>
      ))}
      <td className="px-4 py-2 text-xs text-muted">
        {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}
      </td>
      <td className="px-2 py-2 text-right">
        {canEdit ? (
          <button
            type="button"
            onClick={() => onArchive(row.id)}
            className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-muted hover:text-red-500 hover:bg-red-500/10"
            aria-label="Archive row"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </td>
    </tr>
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

  useEffect(() => { setDraft(row.title); }, [row.title]);
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
        className="w-full text-left truncate hover:text-[var(--os-brand)] transition-colors"
        title={row.title}
      >
        {row.title}
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
}: {
  row: BoardItemRow;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<BoardItemRow, "status">>) => void;
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

  const pill = current ? (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: `${current.color}22`, color: current.color }}
    >
      {current.label}
    </span>
  ) : (
    <span className="text-xs text-muted">—</span>
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
        <ChevronDown className="w-3 h-3 text-muted" />
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[160px] rounded-md border border-border bg-surface shadow-lg py-1">
          {DEFAULT_STATUS_OPTIONS.map((opt) => {
            const active = opt.value === row.status;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onUpdate(row.id, { status: opt.value }); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-surface-2"
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

function OwnerCell({ row }: { row: BoardItemRow }) {
  if (!row.owner) {
    return <span className="text-xs text-muted">Unassigned</span>;
  }
  const initials = `${row.owner.firstName?.[0] ?? ""}${row.owner.lastName?.[0] ?? ""}`.toUpperCase();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-3 text-xs font-medium">
        {initials || "?"}
      </span>
      <span className="text-sm">{row.owner.firstName} {row.owner.lastName}</span>
    </span>
  );
}
