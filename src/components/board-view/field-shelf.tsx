"use client";

// FieldShelf — right-slide panel for adding / managing Board fields.
// Matches the 2026-06-02 ClickUp "Fields" panel screenshot:
//   - Search box at top.
//   - "Create new" tab: tile grid grouped by Common / AI / Advanced.
//   - "Add existing" tab: stub for now (placeholder).
//   - Existing fields list at the bottom — rename + remove.
//
// Posts to /api/boards/[id]/fields and /api/boards/[id]/fields/[key].
// On any change, calls onFieldsChanged so the board re-renders.

import { useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { FIELD_CATALOG, type FieldDef, type FieldType, type FieldCatalogEntry } from "@/lib/field-catalog";

interface FieldShelfProps {
  boardId: string;
  open: boolean;
  canEdit: boolean;
  fields: FieldDef[];
  onClose: () => void;
  onFieldsChanged: (fields: FieldDef[]) => void;
}

type Tab = "create" | "existing";

export function FieldShelf({ boardId, open, canEdit, fields, onClose, onFieldsChanged }: FieldShelfProps) {
  const [tab, setTab] = useState<Tab>("create");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FIELD_CATALOG;
    return FIELD_CATALOG.filter((e) => e.label.toLowerCase().includes(q));
  }, [query]);

  const grouped = useMemo(() => {
    const out: Record<string, FieldCatalogEntry[]> = { Common: [], WorkwrK: [], AI: [], Advanced: [] };
    for (const e of filtered) out[e.group].push(e);
    return out;
  }, [filtered]);

  const refetchFields = async () => {
    const res = await fetch(`/api/boards/${boardId}/fields`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      onFieldsChanged(data.fields as FieldDef[]);
    }
  };

  const addField = async (type: FieldType, label: string) => {
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/fields`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to add field");
        return;
      }
      await refetchFields();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add field");
    } finally {
      setBusy(false);
    }
  };

  const renameField = async (key: string, label: string) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/fields/${key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to rename");
        return;
      }
      await refetchFields();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename");
    }
  };

  const removeField = async (key: string) => {
    if (!canEdit) return;
    if (!confirm("Remove this field? Existing values stay in metadata but won't be shown.")) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/fields/${key}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to remove field");
        return;
      }
      await refetchFields();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove field");
    }
  };

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      ) : null}

      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-full bg-surface border-l border-border shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {open ? (
          <div className="flex flex-col h-full">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted hover:bg-surface-2 hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium">Fields</span>
            </div>

            <div className="flex items-center gap-3 px-5 mt-3 border-b border-border">
              <TabBtn active={tab === "create"} onClick={() => setTab("create")} label="Create new" />
              <TabBtn active={tab === "existing"} onClick={() => setTab("existing")} label="Add existing" />
            </div>

            <div className="px-5 pt-3 pb-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for new or existing fields"
                  className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-surface text-sm focus:outline-none focus:border-[var(--os-brand)]"
                />
              </div>
            </div>

            {error ? (
              <div className="mx-5 mb-2 text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} className="text-muted hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {tab === "create" ? (
                <CreateNewTab grouped={grouped} busy={busy} canEdit={canEdit} onPick={addField} />
              ) : (
                <ExistingTab />
              )}

              {fields.length > 0 ? (
                <section className="mt-6 px-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted mb-2">On this board</h3>
                  <ul className="space-y-1">
                    {fields.map((f) => (
                      <FieldRow
                        key={f.key}
                        field={f}
                        canEdit={canEdit}
                        onRename={(label) => renameField(f.key, label)}
                        onRemove={() => removeField(f.key)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm py-2 -mb-px border-b-2 px-1 ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function CreateNewTab({
  grouped,
  busy,
  canEdit,
  onPick,
}: {
  grouped: Record<string, FieldCatalogEntry[]>;
  busy: boolean;
  canEdit: boolean;
  onPick: (type: FieldType, label: string) => void;
}) {
  return (
    <div className="space-y-4">
      {(["Common", "WorkwrK", "AI", "Advanced"] as const).map((group) => {
        const items = grouped[group] ?? [];
        if (items.length === 0) return null;
        return (
          <section key={group}>
            <h3 className="text-xs uppercase tracking-wide text-muted px-2 mb-1">{group}</h3>
            <ul className="space-y-0.5">
              {items.map((e) => (
                <li key={e.type}>
                  <button
                    type="button"
                    onClick={() => onPick(e.type, e.label)}
                    disabled={busy || !canEdit}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-2 text-left disabled:opacity-50"
                  >
                    <e.Icon className="w-4 h-4 text-muted" />
                    <span className="text-sm flex-1">{e.label}</span>
                    {!e.tier1 ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted">Soon</span>
                    ) : null}
                    <Plus className="w-3.5 h-3.5 text-muted opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ExistingTab() {
  return (
    <div className="px-2 py-6 text-sm text-muted text-center">
      <div className="text-xs">"Add existing" lets you reuse fields from another Board.</div>
      <div className="text-xs mt-1">Wires up in Phase 3g.</div>
    </div>
  );
}

function FieldRow({
  field,
  canEdit,
  onRename,
  onRemove,
}: {
  field: FieldDef;
  canEdit: boolean;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.label);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== field.label) onRename(trimmed);
    setEditing(false);
  };

  return (
    <li className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2">
      <span className="text-xs text-muted uppercase tracking-wide w-[60px] flex-shrink-0">
        {field.type.replace(/_/g, " ").toLowerCase()}
      </span>
      {canEdit && editing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(field.label); setEditing(false); }
          }}
          autoFocus
          className="flex-1 bg-transparent outline-none border-b border-[var(--os-brand)] text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setEditing(true)}
          className="flex-1 text-left text-sm truncate"
        >
          {field.label}
        </button>
      )}
      {canEdit ? (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-muted hover:text-red-500 hover:bg-red-500/10"
          aria-label="Remove field"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </li>
  );
}
