// Dashboard widget arithmetic, pure: which rows a card's filter keeps, and
// the number, the distribution or the list it shows.
//
// The rows arrive already scoped to what the viewer can read and already
// projected for the List each row is shown under (widget-data.ts), so nothing
// here can widen access: it only counts what it is given.
//
// The filter semantics are the board filter bar's (board-filter-bar.tsx
// matchesRule), with one difference that is the point of running them on the
// server: a due-date rule's day is the VIEWER's day, in their zone, not the
// server's.

import { zonedTimeToUtc } from "@/lib/reports/schedule";
import { fieldKeyOfId } from "@/lib/field-keys";
import type { ChartGroupBy, ListSort, StatMetric, StatScope, WidgetFilter, WidgetRule } from "./widgets";

export interface WidgetRow {
  id: string;
  title: string;
  status: string | null;
  /** By the task's HOME status set. */
  done: boolean;
  priority: string | null;
  dueAt: Date | null;
  startAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string | null;
  assigneeIds: string[];
  itemTypeId: string | null;
  tagIds: string[];
  /** The List the row is shown under (contextBoardFor). */
  listId: string;
  /** Projected for that List and this viewer. */
  metadata: Record<string, unknown>;
}

function people(row: WidgetRow): string[] {
  return Array.from(new Set([row.ownerId, ...row.assigneeIds].filter((v): v is string => !!v)));
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(scalar).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v);
}

function dayBounds(value: string, zone: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = zonedTimeToUtc(y, mo, d, 0, 0, zone).getTime();
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const end = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, zone).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/** A rule counts once it is complete: set or not set always, the rest with a value. */
export function ruleActive(rule: WidgetRule): boolean {
  if (rule.operator === "isSet" || rule.operator === "isNotSet") return true;
  return rule.value.trim() !== "";
}

function matchSet(ids: readonly string[], rule: WidgetRule): boolean {
  switch (rule.operator) {
    case "is": return ids.includes(rule.value);
    case "isNot": return !ids.includes(rule.value);
    case "isSet": return ids.length > 0;
    case "isNotSet": return ids.length === 0;
    default: return true;
  }
}

function matchDate(at: Date | null, rule: WidgetRule, zone: string): boolean {
  if (rule.operator === "isSet") return !!at;
  if (rule.operator === "isNotSet") return !at;
  if (!at) return false;
  const b = dayBounds(rule.value, zone);
  if (!b) return true;
  const t = at.getTime();
  if (rule.operator === "on") return t >= b.start && t < b.end;
  if (rule.operator === "before") return t < b.start;
  if (rule.operator === "after") return t >= b.end;
  return true;
}

export function matchesWidgetRule(row: WidgetRow, rule: WidgetRule, zone: string): boolean {
  if (rule.field === "due") return matchDate(row.dueAt, rule, zone);
  if (rule.field === "assignee") return matchSet(people(row), rule);
  if (rule.field === "tags") return matchSet(row.tagIds, rule);
  const v =
    rule.field === "status" ? row.status ?? ""
      : rule.field === "priority" ? row.priority ?? ""
        : rule.field === "type" ? row.itemTypeId ?? ""
          : rule.field === "title" ? row.title
            // A custom field's id: its key, or "field:<key>" for a key a
            // built-in also uses (field-keys.ts ruleFieldIdOf).
            : scalar(row.metadata[fieldKeyOfId(rule.field)]);
  const lv = v.toLowerCase();
  const target = rule.value.toLowerCase();
  switch (rule.operator) {
    case "is": return lv === target;
    case "isNot": return lv !== target;
    case "isSet": return v !== "";
    case "isNotSet": return v === "";
    case "contains": return lv.includes(target);
    case "on":
    case "before":
    case "after": {
      const parsed = v ? new Date(v) : null;
      return matchDate(parsed && !Number.isNaN(parsed.getTime()) ? parsed : null, rule, zone);
    }
  }
  return true;
}

export function applyWidgetFilter(rows: readonly WidgetRow[], filter: WidgetFilter, zone: string): WidgetRow[] {
  const rules = filter.rules.filter(ruleActive);
  return rows.filter((row) => {
    if (filter.hideDone && row.done) return false;
    if (!rules.length) return true;
    return filter.connector === "OR"
      ? rules.some((r) => matchesWidgetRule(row, r, zone))
      : rules.every((r) => matchesWidgetRule(row, r, zone));
  });
}

export function inScope(row: WidgetRow, scope: StatScope, now: Date): boolean {
  switch (scope) {
    case "open": return !row.done;
    case "completed": return row.done;
    case "overdue": return !row.done && !!row.dueAt && row.dueAt.getTime() < now.getTime();
    default: return true;
  }
}

/** A stat card's number: a count, or the sum of a numeric field (non-numbers ignored). */
export function statValue(rows: readonly WidgetRow[], metric: StatMetric, scope: StatScope, now: Date): number {
  const kept = rows.filter((r) => inScope(r, scope, now));
  if (metric.op === "count") return kept.length;
  let sum = 0;
  for (const r of kept) {
    const v = r.metadata[metric.fieldKey];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

export interface Bucket {
  key: string | null;
  label: string;
  color: string | null;
  count: number;
}

/**
 * A chart card's buckets. A row counts once per value it carries, so a task
 * with two assignees is in both people's bars, which is what "tasks by
 * assignee" means; `label` resolves a key to its words and colour.
 */
export function distribution(
  rows: readonly WidgetRow[],
  groupBy: ChartGroupBy,
  label: (key: string | null) => { label: string; color: string | null },
): Bucket[] {
  const counts = new Map<string | null, number>();
  const bump = (k: string | null) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const r of rows) {
    if (groupBy === "status") bump(r.status);
    else if (groupBy === "priority") bump(r.priority);
    else if (groupBy === "assignee") {
      const p = people(r);
      if (p.length === 0) bump(null);
      for (const id of p) bump(id);
    } else {
      const v = r.metadata[groupBy.field];
      if (Array.isArray(v) && v.length) for (const x of new Set(v.map(scalar))) bump(x || null);
      else bump(scalar(v) || null);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, ...label(key) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** A list card's rows, sorted and cut. */
export function sortListRows(rows: readonly WidgetRow[], sort: ListSort, limit: number): WidgetRow[] {
  const time = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case "due": return time(a.dueAt) - time(b.dueAt) || a.title.localeCompare(b.title);
      case "created": return b.createdAt.getTime() - a.createdAt.getTime();
      case "priority": return (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) || b.updatedAt.getTime() - a.updatedAt.getTime();
      case "title": return a.title.localeCompare(b.title);
      default: return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
  });
  return sorted.slice(0, limit);
}
