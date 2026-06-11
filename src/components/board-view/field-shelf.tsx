"use client";

// FieldShelf — right-slide panel for adding / managing Board fields.
// Matches the ClickUp "Fields" panel:
//   - Search box at top.
//   - "Create new" tab: tile grid grouped by Common / WorkwrK / AI / Advanced.
//   - "Add existing" tab: copy a field definition from a sibling board
//     in the same Space.
//   - "On this board": Shown / Hidden sections with per-view eye
//     toggles, drag-to-reorder, rename, choice-option editor (add /
//     rename / recolor / delete choices), and remove.
//
// Posts to /api/boards/[id]/fields and /api/boards/[id]/fields/[key].
// Visibility persists per-view in View.config.hiddenFields (the parent
// BoardCanvas owns that state + PATCH). On any change, calls
// onFieldsChanged so the board re-renders.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Plus, Search, Trash2, X } from "lucide-react";
import {
  FIELD_CATALOG,
  type FieldChoice,
  type FieldDef,
  type FieldType,
  type FieldCatalogEntry,
} from "@/lib/field-catalog";

const CHOICE_TYPES: ReadonlySet<string> = new Set(["DROPDOWN", "MULTI_SELECT", "LABELS", "TSHIRT_SIZE", "CUSTOM_DROPDOWN"]);

/** ClickUp-ish 8-swatch palette for choice pills. */
const SWATCHES = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#94a3b8"];

interface FieldShelfProps {
  boardId: string;
  open: boolean;
  canEdit: boolean;
  fields: FieldDef[];
  /** Per-view hidden field keys (View.config.hiddenFields). */
  hiddenFields?: string[];
  /** Toggle a field's visibility on the active view. Absent when the
   *  board has no persisted view yet — the toggles hide themselves. */
  onToggleHidden?: (key: string) => void;
  onClose: () => void;
  onFieldsChanged: (fields: FieldDef[]) => void;
}

type Tab = "create" | "existing";

