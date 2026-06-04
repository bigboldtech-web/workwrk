"use client";

// BoardItemDrawer — right-slide-in detail panel for any Board Item
// (TABLE row or KANBAN card). Phase 3d MVP:
//   - Title (large, inline-editable)
//   - Status pill picker (same palette as table/kanban)
//   - Description (textarea, auto-saves to metadata.description on blur)
//   - Owner display (picker comes in Phase 3e once a /api/users endpoint exists)
//   - Created / updated dates
//   - Comments thread — placeholder (ItemUpdate wiring lands in Phase 3e)
//
// Visual spec from 2026-06-02 Monday-clean memory: whitespace > color,
// no decorative borders, single accent for active controls, type-driven
// hierarchy. Drawer slides from the right at 480px, full-height.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Trash2, X } from "lucide-react";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { FieldValue } from "./field-value";
import { ItemThread } from "./item-thread";
import { LinkedAttachments } from "./linked-attachments";
import { TimeTracker } from "./time-tracker";

interface BoardItemDrawerProps {
  itemId: string | null;
  canEdit: boolean;
  /** Current user id — passed through to ItemThread so it can gate
   *  "delete my own comment". */
  currentUserId: string | null;
  /** Custom fields defined on the parent Board. Renders editor rows
   *  in the field grid; empty array means no custom fields. */
  fields?: FieldDef[];
  onClose: () => void;
  onItemChanged?: (item: BoardItemRow) => void;
  onItemArchived?: (itemId: string) => void;
}

const STATUS_LOOKUP: Record<string, { label: string; color: string }> = Object.fromEntries(
  DEFAULT_STATUS_OPTIONS.map((o) => [o.value, { label: o.label, color: o.color }]),
);

