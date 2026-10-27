// What a target's `source` may hold when the key-results routes write it
// (docs/plans/recurring-goals.md C2, C6, 2.0). Pure.
//
// Step 2 accepts one shape: the KPI combine of a quarterly or yearly goal,
// { kind: "kpi", combine: "LATEST" | "SUM" | "AVERAGE" }. A List, Space or
// table source is steps 4 and 5 (their checks, the connector and the
// pause rules), so it is refused here until then. Every source is refused
// while RECURRING_GOALS is off: the switch closes the doors that connect one.

import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { isKpiCombine } from "@/lib/goals/goal-measure";

export type TargetSourceValue = { kind: "kpi"; combine: "LATEST" | "SUM" | "AVERAGE" };

/** undefined: leave it; null: clear it; else the checked source, or the 400's words. */
export function parseTargetSource(raw: unknown): { ok: true; value: TargetSourceValue | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (!recurringGoalsOn()) return { ok: false, error: RECURRING_GOALS_OFF };
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (s && s.kind === "kpi" && isKpiCombine(s.combine)) return { ok: true, value: { kind: "kpi", combine: s.combine } };
  if (s && (s.kind === "list" || s.kind === "space" || s.kind === "table")) {
    return { ok: false, error: "Counting a target from a List or a table is not available yet." };
  }
  return { ok: false, error: "That is not something a target can be measured by." };
}