export function FieldShelf({ boardId, open, canEdit, fields, hiddenFields, onToggleHidden, onClose, onFieldsChanged }: FieldShelfProps) {
  const [tab, setTab] = useState<Tab>("create");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const hidden = useMemo(() => new Set(hiddenFields ?? []), [hiddenFields]);
  const ordered = useMemo(() => [...fields].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [fields]);
  const shownFields = ordered.filter((f) => !hidden.has(f.key));
  const hiddenList = ordered.filter((f) => hidden.has(f.key));

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

  const addField = async (type: FieldType, label: string, options?: unknown) => {
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/fields`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options ? { label, type, options } : { label, type }),
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

  const patchField = async (key: string, patch: Record<string, unknown>) => {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/fields/${key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to update field");
        return;
      }
      await refetchFields();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update field");
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

  // Drag-to-reorder within the Shown section. On drop, resequence the
  // full ordered list and PATCH every field whose position changed.
  const handleDrop = async (targetKey: string) => {
    const fromKey = dragKey;
    setDragKey(null);
    setDragOverKey(null);
    if (!fromKey || fromKey === targetKey || !canEdit) return;
    const seq = ordered.map((f) => f.key);
    const from = seq.indexOf(fromKey);
    const to = seq.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    seq.splice(to, 0, ...seq.splice(from, 1));
    // Optimistic local order.
    const byKey = new Map(ordered.map((f) => [f.key, f] as const));
    onFieldsChanged(seq.map((k, i) => ({ ...byKey.get(k)!, position: i })));
    const changed = seq
      .map((k, i) => ({ key: k, position: i }))
      .filter(({ key, position }) => (byKey.get(key)?.position ?? 0) !== position);
    for (const { key, position } of changed) {
      await fetch(`/api/boards/${boardId}/fields/${key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position }),
      }).catch(() => {});
    }
    await refetchFields();
  };

  const fieldRowProps = (f: FieldDef) => ({
    field: f,
    canEdit,
    isHidden: hidden.has(f.key),
    onToggleHidden: onToggleHidden ? () => onToggleHidden(f.key) : undefined,
    expanded: expandedKey === f.key,
    onToggleExpand: CHOICE_TYPES.has(f.type)
      ? () => setExpandedKey((k) => (k === f.key ? null : f.key))
      : undefined,
    onRename: (label: string) => patchField(f.key, { label }),
    onOptionsChange: (choices: FieldChoice[]) => patchField(f.key, { options: { ...(f.options ?? {}), choices } }),
    onRemove: () => removeField(f.key),
    dragging: dragKey === f.key,
    dragOver: dragOverKey === f.key,
    onDragStart: () => setDragKey(f.key),
    onDragOver: () => setDragOverKey(f.key),
    onDrop: () => void handleDrop(f.key),
    onDragEnd: () => { setDragKey(null); setDragOverKey(null); },
  });

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      ) : null}

      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-full bg-white border-l border-zinc-200 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {open ? (
          <div className="flex flex-col h-full">
            <div className="px-5 py-3 border-b border-zinc-200 flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium">Fields</span>
            </div>

            <div className="flex items-center gap-3 px-5 mt-3 border-b border-zinc-200">
              <TabBtn active={tab === "create"} onClick={() => setTab("create")} label="Create new" />
              <TabBtn active={tab === "existing"} onClick={() => setTab("existing")} label="Add existing" />
            </div>

            <div className="px-5 pt-3 pb-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for new or existing fields"
                  className="w-full h-8 pl-8 pr-3 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:border-[var(--os-brand)]"
                />
              </div>
            </div>

            {error ? (
              <div className="mx-5 mb-2 text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {tab === "create" ? (
                <CreateNewTab grouped={grouped} busy={busy} canEdit={canEdit} onPick={(t, l) => void addField(t, l)} />
              ) : (
                <ExistingTab
                  boardId={boardId}
                  open={open}
                  query={query}
                  busy={busy}
                  canEdit={canEdit}
                  existingFields={fields}
                  onPick={(c) => void addField(c.field.type as FieldType, c.field.label, c.field.options)}
                />
              )}

              {ordered.length > 0 ? (
                <section className="mt-6 px-2">
                  <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                    {onToggleHidden ? "Shown" : "On this board"}
                  </h3>
                  <ul className="space-y-1">
                    {shownFields.map((f) => (
                      <FieldRow key={f.key} {...fieldRowProps(f)} />
                    ))}
                    {shownFields.length === 0 ? (
                      <li className="px-2 py-1.5 text-xs text-zinc-400">All fields are hidden on this view</li>
                    ) : null}
                  </ul>
                  {onToggleHidden && hiddenList.length > 0 ? (
                    <>
                      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 mt-5">Hidden</h3>
                      <ul className="space-y-1">
                        {hiddenList.map((f) => (
                          <FieldRow key={f.key} {...fieldRowProps(f)} />
                        ))}
                      </ul>
                    </>
                  ) : null}
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
          ? "border-foreground text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
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
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 px-2 mb-1">{group}</h3>
            <ul className="space-y-0.5">
              {items.map((e) => (
                <li key={e.type}>
                  <button
                    type="button"
                    onClick={() => onPick(e.type, e.label)}
                    disabled={busy || !canEdit}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-left disabled:opacity-50"
                  >
                    <e.Icon className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm flex-1">{e.label}</span>
                    {!e.tier1 ? (
                      <span className="text-[10px] uppercase tracking-wide text-zinc-500">Soon</span>
                    ) : null}
                    <Plus className="w-3.5 h-3.5 text-zinc-500 opacity-0 group-hover:opacity-100" />
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

// ── Add existing — copy a field def from a sibling board ──────────

interface AvailableCandidate {
  boardId: string;
  boardName: string;
  field: { key: string; label: string; type: string; options?: unknown };
}

function ExistingTab({
  boardId,
  open,
  query,
  busy,
  canEdit,
  existingFields,
  onPick,
}: {
  boardId: string;
  open: boolean;
  query: string;
  busy: boolean;
  canEdit: boolean;
  existingFields: FieldDef[];
  onPick: (candidate: AvailableCandidate) => void;
}) {
  const [candidates, setCandidates] = useState<AvailableCandidate[] | null>(null);

  useEffect(() => {
    if (!open || candidates !== null) return;
    let active = true;
    fetch(`/api/boards/${boardId}/fields/available`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d) => { if (active) setCandidates(Array.isArray(d?.candidates) ? d.candidates : []); })
      .catch(() => { if (active) setCandidates([]); });
    return () => { active = false; };
  }, [open, boardId, candidates]);

  // Skip fields that already exist here (same type + label).
  const existingKeys = new Set(existingFields.map((f) => `${f.type}:${f.label.toLowerCase()}`));
  const q = query.trim().toLowerCase();
  const list = (candidates ?? []).filter(
    (c) => !existingKeys.has(`${c.field.type}:${c.field.label.toLowerCase()}`) &&
      (!q || c.field.label.toLowerCase().includes(q)),
  );

  if (candidates === null) {
    return <div className="px-4 py-6 text-sm text-zinc-500 text-center">Loading fields from this Space…</div>;
  }
  if (list.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-zinc-500 text-center">
        No reusable fields found on other boards in this Space.
      </div>
    );
  }
  return (
    <ul className="space-y-0.5 px-1">
      {list.map((c) => (
        <li key={`${c.boardId}:${c.field.key}`}>
          <button
            type="button"
            disabled={busy || !canEdit}
            onClick={() => onPick(c)}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-left disabled:opacity-50"
          >
            <span className="text-sm flex-1 truncate">{c.field.label}</span>
            <span className="text-[10px] uppercase tracking-wide text-zinc-400">{c.field.type.replace(/_/g, " ").toLowerCase()}</span>
            <span className="text-[11px] text-zinc-500 truncate max-w-[110px]">from {c.boardName}</span>
            <Plus className="w-3.5 h-3.5 text-zinc-500" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Field row — rename / visibility / reorder / options / remove ──

function FieldRow({
  field,
  canEdit,
  isHidden,
  onToggleHidden,
  expanded,
  onToggleExpand,
  onRename,
  onOptionsChange,
  onRemove,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  field: FieldDef;
  canEdit: boolean;
  isHidden: boolean;
  onToggleHidden?: () => void;
  expanded: boolean;
  onToggleExpand?: () => void;
  onRename: (label: string) => void;
  onOptionsChange: (choices: FieldChoice[]) => void;
  onRemove: () => void;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.label);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== field.label) onRename(trimmed);
    setEditing(false);
  };

  return (
    <li
      draggable={canEdit && !editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", field.key); } catch {}
        onDragStart();
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={`rounded-md ${dragging ? "opacity-40" : ""} ${
        dragOver ? "outline outline-2 outline-[var(--os-brand)] outline-offset-[-2px]" : ""
      }`}
    >
      <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50">
        {canEdit ? (
          <span className="text-zinc-300 cursor-grab group-hover:text-zinc-400" aria-hidden>
            <GripVertical className="w-3 h-3" />
          </span>
        ) : null}
        <span className="text-xs text-zinc-500 uppercase tracking-wide w-[60px] flex-shrink-0 truncate">
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
        {onToggleExpand ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            aria-label="Edit options"
            title="Edit options"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : null}
        {onToggleHidden ? (
          <button
            type="button"
            onClick={onToggleHidden}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            aria-label={isHidden ? "Show on this view" : "Hide on this view"}
            title={isHidden ? "Show on this view" : "Hide on this view"}
          >
            {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-red-500 hover:bg-red-500/10"
            aria-label="Remove field"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ChoiceEditor
          choices={field.options?.choices ?? []}
          canEdit={canEdit}
          onChange={onOptionsChange}
        />
      ) : null}
    </li>
  );
}

// ── Choice editor — add / rename / recolor / delete options ───────

function ChoiceEditor({
  choices,
  canEdit,
  onChange,
}: {
  choices: FieldChoice[];
  canEdit: boolean;
  onChange: (choices: FieldChoice[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [colorFor, setColorFor] = useState<string | null>(null);

  const addChoice = () => {
    const label = draft.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `opt_${choices.length + 1}`;
    if (choices.some((c) => c.value === value)) { setDraft(""); return; }
    onChange([...choices, { value, label, color: SWATCHES[choices.length % SWATCHES.length] }]);
    setDraft("");
  };

  return (
    <div className="ml-7 mr-2 mb-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-2 space-y-1.5">
      {choices.map((c) => (
        <div key={c.value} className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setColorFor((k) => (k === c.value ? null : c.value))}
            className="w-4 h-4 rounded-full shrink-0 ring-1 ring-black/10"
            style={{ background: c.color ?? "#94a3b8" }}
            aria-label={`Change color for ${c.label}`}
            title="Change color"
          />
          <input
            type="text"
            defaultValue={c.label}
            disabled={!canEdit}
            onBlur={(e) => {
              const label = e.target.value.trim();
              if (label && label !== c.label) {
                onChange(choices.map((x) => (x.value === c.value ? { ...x, label } : x)));
              } else {
                e.target.value = c.label;
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
            className="flex-1 bg-transparent text-[13px] outline-none border-b border-transparent focus:border-[var(--os-brand)]"
          />
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                if (!confirm(`Delete option “${c.label}”? Rows keep the raw value but lose the pill.`)) return;
                onChange(choices.filter((x) => x.value !== c.value));
              }}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-500/10"
              aria-label={`Delete ${c.label}`}
            >
              <X className="w-3 h-3" />
            </button>
          ) : null}
          {colorFor === c.value && canEdit ? (
            <div className="absolute z-10 mt-8 flex items-center gap-1 rounded-md border border-zinc-200 bg-white shadow-lg px-2 py-1.5">
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onChange(choices.map((x) => (x.value === c.value ? { ...x, color: s } : x)));
                    setColorFor(null);
                  }}
                  className={`w-4 h-4 rounded-full ring-1 ring-black/10 ${c.color === s ? "outline outline-2 outline-offset-1 outline-zinc-400" : ""}`}
                  style={{ background: s }}
                  aria-label={`Set color ${s}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Plus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addChoice(); }}
            onBlur={() => { if (draft.trim()) addChoice(); }}
            placeholder="Add an option…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
          />
        </div>
      ) : choices.length === 0 ? (
        <div className="text-xs text-zinc-400">No options yet</div>
      ) : null}
    </div>
  );
}
