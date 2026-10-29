// Alignment engine, the shared read-side math for the three-layer model.
//
//   KRA  = permanent container on the ROLE (KRA.roleId). No number, no date.
//   KPI  = permanent running gauge under its KRA (KPI.kraId). Definition,
//          unit, direction, healthy line (targetValue, may be NULL).
//          OWNED = the role controls it (graded); SHARED = only influences it.
//   OKR  = temporary, time-boxed, attached to the PERSON (OKR.ownerId).
//          A KeyResult may point UP at a role KPI via KeyResult.kpiId.
//
// DERIVATION IS READ-SIDE. When a KeyResult is linked to a KPI, its
// currentValue/progress are computed from the KPI's latest KPIRecord at
// read time, we never write the derived number back onto the KeyResult
// row, and we never touch a KPIRecord. The hand-typed value stays on the
// row untouched (surfaced as `enteredValue`) so no user data is lost or
// silently rewritten; it is simply not what the UI reads while a link
// exists. Every first-party read path funnels through `enrichKeyResults`
// so a new KPIRecord is reflected everywhere the moment it lands.

import { prisma } from "@/lib/prisma";
import type { KpiDirection, KpiOwnership, Prisma } from "@/generated/prisma";
import { isGoalCadence, periodSettingsOf, type PeriodSettings } from "@/lib/goals/goal-period";
import { loadStoredPeriods, oneTimeAsOf, type StoredPeriod } from "@/lib/goals/period-graph.server";
import { repeatingChildForOneTimeParent, repeatingLiveScore, type PeriodGraph } from "@/lib/goals/period-rollup";
import { isMeasuredAutomatically, kpiCombineOf, type KpiCombine } from "@/lib/goals/goal-measure";

// ---------------------------------------------------------------------------
// Direction + health
// ---------------------------------------------------------------------------

export type KpiHealth = "healthy" | "at_risk" | "off_track" | "no_target";

/** Anything carrying the two direction columns (new enum + legacy boolean). */
export interface KpiDirectionInput {
  direction?: KpiDirection | null;
  lowerIsBetter?: boolean | null;
}

export interface KpiHealthInput extends KpiDirectionInput {
  targetValue?: number | null;
}

/** How far off the line still counts as "at risk" rather than "off track". */
const AT_RISK_BAND = 0.1;
/** MAINTAIN gauges: anything inside this relative band is holding the line. */
const MAINTAIN_TOLERANCE = 0.005;

/**
 * Resolved direction of "good" for a KPI. The `direction` enum wins when
 * set; otherwise fall back to the legacy `lowerIsBetter` boolean.
 */
export function kpiDirection(kpi: KpiDirectionInput | null | undefined): KpiDirection {
  if (kpi?.direction) return kpi.direction;
  return kpi?.lowerIsBetter ? "LOWER" : "HIGHER";
}

/**
 * Health of a reading against the KPI's healthy line.
 *
 * A NULL targetValue means "no baseline yet", we return "no_target" and
 * never invent a line. A missing reading is likewise "no_target": there is
 * nothing to judge.
 *
 * HIGHER , at or above the line is healthy, within 10% below is at risk.
 * LOWER  , at or below the line is healthy, within 10% above is at risk.
 * MAINTAIN,  the value must sit ON the line; anything outside 0.5% is off
 *           track (there is no at-risk band for a hold-the-line gauge).
 */
export function kpiHealth(
  kpi: KpiHealthInput | null | undefined,
  value: number | null | undefined,
): KpiHealth {
  const target = kpi?.targetValue;
  if (target == null || !Number.isFinite(target)) return "no_target";
  if (value == null || !Number.isFinite(value)) return "no_target";

  const direction = kpiDirection(kpi);
  const magnitude = Math.abs(target);

  if (direction === "MAINTAIN") {
    return Math.abs(value - target) <= magnitude * MAINTAIN_TOLERANCE ? "healthy" : "off_track";
  }

  const band = magnitude * AT_RISK_BAND;
  if (direction === "LOWER") {
    if (value <= target) return "healthy";
    return value <= target + band ? "at_risk" : "off_track";
  }
  if (value >= target) return "healthy";
  return value >= target - band ? "at_risk" : "off_track";
}

// ---------------------------------------------------------------------------
// Key-result math (pure)
// ---------------------------------------------------------------------------

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Progress 0-100 along start → target, honouring direction. For LOWER,
 * progress RISES as the value FALLS toward the target.
 */
