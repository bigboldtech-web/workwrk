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
import { Check, CheckCircle2, ChevronDown, Flag, ListFilter, Search, Shapes, Tag as TagIcon, Users, X } from "lucide-react";
import {
  PRIORITY_OPTIONS,
  isDoneStatus,
  type BoardItemRow,
  type ItemTag,
  type StatusOption,
} from "@/lib/board-items-shared";
import { PersonAvatar, type PersonRef } from "./assignee-picker";
import { useItemTypes } from "./use-item-types";
import { itemTypeIcon } from "@/lib/item-type-icons";

export interface BoardFilters {
  search: string;
  statuses: string[];
  owners: string[];      // user ids; "__unassigned__" sentinel allowed
  priorities: string[];
  tagIds: string[];
  itemTypes: string[];   // ItemType ids; "__none__" = untyped (default)
  hideDone: boolean;
}

export const EMPTY_FILTERS: BoardFilters = {
  search: "",
  statuses: [],
  owners: [],
  priorities: [],
  tagIds: [],
  itemTypes: [],
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
    itemTypes: arr(r.itemTypes),
    hideDone: r.hideDone === true,
  };
}

export function filtersActive(f: BoardFilters): boolean {
  return !!(f.search.trim() || f.statuses.length || f.owners.length || f.priorities.length || f.tagIds.length || f.itemTypes.length || f.hideDone);
}

/**
 * Apply filters to the flat item list. An item survives when it matches
 * every active facet; ancestors of surviving subtasks are kept too so
 * the table can still render the parent chain. `statuses` is the
 * board's own set — hideDone hides every DONE/CLOSED-group status, not
 * just the literal "DONE".
 */
export function applyFilters(items: BoardItemRow[], f: BoardFilters, statuses: StatusOption[]): BoardItemRow[] {
  if (!filtersActive(f)) return items;
  const q = f.search.trim().toLowerCase();
  const statusSet = new Set(f.statuses);
  const ownerSet = new Set(f.owners);
  const prioritySet = new Set(f.priorities);
  const typeSet = new Set(f.itemTypes);
  const tagSet = new Set(f.tagIds);

  const matches = (it: BoardItemRow): boolean => {
    if (f.hideDone && isDoneStatus(statuses, it.status)) return false;
    if (statusSet.size && !statusSet.has(it.status ?? "")) return false;
    if (ownerSet.size) {
      const key = it.ownerId ?? "__unassigned__";
      if (!ownerSet.has(key)) return false;
    }
    if (prioritySet.size && !prioritySet.has(it.priority ?? "")) return false;
    if (typeSet.size && !typeSet.has(it.itemTypeId ?? "__none__")) return false;
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
  /** The board's own status set — drives the Status facet options. */
  statuses: StatusOption[];
  onChange: (next: BoardFilters) => void;
}

export function BoardFilterBar({ items, filters, statuses, onChange }: BoardFilterBarProps) {
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

  // Item types present on this board (plus an "Untyped" bucket if any
  // row has no itemTypeId), resolved to names via the shared cache.
  const { byId: typeMap } = useItemTypes();
  const itemTypeFacet = useMemo(() => {
    const ids = new Set<string>();
    let hasNone = false;
    for (const it of items) {
      if (it.itemTypeId) ids.add(it.itemTypeId);
      else hasNone = true;
    }
    const list = Array.from(ids)
      .map((id) => typeMap.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .sort((a, b) => a.singular.localeCompare(b.singular));
    return { list, hasNone };
  }, [items, typeMap]);

  const toggle = (key: "statuses" | "owners" | "priorities" | "tagIds" | "itemTypes", value: string) => {
    const cur = filters[key];
    onChange({
      ...filters,
      [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value],
    });
  };

  const active = filtersActive(filters);
  // Number of active facet selections (drives the Filter funnel badge).
  const facetCount = filters.statuses.length + filters.owners.length + filters.priorities.length + filters.itemTypes.length + filters.tagIds.length + (filters.hideDone ? 1 : 0);
  // ClickUp keeps the toolbar concise: the facets live behind a Filter funnel,
  // revealed on click (or whenever a facet is already active).
  const [showFacets, setShowFacets] = useState(false);
  const facetsOpen = showFacets || facetCount > 0;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SearchBox value={filters.search} onChange={(search) => onChange({ ...filters, search })} />

      <button
        type="button"
        onClick={() => setShowFacets((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[12.5px] transition-colors ${
          facetsOpen
            ? "bg-[color-mix(in_srgb,var(--os-brand)_12%,transparent)] text-[var(--os-brand)] border-[var(--os-brand)] font-medium"
            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
        title="Filter"
      >
        <ListFilter className="w-3.5 h-3.5" />
        Filter
        {facetCount > 0 ? <span className="tabular-nums">· {facetCount}</span> : null}
      </button>

      {facetsOpen ? (
      <>
      <FacetMenu
        label="Status"
        Icon={ChevronDown}
        activeCount={filters.statuses.length}
        render={() => (
          <>
            {statuses.map((o) => (
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

      {itemTypeFacet.list.length > 0 || itemTypeFacet.hasNone ? (
        <FacetMenu
          label="Type"
          Icon={Shapes}
          activeCount={filters.itemTypes.length}
          render={() => (
            <>
              {itemTypeFacet.list.map((t) => {
                const Icon = itemTypeIcon(t.icon);
                return (
                  <FacetRow key={t.id} active={filters.itemTypes.includes(t.id)} onClick={() => toggle("itemTypes", t.id)}>
                    <span className="inline-flex items-center gap-2 text-[12.5px]">
                      <Icon className="w-3.5 h-3.5 text-zinc-400" />
                      {t.singular}
                    </span>
                  </FacetRow>
                );
              })}
              {itemTypeFacet.hasNone ? (
                <FacetRow active={filters.itemTypes.includes("__none__")} onClick={() => toggle("itemTypes", "__none__")}>
                  <span className="text-[12.5px] text-zinc-500">Untyped</span>
                </FacetRow>
              ) : null}
            </>
          )}
        />
      ) : null}

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
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[12.5px] transition-colors ${
          filters.hideDone
            ? "bg-[color-mix(in_srgb,var(--os-brand)_12%,transparent)] text-[var(--os-brand)] border-[var(--os-brand)] font-medium"
            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
        title={filters.hideDone ? "Showing open items only" : "Hide done items"}
      >
        <CheckCircle2 className="w-3 h-3" />
        {filters.hideDone ? "Open only" : "Closed"}
      </button>
      </>
      ) : null}

      {active ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-[12.5px] text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
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
        className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        aria-label="Search items"
      >
        <Search className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md border border-zinc-200 bg-white">
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
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[12.5px] transition-colors ${
          activeCount > 0
            ? "bg-[color-mix(in_srgb,var(--os-brand)_12%,transparent)] text-[var(--os-brand)] border-[var(--os-brand)] font-medium"
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