export function BoardItemDrawer({
  itemId,
  canEdit,
  currentUserId,
  fields,
  onClose,
  onItemChanged,
  onItemArchived,
}: BoardItemDrawerProps) {
  const customFields: FieldDef[] = fields ?? [];
  const [item, setItem] = useState<BoardItemRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load when itemId changes.
  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    setLoading(true);
    setError(null);
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/items/${itemId}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setError("Could not load item");
          return;
        }
        const data = await res.json();
        if (active) setItem(data.item);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [itemId]);

  // ESC to close (when no inline edit is focused).
  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemId, onClose]);

  const patch = useCallback(async (body: Partial<Pick<BoardItemRow, "title" | "status"> & { metadata: Record<string, unknown> }>) => {
    if (!item) return;
    // Optimistic
    setItem((prev) => (prev ? { ...prev, ...body } : prev));
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save");
        // Reload truth.
        const fresh = await fetch(`/api/items/${item.id}`).then((r) => r.json()).catch(() => null);
        if (fresh?.item) setItem(fresh.item);
        return;
      }
      setItem(data.item);
      onItemChanged?.(data.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [item, onItemChanged]);

  const archive = useCallback(async () => {
    if (!item) return;
    if (!confirm("Archive this row? You can restore from Trash.")) return;
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to archive");
        return;
      }
      onItemArchived?.(item.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    }
  }, [item, onClose, onItemArchived]);

  const open = !!itemId;

  return (
    <>
      {/* Overlay — click to close */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-[480px] max-w-full bg-white border-l border-zinc-200 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {open ? (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-5 py-3 border-b border-zinc-200 flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-500">Item</span>
              <div className="ml-auto flex items-center gap-1">
                {canEdit && item ? (
                  <button
                    type="button"
                    onClick={archive}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-500 px-2 py-1 rounded hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Archive
                  </button>
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="px-5 py-2 text-xs text-red-500 bg-red-500/10 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null}

            {loading || !item ? (
              <div className="flex-1 px-5 py-6 text-sm text-zinc-500">Loading…</div>
            ) : (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                <TitleField item={item} canEdit={canEdit} onSave={(t) => patch({ title: t })} />

                {/* Field grid: status, owner, custom fields, dates */}
                <div className="space-y-3">
                  <Row label="Status">
                    <StatusPicker
                      value={item.status}
                      canEdit={canEdit}
                      onChange={(v) => patch({ status: v })}
                    />
                  </Row>
                  <Row label="Owner">
                    {item.owner ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-100 text-xs font-medium">
                          {`${item.owner.firstName?.[0] ?? ""}${item.owner.lastName?.[0] ?? ""}`.toUpperCase() || "?"}
                        </span>
                        <span className="text-sm">{item.owner.firstName} {item.owner.lastName}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">Unassigned</span>
                    )}
                  </Row>
                  {customFields.map((f) => (
                    <Row key={f.key} label={f.label}>
                      <FieldValue
                        field={f}
                        value={item.metadata?.[f.key]}
                        mode="edit"
                        disabled={!canEdit}
                        onChange={(next) => patch({ metadata: { ...item.metadata, [f.key]: next } })}
                      />
                    </Row>
                  ))}
                  <Row label="Created">
                    <span className="text-sm">{new Date(item.createdAt).toLocaleString()}</span>
                  </Row>
                  <Row label="Updated">
                    <span className="text-sm text-zinc-500">{new Date(item.updatedAt).toLocaleString()}</span>
                  </Row>
                </div>

                {/* Description */}
                <DescriptionField
                  item={item}
                  canEdit={canEdit}
                  onSave={(desc) =>
                    patch({ metadata: { ...item.metadata, description: desc } })
                  }
                />

                {/* Linked notes + whiteboards */}
                <LinkedAttachments
                  sourceType="BOARD_ITEM"
                  sourceId={item.id}
                  canEdit={canEdit}
                />

                {/* Time tracking */}
                <TimeTracker
                  entityType="BOARD_ITEM"
                  entityId={item.id}
                  canEdit={canEdit}
                />

                {/* Comments + Activity thread */}
                <ItemThread itemId={item.id} canEdit={canEdit} currentUserId={currentUserId} />
              </div>
            )}
          </div>
        ) : null}
      </aside>
    </>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-zinc-500 w-[88px] flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function TitleField({
  item,
  canEdit,
  onSave,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  // Re-sync draft from the prop using the official derived-state-during-
  // render pattern: setState inside render is allowed when guarded by an
  // equality check. Avoids the cascading-renders lint flag that fires
  // on useEffect(setDraft).
  const [syncedTitle, setSyncedTitle] = useState(item.title);
  if (syncedTitle !== item.title) {
    setSyncedTitle(item.title);
    setDraft(item.title);
  }
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(item.title); setEditing(false); return; }
    if (trimmed !== item.title) onSave(trimmed);
    setEditing(false);
  };

  if (!canEdit || !editing) {
    return (
      <button
        type="button"
        onClick={() => canEdit && setEditing(true)}
        className="w-full text-left text-lg font-semibold"
      >
        {item.title}
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
        if (e.key === "Escape") { setDraft(item.title); setEditing(false); }
      }}
      className="w-full text-lg font-semibold bg-transparent outline-none border-b border-[var(--os-brand)]"
    />
  );
}

function DescriptionField({
  item,
  canEdit,
  onSave,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  onSave: (description: string) => void;
}) {
  const initial = typeof item.metadata?.description === "string" ? item.metadata.description : "";
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [initial]);

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Description</h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== initial) onSave(draft); }}
        disabled={!canEdit}
        rows={4}
        placeholder={canEdit ? "Add a description…" : "No description"}
        className="w-full px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)] disabled:opacity-60"
      />
    </div>
  );
}

function StatusPicker({
  value,
  canEdit,
  onChange,
}: {
  value: string | null;
  canEdit: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = value ? STATUS_LOOKUP[value] : null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pill = current ? (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: `${current.color}22`, color: current.color }}
    >
      {current.label}
    </span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );

  if (!canEdit) return pill;
  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5"
      >
        {pill}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1">
          {DEFAULT_STATUS_OPTIONS.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
              >
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
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
