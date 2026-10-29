// What a target's `source` may hold when the key-results routes write it
// (docs/plans/recurring-goals.md C2, C3, C6, 2.0). Pure.
//
// Three shapes: the KPI combine of a quarterly or yearly goal,
// { kind: "kpi", combine: "LATEST" | "SUM" | "AVERAGE" }; a List or Space
// source (goal-source.ts parseListSource: where, what, which tasks, counted
// by); and a table source (table-source.ts parseTableSource: which table,
// what, which rows, counted by). Every source is refused while
// RECURRING_GOALS is off: the switch closes the doors that connect one. The
// connector's checks (Can view on the Lists or the table, the fields or the
// columns, the Tables module) are the route's, on the server
// (goal-source.server.ts connectSourceProblem).

import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { isKpiCombine } from "@/lib/goals/goal-measure";
import { parseListSource, serializeListSource, type ConnectedSource } from "@/lib/goals/goal-source";
import { parseTableSource, serializeTableSource } from "@/lib/goals/table-source";

export type TargetSourceValue = { kind: "kpi"; combine: "LATEST" | "SUM" | "AVERAGE" } | Record<string, unknown>;

/** undefined: leave it; null: clear it; else the checked source (and the List or table source it counts), or the 400's words. */
export function parseTargetSource(raw: unknown): { ok: true; value: TargetSourceValue | null | undefined; connected: ConnectedSource | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined, connected: null };
  if (raw === null) return { ok: true, value: null, connected: null };
  if (!recurringGoalsOn()) return { ok: false, error: RECURRING_GOALS_OFF };
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (s && s.kind === "kpi" && isKpiCombine(s.combine)) return { ok: true, value: { kind: "kpi", combine: s.combine }, connected: null };
  if (s && (s.kind === "list" || s.kind === "space")) {
    const list = parseListSource(s);
    if (!list) return { ok: false, error: "That List source is not complete: choose where, what and how it is counted." };
    return { ok: true, value: serializeListSource(list), connected: list };
  }
  if (s && s.kind === "table") {
    const table = parseTableSource(s);
    if (!table) return { ok: false, error: "That table source is not complete: choose the table, what and how it is counted." };
    return { ok: true, value: serializeTableSource(table), connected: table };
  }
  return { ok: false, error: "That is not something a target can be measured by." };
}
