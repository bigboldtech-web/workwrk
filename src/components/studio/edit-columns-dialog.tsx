"use client";

// EditColumnsDialog — modify a Studio board's column list without
// recreating the board. Users can:
//   - Rename a column label
//   - Change a column's type
//   - Reorder columns (up/down)
//   - Edit choices for SELECT / MULTI_SELECT
//   - Add a new column
//   - Remove a column
//
// On save we POST the whole new array to PATCH /api/studio/boards/[slug].
// `key` stays stable per row even on rename — that way existing row
// data keyed by it doesn't get orphaned. New columns get a generated
// key (auto-derived from label) but a manual override input is
// available in case the label can't be cleanly slugified.

import { useState } from "react";
import {
  X, Loader2, Plus, GripVertical, Trash2, Check, AlertCircle,
} from "lucide-react";
import type { BoardField } from "@/components/board-view/board-view";

export type StudioFieldDraft = {
  key: string;
  label: string;
  type: BoardField["fieldType"];
  // CSV serialization of choices for the editor input.
  optionsCsv?: string;
};

const FIELD_TYPE_LABEL: Record<BoardField["fieldType"], string> = {
  TEXT: "Text", TEXTAREA: "Long text", NUMBER: "Number", DATE: "Date",
  CHECKBOX: "Checkbox", SELECT: "Single select", MULTI_SELECT: "Multi select",
  URL: "URL", EMAIL: "Email",
  USER: "Person", RELATION: "Linked record",
  PRIORITY: "Priority", STATUS: "Status",
  TIMELINE: "Timeline", RATING: "Rating", PROGRESS: "Progress",
  FILES: "Files", PHONE: "Phone", LOCATION: "Location", COUNTRY: "Country",
  TAGS: "Tags", DURATION: "Time tracker", FORMULA: "Formula",
  CONNECT_BOARDS: "Connect boards",
};

function keyFromLabel(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

function fieldsToDraft(
  fields: Array<{ key: string; label: string; type: BoardField["fieldType"]; options?: { choices?: { value: string; label?: string }[] } }>,
): StudioFieldDraft[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    optionsCsv: f.options?.choices
      ? f.options.choices.map((c) => c.label ?? c.value).join(", ")
      : undefined,
  }));
}

