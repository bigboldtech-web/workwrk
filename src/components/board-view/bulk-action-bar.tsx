"use client";

// BulkActionBar: the bar that appears when tasks are selected.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, /boards/[slug]:
// "Bulk bar (white, bottom-centre, 48px) … Due date writes local midnight
// through the same helper the calendar uses (audit Medium #24, critic #13); the
// bar calls `PATCH /api/items/bulk` instead of one request per task."
//
// WHAT CHANGED AND WHY IT MATTERED:
//   * it was a DARK pill, the only dark surface in the product;
//   * "Set due date" wrote `${value}T00:00:00.000Z`, which is UTC midnight, so
//     anyone west of Greenwich set forty tasks to the PREVIOUS day and anyone
//     far enough east set them to the next. It writes local midnight now,
//     through `localDayIso`, the same helper the calendar drag uses;
//   * every action fanned out one `PATCH /api/items/[id]` per selected row in
//     the host view. The host now posts one request (`/api/items/bulk`), which
//     also reports which rows the viewer could not edit instead of silently
//     doing nothing to them.
// The menus are still `<details>` (audit Low #28 asks for `Picker`); that swap
// belongs with the toolbar Picker work and is not done here.

import { useEffect, useState } from "react";
import { ChevronDown, Flag, Archive, Trash2, X } from "lucide-react";
import type { StatusOption } from "@/lib/board-items-shared";
import { localDayIso } from "@/lib/item-date";
import { SkeletonLines } from "@/components/ui/skeleton";

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
  boardId,
}: {
  selectedCount: number;
  busy: boolean;
  /** Scopes "Set owner" to the people who can reach this List. */
  boardId?: string | null;
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
  const pill = "list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm text-ink-2 hover:bg-hover hover:text-ink transition-colors select-none";
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 inline-flex h-12 items-center gap-1 rounded-xl border border-line bg-raised ps-2 pe-2"
      style={{ boxShadow: "var(--os-shadow-pop)" }}
    >
      <span className="inline-flex items-center h-7 px-2 text-sm font-medium tabular-nums text-ink">
        {selectedCount} selected
      </span>
      <span className="w-px h-5 bg-line" aria-hidden />
      <details className="relative">
        <summary className={pill}>
          Set status
          <ChevronDown className="w-3 h-3 opacity-60" />
        </summary>
        <div className="absolute left-0 bottom-full mb-2 w-[190px] rounded-xl border border-line bg-raised py-1.5 text-ink" style={{ boxShadow: "var(--os-shadow-pop)" }}>
          {statuses.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onStatus(o.value)}
              disabled={busy}
              className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-base text-ink hover:bg-hover disabled:opacity-50 transition-colors"
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} aria-hidden />
              {o.label}
            </button>
          ))}
        </div>
      </details>
      <BulkOwner onSet={onOwner} busy={busy} boardId={boardId} />
      <BulkDueDate onSet={onDueAt} busy={busy} />
      <details className="relative">
        <summary className={pill}>
          <Flag className="w-3 h-3" />
          Priority
          <ChevronDown className="w-3 h-3 opacity-60" />
        </summary>
        <div className="absolute left-0 bottom-full mb-2 w-[190px] rounded-xl border border-line bg-raised py-1.5 text-ink" style={{ boxShadow: "var(--os-shadow-pop)" }}>
          {priorities.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onPriority(p.value)}
              disabled={busy}
              className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-base text-ink hover:bg-hover disabled:opacity-50 transition-colors"
            >
              <Flag className="w-3 h-3 shrink-0" style={{ color: p.color ?? "#a1a1aa" }} />
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => onPriority(null)} disabled={busy} className="w-full text-left mt-1 px-3 py-1.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50 transition-colors border-t border-line-soft">Clear priority</button>
        </div>
      </details>
      <span className="w-px h-5 bg-line" aria-hidden />
      <button type="button" onClick={onArchive} disabled={busy} className={pill}>
        <Archive className="w-3 h-3" />
        Archive
      </button>
      <button type="button" onClick={onTrash} disabled={busy} className="inline-flex items-center justify-center w-7 h-7 rounded-full text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors" aria-label="Delete" title="Delete (move to Trash)">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <span className="w-px h-5 bg-line" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:bg-hover hover:text-ink transition-colors"
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
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm text-ink-2 hover:bg-hover hover:text-ink transition-colors select-none">
        Set due date
        <ChevronDown className="w-3 h-3 opacity-60" />
      </summary>
      <div className="absolute left-0 bottom-full mb-2 w-[260px] rounded-xl border border-line bg-raised p-3 text-ink" style={{ boxShadow: "var(--os-shadow-pop)" }}>
        <label className="text-xs font-medium text-ink-2 mb-1.5 block">Due date</label>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full h-8 px-2.5 border border-line rounded-md text-base text-ink focus:outline-none focus:border-[var(--os-brand)]"
        />
        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            type="button"
            disabled={busy || !value}
            // audit Medium #24 / critic #13: a date picked in a grid means
            // midnight of that day WHERE THE VIEWER IS, not UTC.
            onClick={() => onSet(localDayIso(value))}
            className="h-7 px-3.5 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50 transition-colors"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setValue(""); onSet(null); }}
            className="h-7 px-3 rounded-md text-sm text-ink-2 hover:bg-hover transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </details>
  );
}

