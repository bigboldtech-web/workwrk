"use client";

// BoardFilterBar — the functional replacement for the board page's
// previously-inert filter chrome. One bar, five facets + search, applied
// by BoardCanvas to whichever renderer is active (TABLE / KANBAN /
// CALENDAR / GANTT) and persisted per-view in View.config.filters.
//
// Facet options are derived from the items themselves (owners and tags
// that actually appear on this board) — no extra fetches, and the menus
// never offer a filter that would return zero rows at open time.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Flag, Search, Tag as TagIcon, Users, X } from "lucide-react";
import {
  DEFAULT_STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  type BoardItemRow,
  type ItemTag,
} from "@/lib/board-items-shared";
import { PersonAvatar, type PersonRef } from "./assignee-picker";

export interface BoardFilters {
  search: string;
  statuses: string[];
  owners: string[];      // user ids; "__unassigned__" sentinel allowed
  priorities: string[];
  tagIds: string[];
  hideDone: boolean;
}

export const EMPTY_FILTERS: BoardFilters = {
  search: "",
  statuses: [],
  owners: [],
  priorities: [],
  tagIds: [],
  hideDone: false,
};

export function parseFilters(raw: unknown): BoardFilters {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    search: typeof r.search === "string" ? r.search : "",
    statuses: arr(r.statuses),
    owners: arr(r.owners),
    priorities: arr(r.priorities),
    tagIds: arr(r.tagIds),
    hideDone: r.hideDone === true,
  };
}

export function filtersActive(f: BoardFilters): boolean {
  return !!(f.search.trim() || f.statuses.length || f.owners.length || f.priorities.length || f.tagIds.length || f.hideDone);
}

/**
 * Apply filters to the flat item list. An item survives when it matches
 * every active facet; ancestors of surviving subtasks are kept too so
 * the table can still render the parent chain.
 */