export function keyResultProgress(
  startValue: number,
  targetValue: number,
  currentValue: number,
  direction: KpiDirection = "HIGHER",
): number {
  const start = Number(startValue) || 0;
  const target = Number(targetValue) || 0;
  const current = Number(currentValue) || 0;

  if (direction === "MAINTAIN") {
    const tolerance = Math.abs(target) * MAINTAIN_TOLERANCE;
    if (Math.abs(current - target) <= tolerance) return 100;
    const span = Math.abs(start - target);
    if (span === 0) return 0;
    return clampPct((1 - Math.abs(current - target) / span) * 100);
  }

  if (direction === "LOWER") {
    const span = start - target;
    if (span <= 0) return current <= target ? 100 : 0;
    return clampPct(((start - current) / span) * 100);
  }

  const span = target - start;
  if (span <= 0) return current >= target ? 100 : 0;
  return clampPct(((current - start) / span) * 100);
}

/**
 * Direction for a key result. Linked → the KPI decides. Unlinked → a KR
 * whose target sits BELOW its start is obviously a reduce-it KR, so read
 * it as LOWER; everything else counts up.
 */
export function inferKeyResultDirection(kr: {
  startValue: number;
  targetValue: number;
  kpi?: KpiDirectionInput | null;
}): KpiDirection {
  if (kr.kpi) return kpiDirection(kr.kpi);
  return Number(kr.targetValue) < Number(kr.startValue) ? "LOWER" : "HIGHER";
}

export interface KeyResultShape {
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  kpiId?: string | null;
  kpi?: KpiDirectionInput | null;
}

export interface DerivedKeyResult {
  currentValue: number;
  progress: number;
  /** True when the number came from the linked KPI, not from the KR row. */
  isDerived: boolean;
}

/**
 * The one place a KeyResult's live numbers are decided.
 *
 * Linked to a KPI with a reading → currentValue is the KPI's latest value
 * and progress is recomputed from start → target in the KPI's direction.
 * Unlinked (or linked but not yet measured) → the row's own numbers stand;
 * we never fabricate a reading.
 */
export function deriveKeyResultProgress(
  kr: KeyResultShape,
  kpiValue: number | null | undefined,
): DerivedKeyResult {
  const linked = Boolean(kr.kpiId);
  if (!linked || kpiValue == null || !Number.isFinite(kpiValue)) {
    return {
      currentValue: Number(kr.currentValue) || 0,
      progress: clampPct(Number(kr.progress) || 0),
      isDerived: false,
    };
  }
  const direction = kpiDirection(kr.kpi);
  return {
    currentValue: kpiValue,
    progress: keyResultProgress(kr.startValue, kr.targetValue, kpiValue, direction),
    isDerived: true,
  };
}

/** Objective progress = mean of its key results. Empty → null (caller keeps its own). */
export function rollUpOkrProgress(krs: Array<{ progress: number }>): number | null {
  if (krs.length === 0) return null;
  const total = krs.reduce((sum, kr) => sum + (Number(kr.progress) || 0), 0);
  return clampPct(total / krs.length);
}

/** Same thresholds the check-in path has always used. */
export function okrStatusFor(progress: number): "COMPLETED" | "ON_TRACK" | "AT_RISK" | "BEHIND" {
  if (progress >= 100) return "COMPLETED";
  if (progress >= 70) return "ON_TRACK";
  if (progress >= 40) return "AT_RISK";
  return "BEHIND";
}

// ---------------------------------------------------------------------------
// Latest KPI readings
// ---------------------------------------------------------------------------

export interface LatestKpiValue {
  kpiId: string;
  value: number;
  period: string;
  userId: string;
  recordedAt: Date;
}

/**
 * Canonical KPIRecord period key: "YYYY-MM". Legacy keys ("2026-W33",
 * "2026-Q3") out-sort every real month in max-string ordering ("W"/"Q" >
 * any digit), so derivation filters them out, the stored rows themselves
 * are never modified, they just stop driving "latest" readings.
 */
const CANONICAL_PERIOD = /^\d{4}-\d{2}$/;
export const isCanonicalPeriod = (period: string): boolean =>
  CANONICAL_PERIOD.test(period);

/** Prisma-side approximation of {@link isCanonicalPeriod} ("YYYY-Www" /
 *  "YYYY-Qn" rows carry a W or Q); the JS regex re-checks whatever gets
 *  through. Spread into a KPIRecord `where`. */