interface BulkOwnerOption { id: string; firstName: string; lastName: string; avatar: string | null }

function BulkOwner({ onSet, busy, boardId }: { onSet: (ownerId: string | null) => void; busy: boolean; boardId?: string | null }) {
  const [users, setUsers] = useState<BulkOwnerOption[] | null>(null);
  const [open, setOpen] = useState(false);
  // Lazy-fetch the candidates when the menu is first opened. Scoped to the
  // LIST when we know it: /api/users?scope=all clamps any caller below the
  // org-wide alignment levels to their own report tree, which is the very bug
  // this change set exists for ("it only show me while i try to assign
  // people"). The board roster answers who can actually be given this work.
  useEffect(() => {
    if (!open || users !== null) return;
    let active = true;
    const url = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/assignable?limit=100`
      : "/api/users?scope=all&limit=100";
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => { if (active) setUsers(Array.isArray(d?.data) ? d.data : []); })
      .catch(() => { if (active) setUsers([]); });
    return () => { active = false; };
  }, [open, users, boardId]);
  return (
    <details className="relative" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm text-ink-2 hover:bg-hover hover:text-ink transition-colors select-none">
        Set owner
        <ChevronDown className="w-3 h-3 opacity-60" />
      </summary>
      <div className="absolute left-0 bottom-full mb-2 w-[240px] max-h-[280px] overflow-y-auto rounded-xl border border-line bg-raised py-1.5 text-ink" style={{ boxShadow: "var(--os-shadow-pop)" }}>
        {/* "Clear assignees", not "Unassign". A task can carry several people
            and this row empties the set; the old word promised to remove ONE
            person and, because an ownerId-only patch merely drops the outgoing
            owner and promotes the next assignee, it actually handed the task
            to somebody else. The host turns this into an explicit
            `assigneeIds: []`, which is the one write that says "nobody". */}
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(null)}
          className="w-full text-left flex items-center gap-2.5 mb-1 px-3 py-1.5 text-base text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50 transition-colors border-b border-line-soft"
        >
          Clear assignees
        </button>
        {users === null ? (
          <div className="px-3 py-4"><SkeletonLines lines={3} /></div>
        ) : users.length === 0 ? (
          <div className="px-3 py-4 text-sm text-ink-3">Nobody to assign</div>
        ) : (
          users.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={busy}
              onClick={() => onSet(u.id)}
              className="w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-base text-ink hover:bg-hover disabled:opacity-50 transition-colors"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-active text-xs font-medium text-ink-2 shrink-0 overflow-hidden">
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
