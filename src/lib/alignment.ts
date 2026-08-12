// Alignment engine — the shared read-side math for the three-layer model.
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
// read time — we never write the derived number back onto the KeyResult
// row, and we never touch a KPIRecord. The hand-typed value stays on the
// row untouched (surfaced as `enteredValue`) so no user data is lost or
// silently rewritten; it is simply not what the UI reads while a link
// exists. Every first-party read path funnels through `enrichKeyResults`
// so a new KPIRecord is reflected everywhere the moment it lands.

import { prisma } from "@/lib/prisma";
import type { KpiDirection, KpiOwnership, Prisma } from "@/generated/prisma";

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
 * A NULL targetValue means "no baseline yet" — we return "no_target" and
 * never invent a line. A missing reading is likewise "no_target": there is
 * nothing to judge.
 *
 * HIGHER  — at or above the line is healthy, within 10% below is at risk.
 * LOWER   — at or below the line is healthy, within 10% above is at risk.
 * MAINTAIN— the value must sit ON the line; anything outside 0.5% is off
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
 * any digit), so derivation filters them out — the stored rows themselves
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
 * actualValue are ignored — a sent-back number must not drive a KR.
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
 * Latest usable reading for a set of (KPI, person) pairs — one person's
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
  /** Resolved direction — the enum when set, else derived from lowerIsBetter. */
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

export type EnrichedKeyResult<T extends RawKeyResultWithKpi> = T & {
  currentValue: number;
  progress: number;
  /** True when currentValue/progress came from the linked KPI. */
  isDerived: boolean;
  /** The hand-typed number still on the row. Never overwritten, never lost. */
  enteredValue: number;
  kpi: LinkedKpiPayload | null;
};

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
      ...kr,
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
        ...kr,
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
// Goal rollup — one number per goal, everywhere
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
//             someone hand-set a progress, "NONE" when there is nothing —
//             the UI shows "—", not a fake 0% that reads as "behind".
//
// The whole org is computed in one pass (goals are a small table — this is
// the goal graph, not the task table) so a parent's number is right even
// when the viewer can't see every child.

export type GoalProgressSource = "ROLLUP" | "MANUAL" | "NONE";

export interface GoalRollup {
  /** Effective progress 0-100 (stored value when source is not ROLLUP). */
  progress: number;
  /** Display status — derived thresholds for ROLLUP, stored otherwise. */
  status: string;
  source: GoalProgressSource;
}

export interface GoalRollupContext {
  rollups: Map<string, GoalRollup>;
  /** parentId per goal (only parents that exist in the org count). */
  parentOf: Map<string, string | null>;
  /** The stored progress/status columns, for change detection on persist. */
  stored: Map<string, { progress: number; status: string }>;
}

/**
 * Effective rollup for every goal in the org: two bounded queries + pure
 * recursion. Unmeasured (source "NONE") children contribute nothing to
 * their parent — three empty sub-goals must not drag a measured sibling's
 * 60% down to 15%.
 */
export async function computeGoalRollups(orgId: string): Promise<GoalRollupContext> {
  const okrs = await prisma.oKR.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, parentId: true, ownerId: true, progress: true, status: true,
      keyResults: {
        select: {
          id: true, startValue: true, targetValue: true, currentValue: true,
          progress: true, kpiId: true, kpi: { select: KR_KPI_SELECT },
        },
      },
    },
  });

  const groups = await enrichKeyResultGroups(
    okrs.map((o) => ({ userId: o.ownerId, keyResults: o.keyResults })),
  );

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

  const resolve = (id: string): GoalRollup => {
    const memo = rollups.get(id);
    if (memo) return memo;
    const node = byId.get(id)!;
    if (visiting.has(id)) {
      // parentId cycle — treat the back-edge as unmeasured, don't recurse.
      return { progress: clampPct(node.progress), status: node.status, source: "NONE" };
    }
    visiting.add(id);
    const contributions: Array<{ progress: number }> = [...node.live];
    for (const childId of childrenOf.get(id) ?? []) {
      const child = resolve(childId);
      if (child.source !== "NONE") contributions.push({ progress: child.progress });
    }
    visiting.delete(id);

    const rolled = rollUpOkrProgress(contributions);
    const rollup: GoalRollup =
      rolled == null
        ? {
            progress: clampPct(node.progress),
            status: node.status,
            source: node.progress > 0 ? "MANUAL" : "NONE",
          }
        : { progress: rolled, status: okrStatusFor(rolled), source: "ROLLUP" };
    rollups.set(id, rollup);
    return rollup;
  };
  for (const o of okrs) resolve(o.id);

  return {
    rollups,
    parentOf,
    stored: new Map(okrs.map((o) => [o.id, { progress: o.progress, status: o.status }])),
  };
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
 * overwritten — a hand-set number is user data.
 */
export async function persistGoalRollupChain(okrId: string): Promise<GoalRollup | null> {
  const okr = await prisma.oKR.findUnique({
    where: { id: okrId },
    select: { organizationId: true },
  });
  if (!okr) return null;

  const ctx = await computeGoalRollups(okr.organizationId);

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | null = okrId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const roll = ctx.rollups.get(cursor);
    const before = ctx.stored.get(cursor);
    if (
      roll && before && roll.source === "ROLLUP" &&
      (roll.progress !== before.progress || roll.status !== before.status)
    ) {
      writes.push(
        prisma.oKR.update({
          where: { id: cursor },
          data: { progress: roll.progress, status: roll.status },
        }),
      );
    }
    cursor = ctx.parentOf.get(cursor) ?? null;
  }
  if (writes.length > 0) await prisma.$transaction(writes);
  return ctx.rollups.get(okrId) ?? null;
}

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
