"use client";

// BulkActionBar — the floating ClickUp bulk-action pill shown when one or more
// tasks are selected. Shared by the List (table) and Board (kanban) views so
// both get the same actions. Each action fans out over /api/items/[id] in the
// host view; this component is purely the UI + callbacks.

import { useEffect, useState } from "react";
import { ChevronDown, Flag, Archive, Trash2, X } from "lucide-react";
import type { StatusOption } from "@/lib/board-items-shared";

export function BulkActionBar({
  selectedCount,
  busy,
  statuses,
  priorities,
  onClear,
  onArchive,
  onStatus,
  onDueAt,
  onOwner,
  onPriority,
  onTrash,
}: {
  selectedCount: number;
  busy: boolean;
  statuses: StatusOption[];
  priorities: readonly { value: string; label: string; color?: string }[];
  onClear: () => void;
  onArchive: () => void;
  onStatus: (status: string) => void;
  onDueAt: (iso: string | null) => void;
  onOwner: (ownerId: string | null) => void;
  onPriority: (priority: string | null) => void;
  onTrash: () => void;
}) {
  if (selectedCount === 0) return null;
  // NB: /15 alpha on purpose — a globals.css guardrail remaps any literal
  // "bg-white/10" class to black-alpha in light mode, which killed the hover.
  const pill = "list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] text-zinc-100 hover:bg-white/15 hover:text-white transition-colors select-none";
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-full bg-zinc-900 text-white pl-1.5 pr-2 py-1.5 shadow-2xl shadow-zinc-950/30 ring-1 ring-white/15">
      <span className="inline-flex items-center h-7 px-3 rounded-full bg-[var(--os-brand)] text-[13px] font-semibold tabular-nums text-white">
        {selectedCount} selected
      </span>
      <span className="w-px h-5 bg-white/15" aria-hidden />
      <details className="relative">
        <summary className={pill}>
          Set status
          <ChevronDown className="w-3 h-3 opacity-60" />
        </summary>
        <div className="absolute left-0 bottom-full mb-2 w-[190px] rounded-xl border border-zinc-200 bg-white shadow-2xl py-1.5 text-zinc-900">
          {statuses.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onStatus(o.value)}
              disabled={busy}
              className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[13.5px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} aria-hidden />
              {o.label}
            </button>
          ))}
        </div>
      </details>
      <BulkOwner onSet={onOwner} busy={busy} />
      <BulkDueDate onSet={onDueAt} busy={busy} />
      <details className="relative">
        <summary className={pill}>
          <Flag className="w-3 h-3" />
          Priority
          <ChevronDown className="w-3 h-3 opacity-60" />
        </summary>
        <div className="absolute left-0 bottom-full mb-2 w-[190px] rounded-xl border border-zinc-200 bg-white shadow-2xl py-1.5 text-zinc-900">
          {priorities.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onPriority(p.value)}
              disabled={busy}
              className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[13.5px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              <Flag className="w-3 h-3 shrink-0" style={{ color: p.color ?? "#a1a1aa" }} />
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => onPriority(null)} disabled={busy} className="w-full text-left mt-1 px-3 py-1.5 text-[13.5px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50 transition-colors border-t border-zinc-100">Clear priority</button>
        </div>
      </details>
      <span className="w-px h-5 bg-white/15" aria-hidden />
      <button type="button" onClick={onArchive} disabled={busy} className={pill}>
        <Archive className="w-3 h-3" />
        Archive
      </button>
      <button type="button" onClick={onTrash} disabled={busy} className="inline-flex items-center justify-center w-7 h-7 rounded-full text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors" aria-label="Delete" title="Delete (move to Trash)">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <span className="w-px h-5 bg-white/15" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-zinc-300 hover:bg-white/15 hover:text-white transition-colors"
        aria-label="Clear selection"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function BulkDueDate({ onSet, busy }: { onSet: (iso: string | null) => void; busy: boolean }) {
  const [value, setValue] = useState("");
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] text-zinc-100 hover:bg-white/15 hover:text-white transition-colors select-none">
        Set due date
        <ChevronDown className="w-3 h-3 opacity-60" />
      </summary>
      <div className="absolute left-0 bottom-full mb-2 w-[260px] rounded-xl border border-zinc-200 bg-white shadow-2xl p-3 text-zinc-900">
        <label className="text-[12px] font-medium text-zinc-500 mb-1.5 block">Due date</label>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full h-8 px-2.5 border border-zinc-200 rounded-md text-[14px] text-zinc-800 focus:outline-none focus:border-[var(--os-brand)]"
        />
        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            type="button"
            disabled={busy || !value}
            onClick={() => onSet(`${value}T00:00:00.000Z`)}
            className="h-7 px-3.5 rounded-md text-[13px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50 transition-colors"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setValue(""); onSet(null); }}
            className="h-7 px-3 rounded-md text-[13px] text-zinc-600 hover:bg-zinc-100 transition-colors"
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
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] text-zinc-100 hover:bg-white/15 hover:text-white transition-colors select-none">
        Set owner
        <ChevronDown className="w-3 h-3 opacity-60" />
      </summary>
      <div className="absolute left-0 bottom-full mb-2 w-[240px] max-h-[280px] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl py-1.5 text-zinc-900">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(null)}
          className="w-full text-left flex items-center gap-2.5 mb-1 px-3 py-1.5 text-[13.5px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50 transition-colors border-b border-zinc-100"
        >
          Unassign
        </button>
        {users === null ? (
          <div className="px-3 py-4 text-[13px] text-zinc-400">Loading…</div>
        ) : users.length === 0 ? (
          <div className="px-3 py-4 text-[13px] text-zinc-400">No users</div>
        ) : (
          users.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={busy}
              onClick={() => onSet(u.id)}
              className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[13.5px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-zinc-200 text-[11px] font-medium text-zinc-600 shrink-0 overflow-hidden">
                {u.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? ""}`.toUpperCase()
                )}
              </span>
              <span className="truncate">{`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unnamed"}</span>
            </button>
          ))
        )}
      </div>
    </details>
  );
}