export function applyFilters(items: BoardItemRow[], f: BoardFilters): BoardItemRow[] {
  if (!filtersActive(f)) return items;
  const q = f.search.trim().toLowerCase();
  const statusSet = new Set(f.statuses);
  const ownerSet = new Set(f.owners);
  const prioritySet = new Set(f.priorities);
  const tagSet = new Set(f.tagIds);

  const matches = (it: BoardItemRow): boolean => {
    if (f.hideDone && it.status === "DONE") return false;
    if (statusSet.size && !statusSet.has(it.status ?? "")) return false;
    if (ownerSet.size) {
      const key = it.ownerId ?? "__unassigned__";
      if (!ownerSet.has(key)) return false;
    }
    if (prioritySet.size && !prioritySet.has(it.priority ?? "")) return false;
    if (tagSet.size && !(it.tags ?? []).some((t) => tagSet.has(t.id))) return false;
    if (q) {
      const owner = it.owner ? `${it.owner.firstName ?? ""} ${it.owner.lastName ?? ""}`.toLowerCase() : "";
      const tagNames = (it.tags ?? []).map((t) => t.name.toLowerCase()).join(" ");
      const desc = typeof it.metadata?.description === "string" ? (it.metadata.description as string).toLowerCase() : "";
      const hay = `${it.title.toLowerCase()} ${owner} ${tagNames} ${desc}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const byId = new Map(items.map((it) => [it.id, it] as const));
  const keep = new Set<string>();
  for (const it of items) {
    if (!matches(it)) continue;
    keep.add(it.id);
    // Walk up so a matching subtask doesn't get orphaned.
    let parentId = it.parentItemId ?? null;
    while (parentId && !keep.has(parentId)) {
      keep.add(parentId);
      parentId = byId.get(parentId)?.parentItemId ?? null;
    }
  }
  return items.filter((it) => keep.has(it.id));
}

interface BoardFilterBarProps {
  items: BoardItemRow[];
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
}

export function BoardFilterBar({ items, filters, onChange }: BoardFilterBarProps) {
  // Facet options present on this board.
  const owners = useMemo(() => {
    const map = new Map<string, PersonRef>();
    let hasUnassigned = false;
    for (const it of items) {
      if (it.owner) map.set(it.owner.id, { ...it.owner, email: null });
      else hasUnassigned = true;
    }
    const list = Array.from(map.values()).sort((a, b) =>
      `${a.firstName ?? ""} ${a.lastName ?? ""}`.localeCompare(`${b.firstName ?? ""} ${b.lastName ?? ""}`),
    );
    return { list, hasUnassigned };
  }, [items]);

  const tags = useMemo(() => {
    const map = new Map<string, ItemTag>();
    for (const it of items) for (const t of it.tags ?? []) map.set(t.id, t);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const toggle = (key: "statuses" | "owners" | "priorities" | "tagIds", value: string) => {
    const cur = filters[key];
    onChange({
      ...filters,
      [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value],
    });
  };

  const active = filtersActive(filters);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SearchBox value={filters.search} onChange={(search) => onChange({ ...filters, search })} />

      <FacetMenu
        label="Status"
        Icon={ChevronDown}
        activeCount={filters.statuses.length}
        render={() => (
          <>
            {DEFAULT_STATUS_OPTIONS.map((o) => (
              <FacetRow
                key={o.value}
                active={filters.statuses.includes(o.value)}
                onClick={() => toggle("statuses", o.value)}
              >
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: `${o.color}22`, color: o.color }}
                >
                  {o.label}
                </span>
              </FacetRow>
            ))}
          </>
        )}
      />

      <FacetMenu
        label="Assignee"
        Icon={Users}
        activeCount={filters.owners.length}
        render={() => (
          <>
            {owners.hasUnassigned ? (
              <FacetRow
                active={filters.owners.includes("__unassigned__")}
                onClick={() => toggle("owners", "__unassigned__")}
              >
                <span className="text-[12.5px] text-zinc-500">Unassigned</span>
              </FacetRow>
            ) : null}
            {owners.list.length === 0 && !owners.hasUnassigned ? (
              <div className="px-3 py-2 text-[11.5px] text-zinc-400">No assignees yet</div>
            ) : (
              owners.list.map((p) => (
                <FacetRow key={p.id} active={filters.owners.includes(p.id)} onClick={() => toggle("owners", p.id)}>
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <PersonAvatar person={p} size={20} />
                    <span className="text-[12.5px] truncate">{`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}</span>
                  </span>
                </FacetRow>
              ))
            )}
          </>
        )}
      />

      <FacetMenu
        label="Priority"
        Icon={Flag}
        activeCount={filters.priorities.length}
        render={() => (
          <>
            {PRIORITY_OPTIONS.map((p) => (
              <FacetRow
                key={p.value}
                active={filters.priorities.includes(p.value)}
                onClick={() => toggle("priorities", p.value)}
              >
                <span className="inline-flex items-center gap-2 text-[12.5px]">
                  <Flag className="w-3.5 h-3.5" style={{ color: p.color }} fill={p.color} />
                  {p.label}
                </span>
              </FacetRow>
            ))}
          </>
        )}
      />

      {tags.length > 0 ? (
        <FacetMenu
          label="Tags"
          Icon={TagIcon}
          activeCount={filters.tagIds.length}
          render={() => (
            <>
              {tags.map((t) => {
                const color = t.color || "#94a3b8";
                return (
                  <FacetRow key={t.id} active={filters.tagIds.includes(t.id)} onClick={() => toggle("tagIds", t.id)}>
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: `${color}22`, color }}
                    >
                      {t.name}
                    </span>
                  </FacetRow>
                );
              })}
            </>
          )}
        />
      ) : null}

      <button
        type="button"
        onClick={() => onChange({ ...filters, hideDone: !filters.hideDone })}
        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11.5px] transition-colors ${
          filters.hideDone
            ? "bg-zinc-900 text-white border-zinc-900"
            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
        title={filters.hideDone ? "Showing open items only" : "Hide done items"}
      >
        <CheckCircle2 className="w-3 h-3" />
        {filters.hideDone ? "Open only" : "Closed"}
      </button>

      {active ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      ) : null}
    </div>
  );
}

// ── Search box — collapsed icon that expands to an input ──────────

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        aria-label="Search items"
      >
        <Search className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200 bg-white">
      <Search className="w-3 h-3 text-zinc-400 shrink-0" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); setOpen(false); } }}
        placeholder="Search tasks…"
        className="w-[150px] text-[12px] bg-transparent outline-none placeholder:text-zinc-400"
      />
      <button
        type="button"
        onClick={() => { onChange(""); setOpen(false); }}
        className="text-zinc-400 hover:text-zinc-700"
        aria-label="Clear search"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Facet menu primitives ──────────────────────────────────────────

function FacetMenu({
  label,
  Icon,
  activeCount,
  render,
}: {
  label: string;
  Icon: typeof Users;
  activeCount: number;
  render: () => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11.5px] transition-colors ${
          activeCount > 0
            ? "bg-zinc-900 text-white border-zinc-900"
            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
      >
        <Icon className="w-3 h-3" />
        {label}
        {activeCount > 0 ? <span className="tabular-nums">· {activeCount}</span> : null}
      </button>
      {open ? (
        <div className="absolute z-40 mt-1 left-0 min-w-[200px] max-h-[280px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1">
          {render()}
        </div>
      ) : null}
    </div>
  );
}

function FacetRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-50"
    >
      <span className="flex-1 min-w-0">{children}</span>
      {active ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)] shrink-0" /> : null}
    </button>
  );
}
