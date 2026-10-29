// What measures a goal's target, and how a period starts it
// (docs/plans/recurring-goals.md B4, C2, C6). Pure: no prisma, no React, so
// the goal page, the API routes and the period server module all read the
// same rule.
//
// MEASURED AUTOMATICALLY (C2). A target is checked in by hand unless a KPI
// (KeyResult.kpiId) or a connected source (KeyResult.source of kind list,
// space or table, steps 4 and 5) counts it. isMeasuredAutomatically is the
// one test: the check-in route refuses such a target, the verdict never
// calls it stale, and the reminders skip it. It replaces the four
// `kpiId != null` checks (GET /api/okrs, the assess route, the goal page and
// the profile), which read a sourced target as hand-checked.
//
// KeyResult.source also carries the KPI combine choice of a quarterly or
// yearly goal (C6: Latest month, Sum of months, Average of months) as
// { kind: "kpi", combine }. That alone measures nothing: without a kpiId it
// is a stale choice, so it never makes a target automatic.

/** Kinds of KeyResult.source that count a target (steps 4 and 5 connect them). */
const CONNECTED_KINDS = new Set(["list", "space", "table"]);

function recordOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** True when a List, Space or table source counts the target (C3, C5). */
export function hasConnectedSource(source: unknown): boolean {
  const s = recordOf(source);
  return !!s && typeof s.kind === "string" && CONNECTED_KINDS.has(s.kind);
}

/**
 * C2: a KPI or a connected source counts this target, so nobody checks it in
 * by hand. A target that left the server through enrichKeyResults carries no
 * source (C9), only `measuredAutomatically`, which this reads too.
 */
export function isMeasuredAutomatically(kr: { kpiId?: string | null; source?: unknown; measuredAutomatically?: boolean }): boolean {
  if (kr.measuredAutomatically === true) return true;
  return (typeof kr.kpiId === "string" && kr.kpiId.length > 0) || hasConnectedSource(kr.source);
}

export type TargetDirection = "HIGHER" | "LOWER" | "MAINTAIN";

/**
 * Which way "good" points for a target, as inferKeyResultDirection
 * (alignment.ts) decides it: a linked KPI's direction (its enum, else the
 * legacy lowerIsBetter), else LOWER when the target sits below the start.
 * Kept here, prisma-free, for the period modules.
 */
export function targetDirection(kr: {
  startValue: number;
  targetValue: number;
  kpi?: { direction?: string | null; lowerIsBetter?: boolean | null } | null;
}): TargetDirection {
  if (kr.kpi) {
    const d = kr.kpi.direction;
    if (d === "HIGHER" || d === "LOWER" || d === "MAINTAIN") return d;
    return kr.kpi.lowerIsBetter ? "LOWER" : "HIGHER";
  }
  return Number(kr.targetValue) < Number(kr.startValue) ? "LOWER" : "HIGHER";
}

/* ───────────────────────── The KPI combine (C6) ───────────────────────── */

export const KPI_COMBINES = ["LATEST", "SUM", "AVERAGE"] as const;
export type KpiCombine = (typeof KPI_COMBINES)[number];

export function isKpiCombine(v: unknown): v is KpiCombine {
  return typeof v === "string" && (KPI_COMBINES as readonly string[]).includes(v);
}

/** How a quarterly or yearly goal's KPI target reads its months. Latest month unless chosen. */
export function kpiCombineOf(source: unknown): KpiCombine {
  const s = recordOf(source);
  return s && s.kind === "kpi" && isKpiCombine(s.combine) ? s.combine : "LATEST";
}

/**
 * The value a KPI target reads for a period from the owner's monthly
 * records (C6): the period's own month for a monthly goal; for a quarterly
 * or yearly goal its months combined: the latest month with a number, their
 * sum, or their average. Null when no month inside the period has a number,
 * so the target reads its starting number.
 */
export function combineKpiMonths(
  months: readonly string[],
  valueOf: ReadonlyMap<string, number>,
  combine: KpiCombine,
): number | null {
  const present = months.filter((m) => valueOf.has(m)).sort();
  if (present.length === 0) return null;
  const values = present.map((m) => valueOf.get(m) as number);
  if (combine === "SUM") return values.reduce((s, v) => s + v, 0);
  if (combine === "AVERAGE") return values.reduce((s, v) => s + v, 0) / values.length;
  return values[values.length - 1];
}

/* ───────────────────────── Each period starts at (B4) ───────────────────────── */

/** KeyResult.periodStart: the start value, or last period's number. NULL is the default by direction. */
export const PERIOD_STARTS = ["START", "LAST"] as const;
export type PeriodStart = (typeof PERIOD_STARTS)[number];

export function isPeriodStart(v: unknown): v is PeriodStart {
  return typeof v === "string" && (PERIOD_STARTS as readonly string[]).includes(v);
}

/**
 * B4: what a new period opens a target at. Chosen, or by default "Last
 * period's number" for a target that counts down (open bugs, NPS held by
 * hand) and "Start value" otherwise. Worst case of always resetting: "open
 * bugs" jumps back to its baseline of 30 every 1st.
 */
export function periodStartOf(kr: { periodStart?: string | null; direction: "HIGHER" | "LOWER" | "MAINTAIN" }): PeriodStart {
  if (isPeriodStart(kr.periodStart)) return kr.periodStart;
  return kr.direction === "LOWER" ? "LAST" : "START";
}