const CANONICAL_PERIOD_WHERE: { AND: Prisma.KPIRecordWhereInput[] } = {
  AND: [
    { period: { not: { contains: "W" } } },
    { period: { not: { contains: "Q" } } },
  ],
};

/**
 * Latest usable KPIRecord per KPI. "Latest" = highest period string
 * (KPIRecord.period is "YYYY-MM" everywhere in this codebase), tie-broken
 * by most recently updated. REJECTED records and records without an
 * actualValue are ignored, a sent-back number must not drive a KR.
 *
 * Two bounded queries (max-period per KPI, then those rows) so list
 * endpoints never N+1 or drag a whole history table into memory.
 */
export async function latestKpiValues(
  kpiIds: string[],
  opts: { userId?: string | null } = {},
): Promise<Map<string, LatestKpiValue>> {
  const ids = Array.from(new Set(kpiIds.filter(Boolean)));
  const out = new Map<string, LatestKpiValue>();
  if (ids.length === 0) return out;

  const baseWhere = {
    kpiId: { in: ids },
    actualValue: { not: null },
    status: { not: "REJECTED" as const },
    ...CANONICAL_PERIOD_WHERE,
    ...(opts.userId ? { userId: opts.userId } : {}),
  };

  const maxes = await prisma.kPIRecord.groupBy({
    by: ["kpiId"],
    where: baseWhere,
    _max: { period: true },
  });
  const pairs = maxes
    .filter((m) => m._max.period != null)
    .map((m) => ({ kpiId: m.kpiId, period: m._max.period as string }));
  if (pairs.length === 0) return out;

  const rows = await prisma.kPIRecord.findMany({
    where: { ...baseWhere, OR: pairs },
    select: { kpiId: true, actualValue: true, period: true, userId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  for (const row of rows) {
    if (out.has(row.kpiId) || row.actualValue == null) continue;
    if (!isCanonicalPeriod(row.period)) continue;
    out.set(row.kpiId, {
      kpiId: row.kpiId,
      value: row.actualValue,
      period: row.period,
      userId: row.userId,
      recordedAt: row.updatedAt,
    });
  }
  return out;
}

/** Single-KPI convenience wrapper around {@link latestKpiValues}. */
export async function latestKpiValue(
  kpiId: string,
  opts: { userId?: string | null } = {},
): Promise<LatestKpiValue | null> {
  const map = await latestKpiValues([kpiId], opts);
  return map.get(kpiId) ?? null;
}

const pairKey = (kpiId: string, userId: string) => `${kpiId}::${userId}`;

/**
 * Latest usable reading for a set of (KPI, person) pairs, one person's
 * OKR must read that person's own records. Still two bounded queries no
 * matter how many pairs are asked for. Keyed `${kpiId}::${userId}`.
 */
export async function latestKpiValuesByUser(
  pairs: Array<{ kpiId: string; userId: string }>,
): Promise<Map<string, LatestKpiValue>> {
  const out = new Map<string, LatestKpiValue>();
  const wanted = new Set(pairs.map((p) => pairKey(p.kpiId, p.userId)));
  if (wanted.size === 0) return out;

  const kpiIds = Array.from(new Set(pairs.map((p) => p.kpiId)));
  const userIds = Array.from(new Set(pairs.map((p) => p.userId)));
  const baseWhere = {
    kpiId: { in: kpiIds },
    userId: { in: userIds },
    actualValue: { not: null },
    status: { not: "REJECTED" as const },
    ...CANONICAL_PERIOD_WHERE,
  };

  const maxes = await prisma.kPIRecord.groupBy({
    by: ["kpiId", "userId"],
    where: baseWhere,
    _max: { period: true },
  });
  const rowFilter = maxes
    .filter((m) => m._max.period != null && wanted.has(pairKey(m.kpiId, m.userId)))
    .map((m) => ({ kpiId: m.kpiId, userId: m.userId, period: m._max.period as string }));
  if (rowFilter.length === 0) return out;

  const rows = await prisma.kPIRecord.findMany({
    where: {
      actualValue: { not: null },
      status: { not: "REJECTED" as const },
      ...CANONICAL_PERIOD_WHERE,
      OR: rowFilter,
    },
    select: { kpiId: true, actualValue: true, period: true, userId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  for (const row of rows) {
    const key = pairKey(row.kpiId, row.userId);
    if (out.has(key) || row.actualValue == null) continue;
    if (!isCanonicalPeriod(row.period)) continue;
    out.set(key, {
      kpiId: row.kpiId,
      value: row.actualValue,
      period: row.period,
      userId: row.userId,
      recordedAt: row.updatedAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialization for the API
// ---------------------------------------------------------------------------

/** Columns every KR→KPI link needs. Use as a Prisma `select`. */
export const KR_KPI_SELECT = {
  id: true,
  name: true,
  unit: true,
  direction: true,
  lowerIsBetter: true,
  targetValue: true,
  ownership: true,
  isNorthStar: true,
} as const;

/** Order KPIs north-star first, then by name. Use as a Prisma `orderBy`. */
export const KPI_ORDER = [{ isNorthStar: "desc" as const }, { name: "asc" as const }];

export interface LinkedKpiPayload {
  id: string;
  name: string;
  unit: string | null;
  /** Resolved direction, the enum when set, else derived from lowerIsBetter. */
  direction: KpiDirection;
  targetValue: number | null;
  ownership: KpiOwnership;
  isNorthStar: boolean;
  /** Latest usable reading, or null when the gauge has never been recorded. */
  latestValue: number | null;
  latestPeriod: string | null;
  health: KpiHealth;
}

export interface RawKeyResultWithKpi {
  id: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  kpiId: string | null;
  kpi?: {
    id: string;
    name: string;
    unit: string | null;
    direction: KpiDirection | null;
    lowerIsBetter: boolean;
    targetValue: number | null;
    ownership: KpiOwnership;
    isNorthStar: boolean;
  } | null;
}

/**
 * The KeyResult columns of a connected source (docs/plans/recurring-goals.md
 * C9): its Lists or Space, its filter rules and values, its field keys, its
 * connector and why it paused. Never in a response: everyone who sees a goal
 * sees every target, and C9 gives a viewer who cannot open the source no
 * name, no link and no filter details. The goal page reads them through
 * describeTargetSources (goal-source.server.ts), as THIS viewer may see them.
 */
const SOURCE_COLUMNS = ["source", "sourceById", "sourcePausedReason", "sourceRefreshedAt"] as const;
type SourceColumn = (typeof SOURCE_COLUMNS)[number];

export type EnrichedKeyResult<T extends RawKeyResultWithKpi> = Omit<T, SourceColumn> & {
  currentValue: number;
  progress: number;
  /** True when currentValue/progress came from the linked KPI. */
  isDerived: boolean;
  /** The hand-typed number still on the row. Never overwritten, never lost. */
  enteredValue: number;
  kpi: LinkedKpiPayload | null;
  /** A KPI or a connected source counts it, so nobody checks it in by hand (C2). The source itself is never sent. */
  measuredAutomatically: boolean;
  /** A KPI-linked target's months combined (C6: Latest month unless chosen); null when no KPI is linked. */
  kpiCombine: KpiCombine | null;
};

/** A target as it may leave the server: the source columns dropped, what they decide kept (C2, C6, C9). */
function publicKeyResult<T extends RawKeyResultWithKpi>(kr: T): Omit<T, SourceColumn> & { measuredAutomatically: boolean; kpiCombine: KpiCombine | null } {
  const source = (kr as { source?: unknown }).source;
  const out = { ...kr } as Record<string, unknown>;
  for (const k of SOURCE_COLUMNS) delete out[k];
  return {
    ...(out as Omit<T, SourceColumn>),
    measuredAutomatically: isMeasuredAutomatically({ kpiId: kr.kpiId, source }),
    kpiCombine: kr.kpiId ? kpiCombineOf(source) : null,
  };
}

export function serializeLinkedKpi(
  kpi: NonNullable<RawKeyResultWithKpi["kpi"]>,
  latest: LatestKpiValue | undefined,
): LinkedKpiPayload {
  return {
    id: kpi.id,
    name: kpi.name,
    unit: kpi.unit,
    direction: kpiDirection(kpi),
    targetValue: kpi.targetValue,
    ownership: kpi.ownership,
    isNorthStar: kpi.isNorthStar,
    latestValue: latest?.value ?? null,
    latestPeriod: latest?.period ?? null,
    health: kpiHealth(kpi, latest?.value ?? null),
  };
}

/**
 * Attach linked-KPI context and derived numbers to a batch of key results.
 * One extra pair of queries for the whole batch, regardless of KR count.
 *
 * `userId` scopes the readings to one person (a person's OKR should read
 * their own KPI records); omit it to take the org's most recent reading.
 */
export async function enrichKeyResults<T extends RawKeyResultWithKpi>(
  krs: T[],
  opts: { userId?: string | null } = {},
): Promise<Array<EnrichedKeyResult<T>>> {
  const linkedIds = krs.map((kr) => kr.kpiId).filter((id): id is string => Boolean(id));
  const latest = linkedIds.length > 0 ? await latestKpiValues(linkedIds, opts) : new Map<string, LatestKpiValue>();

  return krs.map((kr) => {
    const reading = kr.kpiId ? latest.get(kr.kpiId) : undefined;
    const derived = deriveKeyResultProgress(
      { ...kr, kpi: kr.kpi ?? null },
      reading?.value ?? null,
    );
    return {
      ...publicKeyResult(kr),
      currentValue: derived.currentValue,
      progress: derived.progress,
      isDerived: derived.isDerived,
      enteredValue: Number(kr.currentValue) || 0,
      kpi: kr.kpi ? serializeLinkedKpi(kr.kpi, reading) : null,
    };
  });
}

/**
 * Batched {@link enrichKeyResults} for a list of objectives, each read
 * against its own owner's records. Two queries for the whole page, so a
 * 100-objective list never turns into 200 round trips.
 */
export async function enrichKeyResultGroups<T extends RawKeyResultWithKpi>(
  groups: Array<{ userId?: string | null; keyResults: T[] }>,
): Promise<Array<Array<EnrichedKeyResult<T>>>> {
  const scopedPairs: Array<{ kpiId: string; userId: string }> = [];
  const unscopedIds: string[] = [];
  for (const group of groups) {
    for (const kr of group.keyResults) {
      if (!kr.kpiId) continue;
      if (group.userId) scopedPairs.push({ kpiId: kr.kpiId, userId: group.userId });
      else unscopedIds.push(kr.kpiId);
    }
  }

  const [scoped, unscoped] = await Promise.all([
    scopedPairs.length > 0 ? latestKpiValuesByUser(scopedPairs) : Promise.resolve(new Map<string, LatestKpiValue>()),
    unscopedIds.length > 0 ? latestKpiValues(unscopedIds) : Promise.resolve(new Map<string, LatestKpiValue>()),
  ]);

  return groups.map((group) =>
    group.keyResults.map((kr) => {
      const reading = !kr.kpiId
        ? undefined
        : group.userId
          ? scoped.get(pairKey(kr.kpiId, group.userId))
          : unscoped.get(kr.kpiId);
      const derived = deriveKeyResultProgress({ ...kr, kpi: kr.kpi ?? null }, reading?.value ?? null);
      return {
        ...publicKeyResult(kr),
        currentValue: derived.currentValue,
        progress: derived.progress,
        isDerived: derived.isDerived,
        enteredValue: Number(kr.currentValue) || 0,
        kpi: kr.kpi ? serializeLinkedKpi(kr.kpi, reading) : null,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Goal rollup, one number per goal, everywhere
// ---------------------------------------------------------------------------
//
// A goal's effective progress is derived, never trusted from the stored
// column, so the same goal can never show two different numbers on two
// screens:
//
//   leaf    → mean of its key results' LIVE progress (KPI-linked KRs
//             contribute the gauge's derived number, scoped to the owner).
//   parent  → mean of its own KRs (if any) plus each measured child's
//             effective progress, recursively.
//   neither → nothing to derive. `source` says so honestly: "MANUAL" when
//             someone hand-set a progress, "NONE" when there is nothing,
//             the UI shows "None", not a fake 0% that reads as "behind".
//
// The whole org is computed in one pass (goals are a small table, this is
// the goal graph, not the task table) so a parent's number is right even
// when the viewer can't see every child.

export type GoalProgressSource = "ROLLUP" | "MANUAL" | "NONE";

export interface GoalRollup {
  /** Effective progress 0-100 (stored value when source is not ROLLUP). */
  progress: number;
  /** Display status, derived thresholds for ROLLUP, stored otherwise. */
  status: string;
  source: GoalProgressSource;
}

export interface GoalRollupContext {
  rollups: Map<string, GoalRollup>;
  /** parentId per goal (only parents that exist in the org count). */
  parentOf: Map<string, string | null>;
  /** The stored progress/status columns, for change detection on persist. */
  stored: Map<string, { progress: number; status: string }>;
  /**
   * Repeating goals (docs/plans/recurring-goals.md D2): every stored period,
   * oldest first, with the live rows of the open ones. Empty when no goal
   * of the org repeats.
   */
  periods: Map<string, StoredPeriod[]>;
  /** The org's period settings, set when any goal repeats. */
  periodSettings: PeriodSettings | null;
  /** The period graph the rollup walked (null when no goal repeats), for the close to reuse. */
  periodGraph: PeriodGraph | null;
}

/**
 * Effective rollup for every goal in the org: two bounded queries + pure
 * recursion. Unmeasured (source "NONE") children contribute nothing to
 * their parent, three empty sub-goals must not drag a measured sibling's
 * 60% down to 15%.
 *
 * REPEATING GOALS read periods, not the KeyResult mirror (B8, D2): a
 * repeating goal's number is its current period's (its own rows plus its
 * children's periods by cadence), and a one-time parent takes a repeating
 * child as the mean of its ended periods inside the parent's dates. The
 * stored status of a running repeating goal is never COMPLETED (a monthly
 * goal that hit its number on the 20th stays on Home and in every status
 * filter for the rest of the month); only an ended one (completedAt) is.
 * Two more queries (the org's settings, the periods) run only when a goal
 * of the org repeats.
 */
export async function computeGoalRollups(orgId: string, now: Date = new Date()): Promise<GoalRollupContext> {
  const okrs = await prisma.oKR.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, parentId: true, ownerId: true, progress: true, status: true, completedAt: true,
      repeat: true, startDate: true, endDate: true,
      keyResults: {
        select: {
          id: true, startValue: true, targetValue: true, currentValue: true,
          progress: true, kpiId: true, source: true, kpi: { select: KR_KPI_SELECT },
        },
      },
    },
  });

  const groups = await enrichKeyResultGroups(
    okrs.map((o) => ({ userId: o.ownerId, keyResults: o.keyResults })),
  );

  // The periods of repeating goals (none read while nothing repeats).
  const anyRepeating = okrs.some((o) => isGoalCadence(o.repeat));
  let periodSettings: PeriodSettings | null = null;
  let periods = new Map<string, StoredPeriod[]>();
  if (anyRepeating) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    periodSettings = periodSettingsOf(org?.settings);
    periods = await loadStoredPeriods(okrs, periodSettings, undefined, now);
  }

  const byId = new Map(okrs.map((o, i) => [o.id, { ...o, live: groups[i] }]));
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const o of okrs) {
    const parentId = o.parentId && byId.has(o.parentId) ? o.parentId : null;
    parentOf.set(o.id, parentId);
    if (parentId) {
      const kids = childrenOf.get(parentId);
      if (kids) kids.push(o.id);
      else childrenOf.set(parentId, [o.id]);
    }
  }

  const rollups = new Map<string, GoalRollup>();
  const visiting = new Set<string>();
  // A one-time child of a repeating parent whose period has ended (in its
  // grace, or waiting for the close) reads as of that end: what the parent
  // will freeze at. Loaded below, once per distinct end.
  const asOfByEnd = new Map<number, (goalId: string) => { progress: number | null; attainment: number | null }>();

  // The period graph (D2), over the same parent links.
  const graph: PeriodGraph | null = periodSettings
    ? {
        goals: new Map(okrs.map((o) => [o.id, {
          id: o.id,
          parentId: parentOf.get(o.id) ?? null,
          repeat: isGoalCadence(o.repeat) ? o.repeat : null,
          startDate: o.startDate,
          endDate: o.endDate,
          periods: periods.get(o.id) ?? [],
        }])),
        childrenOf,
        settings: periodSettings,
        now,
        // A one-time child of a repeating parent: its live number for a
        // period still running, its number as of the end for one that ended.
        oneTimeAsOf: (childId, at) => {
          const past = at.getTime() <= now.getTime() ? asOfByEnd.get(at.getTime()) : undefined;
          if (past) return past(childId);
          const r = resolve(childId);
          return r.source === "NONE" ? { progress: null, attainment: null } : { progress: r.progress, attainment: r.progress };
        },
        memo: new Map(),
      }
    : null;
  if (graph && periodSettings) {
    const ends = new Map<number, Set<string>>();
    for (const [goalId, list] of periods) {
      const kids = (childrenOf.get(goalId) ?? []).filter((c) => !isGoalCadence(byId.get(c)?.repeat));
      if (kids.length === 0) continue;
      for (const p of list) {
        if (p.status !== "OPEN" || p.endsAt.getTime() > now.getTime()) continue;
        let set = ends.get(p.endsAt.getTime());
        if (!set) {
          set = new Set();
          ends.set(p.endsAt.getTime(), set);
        }
        for (const k of kids) set.add(k);
      }
    }
    for (const [t, kids] of ends) asOfByEnd.set(t, await oneTimeAsOf(orgId, [...kids], new Date(t), periodSettings, graph));
  }

  const resolve = (id: string): GoalRollup => {
    const memo = rollups.get(id);
    if (memo) return memo;
    const node = byId.get(id)!;
    if (visiting.has(id)) {
      // parentId cycle, treat the back-edge as unmeasured, don't recurse.
      return { progress: clampPct(node.progress), status: node.status, source: "NONE" };
    }
    visiting.add(id);
    if (graph && isGoalCadence(node.repeat)) {
      // A repeating goal: its current period's number (D2), never the mirror.
      const score = repeatingLiveScore(id, graph);
      visiting.delete(id);
      const rollup: GoalRollup = score.progress == null
        ? { progress: 0, status: node.completedAt ? "COMPLETED" : node.status === "COMPLETED" ? "ON_TRACK" : node.status, source: "NONE" }
        : { progress: score.progress, status: runningStatus(score.progress, node.completedAt), source: "ROLLUP" };
      rollups.set(id, rollup);
      return rollup;
    }
    const contributions: Array<{ progress: number }> = [...node.live];
    for (const childId of childrenOf.get(id) ?? []) {
      const childNode = byId.get(childId);
      if (graph && childNode && isGoalCadence(childNode.repeat)) {
        // A repeating child of a one-time parent: its ended periods inside
        // the parent's dates, so the parent does not drop every 1st (D2).
        const s = repeatingChildForOneTimeParent(childId, node, graph);
        resolve(childId);
        if (s.progress != null) contributions.push({ progress: s.progress });
        continue;
      }
      const child = resolve(childId);
      if (child.source !== "NONE") contributions.push({ progress: child.progress });
    }
    visiting.delete(id);

    const rolled = rollUpOkrProgress(contributions);
    const derived: GoalRollup =
      rolled == null
        ? {
            progress: clampPct(node.progress),
            status: node.status,
            source: node.progress > 0 ? "MANUAL" : "NONE",
          }
        : { progress: rolled, status: okrStatusFor(rolled), source: "ROLLUP" };
    // Mark complete is a person's decision (OKR.completedAt): the status
    // column reads COMPLETED while it stands, whatever the targets say, so
    // every reader of status (Home, the PATCH response, reports) agrees
    // with the /okrs verdict. The progress number stays the measured one.
    const rollup: GoalRollup = node.completedAt ? { ...derived, status: "COMPLETED" } : derived;
    rollups.set(id, rollup);
    return rollup;
  };
  for (const o of okrs) resolve(o.id);

  return {
    rollups,
    parentOf,
    stored: new Map(okrs.map((o) => [o.id, { progress: o.progress, status: o.status }])),
    periods,
    periodSettings,
    periodGraph: graph,
  };
}

/**
 * B8: the stored status of a RUNNING repeating goal. At 100% it stores
 * ON_TRACK ("Target hit" is a display label), so Home's not-COMPLETED filter,
 * the reminders and every status filter keep a live monthly goal for the
 * rest of its month. COMPLETED only once the goal has ended (completedAt,
 * stamped at its final close).
 */
export function runningStatus(progress: number, completedAt: Date | null): string {
  if (completedAt) return "COMPLETED";
  const s = okrStatusFor(progress);
  return s === "COMPLETED" ? "ON_TRACK" : s;
}

/** Context lookup with a safe fallback for a row created mid-request. */
export function goalRollupFor(
  ctx: GoalRollupContext,
  okr: { id: string; progress: number; status: string },
): GoalRollup {
  return (
    ctx.rollups.get(okr.id) ?? {
      progress: clampPct(okr.progress),
      status: okr.status,
      source: okr.progress > 0 ? "MANUAL" : "NONE",
    }
  );
}

/**
 * Recompute and PERSIST the effective progress/status of a goal and every
 * ancestor above it (parent chain), from live KR numbers and measured
 * children. Called after a check-in, a KR mutation, or a re-parent, so
 * the stored summary any raw reader sees matches what the derived read
 * paths show. Goals with nothing to derive (MANUAL / NONE) are never
 * overwritten, a hand-set number is user data.
 */
export async function persistGoalRollupChain(okrId: string): Promise<GoalRollup | null> {
  const okr = await prisma.oKR.findUnique({
    where: { id: okrId },
    select: { organizationId: true },
  });
  if (!okr) return null;
  const ctx = await persistGoalRollupChains(okr.organizationId, [okrId]);
  return ctx.rollups.get(okrId) ?? null;
}

/**
 * persistGoalRollupChain for many goals of one org at once: ONE org rollup
 * and one transaction for every touched chain (a settle that opened periods
 * on two thousand goals, docs/plans/recurring-goals.md B3), instead of a
 * whole-org computeGoalRollups per goal. Returns the rollup it computed.
 *
 * The writes go in id order, so two callers whose chains cross (a child's
 * check-in and its parent's settle) lock the same rows in the same order and
 * can never wait on each other in a circle. A small batch is one update per
 * goal, as always; a large one (a month opening for a whole workspace) locks
 * its rows FOR UPDATE in id order and writes them in one statement per
 * BATCH_WRITE goals.
 */
export async function persistGoalRollupChains(orgId: string, okrIds: readonly string[], now: Date = new Date()): Promise<GoalRollupContext> {
  const ctx = await computeGoalRollups(orgId, now);
  const changes = new Map<string, { progress: number; status: string }>();
  for (const start of okrIds) {
    let cursor: string | null = start;
    while (cursor && !changes.has(cursor)) {
      const roll = ctx.rollups.get(cursor);
      const before = ctx.stored.get(cursor);
      if (
        roll && before &&
        // A rolled-up goal stores its derived numbers; any goal stores a
        // status change (Mark complete, or reopening one).
        (roll.source === "ROLLUP" || roll.status !== before.status) &&
        (roll.progress !== before.progress || roll.status !== before.status)
      ) {
        changes.set(cursor, { progress: roll.progress, status: roll.status });
      } else {
        // Walked, nothing to write: marked so a crossing chain stops here too.
        changes.set(cursor, { progress: -1, status: "" });
      }
      cursor = ctx.parentOf.get(cursor) ?? null;
    }
  }
  const writes = [...changes].filter(([, v]) => v.progress >= 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (writes.length === 0) return ctx;
  if (writes.length <= BATCH_SMALL) {
    await prisma.$transaction(writes.map(([id, v]) => prisma.oKR.update({ where: { id }, data: v })));
    return ctx;
  }
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < writes.length; i += BATCH_WRITE) {
      const part = writes.slice(i, i + BATCH_WRITE);
      const ids = part.map(([id]) => id);
      await tx.$queryRaw`SELECT "id" FROM "OKR" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;
      const progress = part.map(([, v]) => v.progress);
      const status = part.map(([, v]) => v.status);
      await tx.$executeRaw`UPDATE "OKR" AS o SET "progress" = v."progress", "status" = v."status" FROM unnest(${ids}::text[], ${progress}::int[], ${status}::text[]) AS v("id", "progress", "status") WHERE o."id" = v."id"`;
    }
  }, { maxWait: 10_000, timeout: 30_000 });
  return ctx;
}

/** Up to this many goal writes go one update each; above it, in batches. */
const BATCH_SMALL = 50;
const BATCH_WRITE = 500;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Resolve a KR's `kpiId` input against the caller's org.
 * Returns `{ ok: false, message }` when the id is not a KPI of this org.
 * `null` clears the link; `undefined` means "leave alone".
 */
export async function resolveKpiLink(
  kpiId: unknown,
  organizationId: string,
): Promise<{ ok: true; value: string | null | undefined } | { ok: false; message: string }> {
  if (kpiId === undefined) return { ok: true, value: undefined };
  if (kpiId === null || kpiId === "") return { ok: true, value: null };
  if (typeof kpiId !== "string") return { ok: false, message: "kpiId must be a string or null" };

  const kpi = await prisma.kPI.findFirst({
    where: { id: kpiId, organizationId },
    select: { id: true },
  });
  if (!kpi) return { ok: false, message: "KPI not found in this organization" };
  return { ok: true, value: kpi.id };
}
