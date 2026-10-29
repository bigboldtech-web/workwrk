// What a target's `source` may hold when the key-results routes write it
// (docs/plans/recurring-goals.md C2, C3, C6, 2.0). Pure.
//
// Two shapes: the KPI combine of a quarterly or yearly goal,
// { kind: "kpi", combine: "LATEST" | "SUM" | "AVERAGE" }, and a List or
// Space source (goal-source.ts parseListSource: where, what, which tasks,
// counted by). A table source is step 5 (its checks, the connector and the
// pause rules), so it is refused here until then. Every source is refused
// while RECURRING_GOALS is off: the switch closes the doors that connect one.
// The connector's checks (Can view on the Lists, the fields) are the
// route's, on the server (goal-source.server.ts connectSourceProblem).

import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { isKpiCombine } from "@/lib/goals/goal-measure";
import { parseListSource, serializeListSource, type ListSource } from "@/lib/goals/goal-source";

export type TargetSourceValue = { kind: "kpi"; combine: "LATEST" | "SUM" | "AVERAGE" } | Record<string, unknown>;

/** undefined: leave it; null: clear it; else the checked source (and the List source it reads), or the 400's words. */
export function parseTargetSource(raw: unknown): { ok: true; value: TargetSourceValue | null | undefined; list: ListSource | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined, list: null };
  if (raw === null) return { ok: true, value: null, list: null };
  if (!recurringGoalsOn()) return { ok: false, error: RECURRING_GOALS_OFF };
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (s && s.kind === "kpi" && isKpiCombine(s.combine)) return { ok: true, value: { kind: "kpi", combine: s.combine }, list: null };
  if (s && (s.kind === "list" || s.kind === "space")) {
    const list = parseListSource(s);
    if (!list) return { ok: false, error: "That List source is not complete: choose where, what and how it is counted." };
    return { ok: true, value: serializeListSource(list), list };
  }
  if (s && s.kind === "table") return { ok: false, error: "Counting a target from a table is not available yet." };
  return { ok: false, error: "That is not something a target can be measured by." };
}
