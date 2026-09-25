// One filter rule against one task row, pure.
//
// The board filter bar's matching (board-filter-bar.tsx) moved here VERBATIM
// so a rule can be evaluated outside a React component: the List comfort
// "Conditional colors" rules (list-comfort.ts RowColorRule) speak the same
// field and operator vocabulary as a filter, and a colour rule and a filter
// rule must mean the same thing. board-filter-bar.tsx re-exports everything
// here, so every existing import keeps working unchanged.
//
// Pure: type-only imports.

import type { BoardItemRow } from "@/lib/board-items-shared";
import type { RowColor, RowColorRule } from "@/lib/list-comfort";

export type FilterOperator =
  | "is"
  | "isNot"
  | "isSet"
  | "isNotSet"
  | "before"
  | "after"
  | "on"
  | "contains";

export interface FilterRule {
  /** Client-only row identity (regenerated on parse, never persisted). */
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
}

/** A rule participates in filtering once it's complete: set/not-set
 *  operators always are; the rest need a value. */
export function ruleActive(rule: Pick<FilterRule, "operator" | "value">): boolean {
  if (rule.operator === "isSet" || rule.operator === "isNotSet") return true;
  return rule.value.trim() !== "";
}

/** Everyone on a task: the primary owner and every secondary assignee, with
 *  no duplicates. The assignee filter used to read ownerId alone, so "Me"
 *  hid every task somebody else was primary on even when the viewer was
 *  assigned to it. */
export function rowAssigneeIds(row: BoardItemRow): string[] {
  const ids = new Set<string>();
  if (row.ownerId) ids.add(row.ownerId);
  for (const id of row.assigneeIds ?? []) if (id) ids.add(id);
  for (const p of row.assignees ?? []) if (p?.id) ids.add(p.id);
  return Array.from(ids);
}

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

export function matchesRule(row: BoardItemRow, rule: FilterRule): boolean {
  // Due date: date-only comparisons against the yyyy-mm-dd value.
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

  // Assignee: membership in the WHOLE assignee set, not just the primary.
  if (rule.field === "assignee") {
    const ids = rowAssigneeIds(row);
    switch (rule.operator) {
      case "is": return ids.includes(rule.value);
      case "isNot": return !ids.includes(rule.value);
      case "isSet": return ids.length > 0;
      case "isNotSet": return ids.length === 0;
      default: return true;
    }
  }

  // Tags: membership in the row's tag list.
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
 * The colour a row takes from a List's Conditional colors rules: the FIRST
 * complete rule that matches wins, with a filter rule's exact semantics. An
 * unfinished rule (no value yet) colours nothing, the way an unfinished filter
 * filters nothing.
 *
 * `statusOf` is how a status rule reads a row shown in this List through a
 * link: its stored status belongs to its home set, and the rule names this
 * List's statuses (list-link-rows.ts boardStatusFor).
 */
export function rowColorFor(
  row: BoardItemRow,
  rules: readonly RowColorRule[],
  statusOf?: (row: BoardItemRow) => string | null,
): RowColor | null {
  for (const r of rules) {
    if (!ruleActive(r)) continue;
    const subject = statusOf && r.field === "status" ? { ...row, status: statusOf(row) } : row;
    if (matchesRule(subject, { id: r.id, field: r.field, operator: r.operator, value: r.value })) return r.color;
  }
  return null;
}
