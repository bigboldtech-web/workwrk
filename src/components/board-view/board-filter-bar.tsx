"use client";

// Board filters — the rule-based Where/<field>/<operator>/<value> model
// (ClickUp parity, 2026-08-06) that replaced the earlier fixed-facet
// bar. BoardCanvas owns the state, persists it per-view in
// View.config.filters, and applies it to every item-driven renderer;
// the FilterMenu here is the one panel every board toolbar mounts.
//
// Saved filter sets live alongside the live rules in
// View.config.savedFilters ([{ name, connector, rules }]).

import { useEffect, useMemo, useRef, useState } from "react";
import { ListFilter, Plus, Trash2, X } from "lucide-react";
import {
  PRIORITY_OPTIONS,
  isDoneStatus,
  type BoardItemRow,
  type ItemTag,
  type StatusOption,
} from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import type { PersonRef } from "./assignee-picker";
import { useItemTypes } from "./use-item-types";
import { Switch } from "@/components/ui/switch";
import { MorePortal } from "@/components/layout/os/more-portal";

// ── Model ──────────────────────────────────────────────────────────

export type FilterOperator =
  | "is"
  | "isNot"
  | "isSet"
  | "isNotSet"
  | "before"
  | "after"
  | "on"
  | "contains";

const ALL_OPERATORS: readonly FilterOperator[] = ["is", "isNot", "isSet", "isNotSet", "before", "after", "on", "contains"];

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  is: "is",
  isNot: "is not",
  isSet: "is set",
  isNotSet: "is not set",
  before: "is before",
  after: "is after",
  on: "is on",
  contains: "contains",
};

/** Built-in filterable fields. Any other `field` string is treated as a
 *  custom-field key and matched against Item.metadata[field]. */
export type BuiltinFilterField = "status" | "assignee" | "priority" | "due" | "tags" | "title" | "type";

export interface FilterRule {
  /** Client-only row identity (regenerated on parse — never persisted). */
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface BoardFilters {
  search: string;
  connector: "AND" | "OR";
  rules: FilterRule[];
  hideDone: boolean;
}

export interface SavedFilterRule {
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface SavedFilter {
  name: string;
  connector: "AND" | "OR";
  rules: SavedFilterRule[];
}

export const EMPTY_FILTERS: BoardFilters = {
  search: "",
  connector: "AND",
  rules: [],
  hideDone: false,
};

let _ruleSeq = 0;
export function newRuleId(): string {
  _ruleSeq += 1;
  return `rule-${_ruleSeq}`;
}

function mkRule(field: string, operator: FilterOperator, value: string): FilterRule {
  return { id: newRuleId(), field, operator, value };
}

function isOperator(v: unknown): v is FilterOperator {
  return typeof v === "string" && (ALL_OPERATORS as readonly string[]).includes(v);
}

/** Operators each field supports (drives the operator dropdown AND is
 *  the source of truth for what applyFilters will honor). */
export function operatorsFor(field: string): FilterOperator[] {
  switch (field) {
    case "due":
      return ["on", "before", "after", "isSet", "isNotSet"];
    case "title":
      return ["contains"];
    case "status":
    case "assignee":
    case "priority":
    case "tags":
    case "type":
      return ["is", "isNot", "isSet", "isNotSet"];
    default:
      // Custom fields — free-text semantics against metadata[field].
      return ["contains", "is", "isNot", "isSet", "isNotSet"];
  }
}

/**
 * Parse View.config.filters into the current model. Backward-compatible:
 * the pre-2026-08 facet shape ({ statuses, owners, priorities, tagIds,
 * itemTypes, hideDone, search }) is migrated into equivalent rules —
 * one rule per selection ("__unassigned__" / "__none__" sentinels become
 * "is not set"). Selections within one facet were OR'd, facets AND'd;
 * a flat connector can't express both, so multi-facet legacy configs
 * migrate with AND (single-facet ones keep exact OR semantics).
 */
export function parseFilters(raw: unknown): BoardFilters {
  const r = (raw ?? {}) as Record<string, unknown>;
  const search = typeof r.search === "string" ? r.search : "";
  const hideDone = r.hideDone === true;

  if (Array.isArray(r.rules)) {
    const rules: FilterRule[] = [];
    for (const entry of r.rules) {
      if (!entry || typeof entry !== "object") continue;
      const o = entry as Record<string, unknown>;
      if (typeof o.field !== "string" || !o.field) continue;
      rules.push(mkRule(o.field, isOperator(o.operator) ? o.operator : "is", typeof o.value === "string" ? o.value : ""));
    }
    return { search, connector: r.connector === "OR" ? "OR" : "AND", rules, hideDone };
  }

  // Legacy facet shape → migration shim.
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const rules: FilterRule[] = [];
  for (const v of arr(r.statuses)) rules.push(mkRule("status", "is", v));
  for (const v of arr(r.owners)) rules.push(v === "__unassigned__" ? mkRule("assignee", "isNotSet", "") : mkRule("assignee", "is", v));
  for (const v of arr(r.priorities)) rules.push(mkRule("priority", "is", v));
  for (const v of arr(r.tagIds)) rules.push(mkRule("tags", "is", v));
  for (const v of arr(r.itemTypes)) rules.push(v === "__none__" ? mkRule("type", "isNotSet", "") : mkRule("type", "is", v));
  const facets = new Set(rules.map((x) => x.field));
  return { search, connector: rules.length > 1 && facets.size === 1 ? "OR" : "AND", rules, hideDone };
}

/** The persistable shape for View.config.filters (rule ids stripped). */
export function serializeFilters(f: BoardFilters): Record<string, unknown> {
  return {
    search: f.search,
    connector: f.connector,
    rules: f.rules.map(({ field, operator, value }) => ({ field, operator, value })),
    hideDone: f.hideDone,
  };
}

export function parseSavedFilters(raw: unknown): SavedFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedFilter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) continue;
    const rules: SavedFilterRule[] = [];
    for (const ruleRaw of Array.isArray(o.rules) ? o.rules : []) {
      if (!ruleRaw || typeof ruleRaw !== "object") continue;
      const ro = ruleRaw as Record<string, unknown>;
      if (typeof ro.field !== "string" || !ro.field) continue;
      rules.push({ field: ro.field, operator: isOperator(ro.operator) ? ro.operator : "is", value: typeof ro.value === "string" ? ro.value : "" });
    }
    out.push({ name: o.name, connector: o.connector === "OR" ? "OR" : "AND", rules });
  }
  return out;
}