function draftToFields(draft: StudioFieldDraft[]) {
  return draft
    .filter((f) => f.label.trim())
    .map((f) => ({
      key: (f.key && f.key.trim()) || keyFromLabel(f.label),
      label: f.label.trim(),
      type: f.type,
      ...(f.type === "SELECT" || f.type === "MULTI_SELECT"
        ? {
            options: {
              choices: (f.optionsCsv ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((v) => ({
                  value: v.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                  label: v,
                })),
            },
          }
        : {}),
    }));
}

interface Props {
  boardSlug: string;
  initialFields: StudioFieldDraft[] | Array<{ key: string; label: string; type: BoardField["fieldType"]; options?: { choices?: { value: string; label?: string }[] } }>;
  onClose: () => void;
  onSaved: () => void;
}

export function EditColumnsDialog({ boardSlug, initialFields, onClose, onSaved }: Props) {
  const seed = "optionsCsv" in (initialFields[0] ?? {})
    ? (initialFields as StudioFieldDraft[])
    : fieldsToDraft(initialFields as Array<{ key: string; label: string; type: BoardField["fieldType"]; options?: { choices?: { value: string; label?: string }[] } }>);
  const [fields, setFields] = useState<StudioFieldDraft[]>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchField = (idx: number, patch: Partial<StudioFieldDraft>) => {
    setFields((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };
  // Drag-and-drop reorder. `dragFromIdx` is the row being dragged;
  // `dragOverIdx` is the target landing slot. We render a thin
  // highlight under the target row so the drop intent is visible.
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const move = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setFields((prev) => {
      if (fromIdx < 0 || fromIdx >= prev.length) return prev;
      const next = [...prev];
      const [picked] = next.splice(fromIdx, 1);
      const clampedTo = Math.max(0, Math.min(toIdx, next.length));
      next.splice(clampedTo, 0, picked);
      return next;
    });
  };
  const remove = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };
  const add = () => {
    setFields((prev) => [...prev, { key: "", label: "", type: "TEXT" }]);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Detect duplicate keys before saving so the user sees the
      // problem here rather than after the round-trip.
      const built = draftToFields(fields);
      const seen = new Set<string>();
      for (const f of built) {
        if (seen.has(f.key)) {
          setError(`Duplicate field key: ${f.key}. Rename one of the columns.`);
          return;
        }
        seen.add(f.key);
      }
      const r = await fetch(`/api/studio/boards/${boardSlug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: built }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={() => { if (!saving) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Edit columns</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded hover:bg-surface-2 text-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-muted-2">
          Rename, retype, reorder, add or remove columns. Existing row data is keyed by the column&rsquo;s identifier, so renames keep data intact — removing a column drops that data.
        </p>

        <div className="space-y-2">
          {fields.map((f, idx) => (
            <div
              key={`${f.key}-${idx}`}
              draggable
              onDragStart={(e) => {
                setDragFromIdx(idx);
                e.dataTransfer.effectAllowed = "move";
                // Required for Firefox to actually start a drag.
                try { e.dataTransfer.setData("text/plain", String(idx)); } catch {}
              }}
              onDragOver={(e) => {
                if (dragFromIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverIdx !== idx) setDragOverIdx(idx);
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) {
                  if (dragOverIdx === idx) setDragOverIdx(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFromIdx !== null && dragFromIdx !== idx) move(dragFromIdx, idx);
                setDragFromIdx(null);
                setDragOverIdx(null);
              }}
              onDragEnd={() => {
                setDragFromIdx(null);
                setDragOverIdx(null);
              }}
              className={
                "rounded-lg border bg-surface p-2 space-y-2 transition-colors " +
                (dragFromIdx === idx ? "opacity-40 " : "") +
                (dragOverIdx === idx && dragFromIdx !== idx
                  ? "border-violet-400 ring-1 ring-violet-300/40"
                  : "border-border")
              }
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="cursor-grab active:cursor-grabbing p-1 text-muted-2 hover:text-foreground"
                  title="Drag to reorder"
                  aria-label="Drag handle"
                >
                  <GripVertical size={12} />
                </span>
                <input
                  type="text"
                  value={f.label}
                  onChange={(e) => patchField(idx, { label: e.target.value })}
                  placeholder="Column name"
                  className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs"
                />
                <select
                  value={f.type}
                  onChange={(e) => patchField(idx, { type: e.target.value as BoardField["fieldType"] })}
                  className="px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs"
                >
                  {(Object.keys(FIELD_TYPE_LABEL) as BoardField["fieldType"][]).map((t) => (
                    <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="p-1.5 rounded text-muted-2 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                  aria-label="Remove column"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {(f.type === "SELECT" || f.type === "MULTI_SELECT") && (
                <input
                  type="text"
                  value={f.optionsCsv ?? ""}
                  onChange={(e) => patchField(idx, { optionsCsv: e.target.value })}
                  placeholder="Choices, comma-separated (e.g. Todo, In progress, Done)"
                  className="w-full px-2.5 py-1 rounded-md border border-border bg-surface text-xs"
                />
              )}
              {f.key && (
                <p className="text-[10px] text-muted-2 font-mono px-1">
                  key: <span className="text-foreground">{f.key}</span>
                </p>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={add}
          className="text-xs text-violet-600 hover:text-violet-700 inline-flex items-center gap-1"
        >
          <Plus size={11} /> Add column
        </button>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300 inline-flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 rounded-md text-sm text-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save columns
          </button>
        </div>
      </div>
    </div>
  );
}
