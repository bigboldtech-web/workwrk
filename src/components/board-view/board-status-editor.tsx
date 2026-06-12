"use client";

// BoardStatusEditor — per-List status editor (backbone #1, step 3).
// Right slide-in panel (FieldShelf's shell) where the user can add,
// rename, recolor, regroup, reorder (drag), and delete statuses, then
// save the set via PATCH /api/boards/[id] { statuses }. "Reset to
// default" PATCHes { statuses: null } so the board falls back to the
// canonical trio. After a save we router.refresh() — the board page
// re-resolves getBoardStatuses server-side and every renderer updates.
//
// Renames keep the underlying `value` stable so existing Item.status
// strings stay matched; only brand-new statuses mint a new value.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Loader2, Plus, RotateCcw, X } from "lucide-react";
import type { StatusGroup, StatusOption } from "@/lib/board-items-shared";

// Same palette family the Space wizard presets draw from.
const COLOR_CHOICES = [
  "#94a3b8", "#71717A", "#6B7280", "#3b82f6", "#6366F1", "#06B6D4",
  "#10b981", "#F59E0B", "#F97316", "#EAB308", "#EF4444", "#EC4899",
  "#A855F7", "#14B8A6",
];

const GROUP_META: Record<StatusGroup, { label: string; blurb: string }> = {
  ACTIVE: { label: "Active", blurb: "Open work" },
  DONE: { label: "Done", blurb: "Completed" },
  CLOSED: { label: "Closed", blurb: "Cancelled / terminal" },
};

function mintValue(label: string, taken: Set<string>): string {
  const base = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "STATUS";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

interface BoardStatusEditorProps {
  boardId: string;
  open: boolean;
  canEdit: boolean;
  /** The board's current resolved set (from getBoardStatuses). */
  statuses: StatusOption[];
  onClose: () => void;
}

export function BoardStatusEditor({ boardId, open, canEdit, statuses, onClose }: BoardStatusEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<StatusOption[]>(() => statuses.map((s) => ({ ...s })));
  const [synced, setSynced] = useState(statuses);
  const [newLabel, setNewLabel] = useState("");
  const [newGroup, setNewGroup] = useState<StatusGroup>("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Re-seed the draft when the server set changes (e.g. after save +
  // refresh). Derived-state-during-render, matching the house pattern.
  if (synced !== statuses) {
    setSynced(statuses);
    setDraft(statuses.map((s) => ({ ...s })));
  }

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(synced),
    [draft, synced],
  );

  if (!open) return null;

  const patchRow = (idx: number, patch: Partial<StatusOption>) => {
    setDraft((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeRow = (idx: number) => {
    setDraft((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const addRow = () => {
    const label = newLabel.trim();
    if (!label) return;
    setDraft((prev) => [
      ...prev,
      {
        value: mintValue(label, new Set(prev.map((s) => s.value))),
        label,
        color: COLOR_CHOICES[prev.length % COLOR_CHOICES.length],
        group: newGroup,
      },
    ]);
    setNewLabel("");
  };

  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    setDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const save = async (payload: StatusOption[] | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statuses: payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save statuses");
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save statuses");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-full bg-white border-l border-zinc-200 shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-200 flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900">Task statuses</span>
          <span className="text-[11px] text-zinc-400">{draft.length} of 30</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? (
          <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900"><X className="w-3 h-3" /></button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-[11.5px] text-zinc-500 mb-3">
            Statuses are per-List. The group (Active / Done / Closed) drives completion
            logic — overdue flags, &ldquo;hide closed&rdquo;, and rollups. Drag to reorder.
          </p>

          <ul className="space-y-1.5">
            {draft.map((s, idx) => (
              <li
                key={s.value}
                draggable={canEdit}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragIdx(idx);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIdx(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null) moveRow(dragIdx, idx);
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 bg-white ${
                  dragOverIdx === idx && dragIdx !== null && dragIdx !== idx
                    ? "border-[var(--os-brand)]"
                    : "border-zinc-200"
                } ${dragIdx === idx ? "opacity-40" : ""}`}
              >
                <span className={`shrink-0 ${canEdit ? "cursor-grab text-zinc-300" : "text-zinc-200"}`} aria-hidden>
                  <GripVertical className="w-3.5 h-3.5" />
                </span>
                <ColorSwatch
                  color={s.color}
                  disabled={!canEdit}
                  onPick={(color) => patchRow(idx, { color })}
                />
                <input
                  type="text"
                  value={s.label}
                  disabled={!canEdit}
                  onChange={(e) => patchRow(idx, { label: e.target.value })}
                  className="flex-1 min-w-0 h-7 px-1.5 rounded text-[13px] bg-transparent outline-none hover:bg-zinc-50 focus:bg-white focus:ring-1 focus:ring-zinc-300 disabled:opacity-60"
                />
                <select
                  value={s.group}
                  disabled={!canEdit}
                  onChange={(e) => patchRow(idx, { group: e.target.value as StatusGroup })}
                  className="h-7 rounded border border-zinc-200 bg-white px-1 text-[11.5px] text-zinc-600 outline-none focus:border-zinc-400 disabled:opacity-60"
                  title={GROUP_META[s.group].blurb}
                >
                  {(Object.keys(GROUP_META) as StatusGroup[]).map((g) => (
                    <option key={g} value={g}>{GROUP_META[g].label}</option>
                  ))}
                </select>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={draft.length <= 1}
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                    aria-label={`Delete ${s.label}`}
                    title={draft.length <= 1 ? "A board needs at least one status" : "Delete status"}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {canEdit ? (
            <div className="mt-3 flex items-center gap-1.5">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addRow(); }}
                placeholder="New status name"
                className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-zinc-200 text-[13px] outline-none focus:border-zinc-400"
              />
              <select
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value as StatusGroup)}
                className="h-8 rounded-lg border border-zinc-200 bg-white px-1 text-[11.5px] text-zinc-600 outline-none focus:border-zinc-400"
              >
                {(Object.keys(GROUP_META) as StatusGroup[]).map((g) => (
                  <option key={g} value={g}>{GROUP_META[g].label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={addRow}
                disabled={!newLabel.trim() || draft.length >= 30}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                aria-label="Add status"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ) : null}

          <p className="mt-3 text-[11px] text-zinc-400">
            Items keeping a deleted status stay visible — they bucket under their raw
            value until re-statused.
          </p>
        </div>

        {canEdit ? (
          <div className="px-4 py-3 border-t border-zinc-200 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save(null)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              title="Use the workspace default statuses"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to default
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void save(draft)}
              disabled={busy || !dirty || draft.length === 0}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg text-[13px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function ColorSwatch({
  color,
  disabled,
  onPick,
}: {
  color: string;
  disabled?: boolean;
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="block w-5 h-5 rounded ring-1 ring-black/10 disabled:opacity-60"
        style={{ backgroundColor: color }}
        aria-label="Change color"
      />
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-1 z-40 grid grid-cols-7 gap-1 rounded-md border border-zinc-200 bg-white shadow-lg p-2 w-[172px]">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onPick(c); setOpen(false); }}
                className={`w-5 h-5 rounded ring-1 ring-black/10 ${c === color ? "outline outline-2 outline-zinc-900 outline-offset-1" : ""}`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