/** A rule participates in filtering once it's complete: set/not-set
 *  operators always are; the rest need a value. */
export function ruleActive(rule: FilterRule): boolean {
  if (rule.operator === "isSet" || rule.operator === "isNotSet") return true;
  return rule.value.trim() !== "";
}

export function activeRuleCount(f: BoardFilters): number {
  return f.rules.filter(ruleActive).length;
}

export function filtersActive(f: BoardFilters): boolean {
  return !!(f.search.trim() || activeRuleCount(f) || f.hideDone);
}

// ── Matching ───────────────────────────────────────────────────────

function scalarFor(row: BoardItemRow, field: string): string {
  switch (field) {
    case "status": return row.status ?? "";
    case "assignee": return row.ownerId ?? "";
    case "priority": return row.priority ?? "";
    case "type": return row.itemTypeId ?? "";
    case "title": return row.title;
    default: {
      const v = row.metadata?.[field];
      return v == null ? "" : String(v);
    }
  }
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function matchesRule(row: BoardItemRow, rule: FilterRule): boolean {
  // Due date — date-only comparisons against the yyyy-mm-dd value.
  if (rule.field === "due") {
    const due = row.dueAt ? new Date(row.dueAt) : null;
    if (rule.operator === "isSet") return !!due;
    if (rule.operator === "isNotSet") return !due;
    if (!due) return false;
    const target = new Date(`${rule.value}T00:00:00`);
    if (Number.isNaN(target.getTime())) return true; // unparsable value → don't filter
    if (rule.operator === "on") return sameLocalDay(due, target);
    if (rule.operator === "before") return due.getTime() < target.getTime();
    if (rule.operator === "after") {
      const endOfDay = new Date(target); endOfDay.setHours(23, 59, 59, 999);
      return due.getTime() > endOfDay.getTime();
    }
    return true;
  }

  // Tags — membership in the row's tag list.
  if (rule.field === "tags") {
    const tags = row.tags ?? [];
    switch (rule.operator) {
      case "is": return tags.some((t) => t.id === rule.value);
      case "isNot": return !tags.some((t) => t.id === rule.value);
      case "isSet": return tags.length > 0;
      case "isNotSet": return tags.length === 0;
      default: return true;
    }
  }

  const v = scalarFor(row, rule.field);
  switch (rule.operator) {
    case "is": return v.toLowerCase() === rule.value.toLowerCase();
    case "isNot": return v.toLowerCase() !== rule.value.toLowerCase();
    case "isSet": return v !== "";
    case "isNotSet": return v === "";
    case "contains": return v.toLowerCase().includes(rule.value.toLowerCase());
    default: return true;
  }
}

/**
 * Apply filters to the flat item list. Rules combine with the connector
 * (AND/OR); search + hideDone always AND on top. Ancestors of surviving
 * subtasks are kept so the table can render the parent chain.
 */
export function applyFilters(items: BoardItemRow[], f: BoardFilters, statuses: StatusOption[]): BoardItemRow[] {
  if (!filtersActive(f)) return items;
  const q = f.search.trim().toLowerCase();
  const rules = f.rules.filter(ruleActive);

  const matches = (it: BoardItemRow): boolean => {
    if (f.hideDone && isDoneStatus(statuses, it.status)) return false;
    if (rules.length) {
      const ok = f.connector === "OR" ? rules.some((r) => matchesRule(it, r)) : rules.every((r) => matchesRule(it, r));
      if (!ok) return false;
    }
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

// ── FilterMenu — the toolbar chip + ClickUp-style rule panel ───────

const selectCls = "h-7 rounded-md border border-zinc-200 bg-white text-[13px] px-1.5 focus:outline-none focus:border-zinc-400";

interface FilterMenuProps {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  /** The board's own status set — drives the Status value dropdown. */
  statuses: StatusOption[];
  /** Board rows — tag value options come from tags actually in use. */
  items: BoardItemRow[];
  /** Custom fields (Board.schema.fields) — each is filterable as text. */
  customFields?: FieldDef[];
  savedFilters?: SavedFilter[];
  /** Absent → the Saved section is hidden (no view to persist into). */
  onSavedFiltersChange?: (next: SavedFilter[]) => void;
}

export function FilterMenu({ filters, onChange, statuses, items, customFields = [], savedFilters = [], onSavedFiltersChange }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Panel is portaled to body (MorePortal) so check both the trigger
    // wrapper and the portaled panel before treating a click as outside.
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Org members for the Assignee value dropdown — same endpoint the
  // AssigneePicker searches ({ data: [...] } from /api/users).
  const [members, setMembers] = useState<PersonRef[] | null>(null);
  useEffect(() => {
    if (!open || members !== null) return;
    let active = true;
    fetch(`/api/users?${new URLSearchParams({ scope: "all", limit: "50" })}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => { if (active) setMembers(Array.isArray(d?.data) ? (d.data as PersonRef[]) : []); })
      .catch(() => { if (active) setMembers([]); });
    return () => { active = false; };
  }, [open, members]);

  const tags = useMemo(() => {
    const map = new Map<string, ItemTag>();
    for (const it of items) for (const t of it.tags ?? []) map.set(t.id, t);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const { list: itemTypes } = useItemTypes();

  const fieldOptions = useMemo(() => [
    { key: "status", label: "Status" },
    { key: "assignee", label: "Assignee" },
    { key: "priority", label: "Priority" },
    { key: "due", label: "Due date" },
    { key: "tags", label: "Tags" },
    { key: "title", label: "Title" },
    ...(itemTypes.length > 0 ? [{ key: "type", label: "Task Type" }] : []),
    ...customFields.map((f) => ({ key: f.key, label: f.label })),
  ], [itemTypes.length, customFields]);

  const update = (id: string, patch: Partial<FilterRule>) =>
    onChange({ ...filters, rules: filters.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const setField = (rule: FilterRule, field: string) => {
    const ops = operatorsFor(field);
    update(rule.id, { field, operator: ops.includes(rule.operator) ? rule.operator : ops[0], value: "" });
  };

  const count = activeRuleCount(filters) + (filters.hideDone ? 1 : 0);
  const active = count > 0;

  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name || !onSavedFiltersChange) return;
    const entry: SavedFilter = {
      name,
      connector: filters.connector,
      rules: filters.rules.filter(ruleActive).map(({ field, operator, value }) => ({ field, operator, value })),
    };
    // Same name (case-insensitive) → replace in place.
    onSavedFiltersChange([...savedFilters.filter((s) => s.name.toLowerCase() !== name.toLowerCase()), entry]);
    setSaveName("");
  };

  const applySaved = (s: SavedFilter) => {
    onChange({ ...filters, connector: s.connector, rules: s.rules.map((r) => mkRule(r.field, r.operator, r.value)) });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filter"
        aria-label="Filter"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 h-7 px-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
          active
            ? "text-[var(--os-brand-ink)] bg-[color-mix(in_srgb,var(--os-brand)_12%,transparent)] dark:bg-[color-mix(in_srgb,var(--os-brand)_28%,#1B1F26)]"
            : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
        }`}
      >
        <ListFilter className="w-4 h-4" />
        {active ? <span className="tabular-nums">{count} Filter{count === 1 ? "" : "s"}</span> : null}
      </button>

      {/* Portaled so it escapes the view canvas' overflow clipping and
          clamps to the viewport (was: absolute right-0, clipped left). */}
      <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={480} open={open} placement="below">
        <div className="rounded-lg border border-zinc-200 bg-white shadow-xl p-2.5">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Filters</div>
          {filters.rules.length === 0 ? (
            <p className="text-[13px] text-zinc-500 px-0.5 pb-2">No filters. Add one to narrow the list.</p>
          ) : null}

          <div className="space-y-1.5">
            {filters.rules.map((rule, i) => {
              const ops = operatorsFor(rule.field);
              const needsValue = rule.operator !== "isSet" && rule.operator !== "isNotSet";
              return (
                <div key={rule.id} className="flex items-center gap-1.5">
                  <div className="w-[52px] shrink-0">
                    {i === 0 ? (
                      <span className="text-[12px] text-zinc-400 pl-0.5">Where</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onChange({ ...filters, connector: filters.connector === "AND" ? "OR" : "AND" })}
                        title="Toggle AND / OR"
                        className="h-7 w-full rounded-md border border-zinc-200 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        {filters.connector}
                      </button>
                    )}
                  </div>

                  <select value={rule.field} onChange={(e) => setField(rule, e.target.value)} className={`${selectCls} w-[110px] shrink-0`} aria-label="Filter field">
                    {fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>

                  <select value={rule.operator} onChange={(e) => update(rule.id, { operator: e.target.value as FilterOperator })} className={`${selectCls} w-[92px] shrink-0`} aria-label="Filter operator">
                    {ops.map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o]}</option>)}
                  </select>

                  {needsValue ? (
                    rule.field === "status" ? (
                      <select value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value">
                        <option value="">Select…</option>
                        {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    ) : rule.field === "assignee" ? (
                      <select value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value">
                        <option value="">{members === null ? "Loading…" : "Select…"}</option>
                        {(members ?? []).map((p) => (
                          <option key={p.id} value={p.id}>{`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown"}</option>
                        ))}
                      </select>
                    ) : rule.field === "priority" ? (
                      <select value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value">
                        <option value="">Select…</option>
                        {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    ) : rule.field === "tags" ? (
                      <select value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value">
                        <option value="">{tags.length ? "Select…" : "No tags on this board"}</option>
                        {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : rule.field === "type" ? (
                      <select value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value">
                        <option value="">Select…</option>
                        {itemTypes.map((t) => <option key={t.id} value={t.id}>{t.singular}</option>)}
                      </select>
                    ) : rule.field === "due" ? (
                      <input type="date" value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value" />
                    ) : (
                      <input value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} placeholder="Value" className={`${selectCls} flex-1 min-w-0`} aria-label="Filter value" />
                    )
                  ) : <div className="flex-1" />}

                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, rules: filters.rules.filter((r) => r.id !== rule.id) })}
                    className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-red-500 hover:bg-red-500/10"
                    aria-label="Remove filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() => onChange({ ...filters, rules: [...filters.rules, mkRule("status", "is", "")] })}
              className="inline-flex items-center gap-1.5 text-[13px] text-zinc-600 hover:text-zinc-900"
            >
              <Plus className="w-3.5 h-3.5" /> Add filter
            </button>
            {filters.rules.length > 0 ? (
              <button type="button" onClick={() => onChange({ ...filters, rules: [] })} className="text-[13px] text-zinc-500 hover:text-zinc-800">
                Clear all
              </button>
            ) : null}
          </div>

          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-zinc-100">
            <span className="text-[13px] text-zinc-600">Hide closed tasks</span>
            <Switch checked={filters.hideDone} onChange={(v) => onChange({ ...filters, hideDone: v })} />
          </div>

          {onSavedFiltersChange ? (
            <div className="mt-2.5 pt-2 border-t border-zinc-100">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Saved filters</div>
              {savedFilters.length === 0 ? (
                <p className="text-[13px] text-zinc-500 px-0.5 pb-1">No saved filters yet.</p>
              ) : (
                savedFilters.map((s) => (
                  <div key={s.name} className="group flex items-center gap-1 h-7 px-1 rounded-md hover:bg-zinc-50">
                    <button type="button" onClick={() => applySaved(s)} className="flex-1 min-w-0 text-left text-[13.5px] text-zinc-700 hover:text-zinc-900 truncate" title={`Apply "${s.name}"`}>
                      {s.name}
                      <span className="ml-1.5 text-[12px] text-zinc-400 tabular-nums">{s.rules.length} rule{s.rules.length === 1 ? "" : "s"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSavedFiltersChange(savedFilters.filter((x) => x.name !== s.name))}
                      className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10"
                      aria-label={`Delete saved filter ${s.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
              <div className="flex items-center gap-1.5 mt-1.5">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
                  placeholder="Save current filter as…"
                  className={`${selectCls} flex-1 min-w-0`}
                  aria-label="Saved filter name"
                />
                <button
                  type="button"
                  onClick={saveCurrent}
                  disabled={!saveName.trim() || activeRuleCount(filters) === 0}
                  className="h-7 px-2.5 rounded-md text-[13px] font-medium bg-[var(--os-brand)] hover:bg-[var(--os-brand-deep)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </MorePortal>
    </div>
  );
}
