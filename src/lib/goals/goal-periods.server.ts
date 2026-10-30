// Repeating goals on the server (docs/plans/recurring-goals.md A1, A3, A4,
// B3 to B8, C1, C6, D2). The period engine (goal-period.ts) says where
// periods begin and end; this module stores them, routes numbers into them,
// and freezes them.
//
// ONE CREATE PATH (A1). createGoal holds the repeat rules and opens the
// first period, and POST /api/okrs, Ask AI create_okr and the Tuesday
// template all call it, so no door can make a repeating goal with a due date
// or without a first period.
//
// OPENING (settleGoalPeriods, B3). Every read and write that touches a
// repeating goal settles it first: every missing period is opened, oldest
// first, at most 24 per goal per run, and every OPEN period gets the rows of
// targets it is missing. Goals are settled in chunks of CHUNK, each its own
// transaction, which takes the chunk's pg_advisory_xact_lock in sorted key
// order in one statement (two batches cannot deadlock), holds the goal rows
// FOR KEY SHARE (a goal deleted meanwhile waits, one deleted before is
// skipped), re-reads what it is about to write under the locks, inserts the
// periods with ON CONFLICT DO NOTHING (createMany skipDuplicates) and then
// their rows the same way, and mirrors the current numbers in one statement.
// The org rollup runs once per settle. Read and write paths ONLY OPEN, and a
// read path never fails on a settle (settleOnRead logs it and the page shows
// the stored numbers).
//
// CLOSING (closeDuePeriods, the goal-periods cron only). Deepest goals first,
// so a parent freezes on its children's frozen numbers; a parent's close also
// waits for any child of the same period still held open (a KPI month). Each
// period: one transaction that takes the goal's lock and the period row FOR
// UPDATE and, only if it is still OPEN, freezes every row, decides progress,
// attainment, result and scored, and sets CLOSED. After commit, the score
// patch runs exactly once (the row FOR UPDATE again, scorePatchedAt still
// null), and a closed period whose patch has not run is retried by the next
// run. One period failing never stops the others. The periods a run patched
// go into one Inbox row per owner ("October results: 3 hit, 1 missed", F).
//
// ONE WRITER (B8). writePeriodValue is the only writer of a repeating goal's
// target numbers: it takes the goal's lock and the period row FOR UPDATE,
// refuses (409) unless the period is OPEN and, for a hand check-in, before
// its graceEndsAt, writes the row, and mirrors currentValue and progress onto
// the KeyResult row when the period is the current one (Home, search, MCP
// and Ask AI read the mirror). A check-in racing the close either lands
// before the freeze or gets the 409, never half of each.
//
// A KPI ROW READS WHO IT WAS OPENED FOR (C6, B7). Each row of a KPI target
// stores the KPI and the person it reads (kpiId, kpiUserId) at opening; the
// close and every read use them, so reassigning the goal or unlinking the
// KPI during October's KPI hold leaves October alone. A change reaches the
// period running now, never one that has ended.
//
// THE SWITCH (2.0). Everything that makes a goal repeating is refused while
// RECURRING_GOALS is off (createGoal, planRepeatPatch). Settling, closing
// and period reads run whatever the switch says, and do nothing while no
// goal repeats (one query finds no repeating goal and returns).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  closesAt as periodClosesAt,
  defaultStart,
  firstBoundaryOnOrAfter,
  graceEndsAt as periodGraceEndsAt,
  isGoalCadence,
  isScored,
  kpiLastDayKey,
  kpiMonths,
  lastDayKey,
  lastNumbersDayKey,
  mayOpen,
  nextPeriod,
  nominalLastDayKey,
  openedAfterWindow,
  periodAt,
  periodFor,
  periodLabel,
  periodSettingsOf,
  planCadenceChange,
  restartPeriod,
  resultFor,
  startOfZonedDay,
  trackedFrom as trackedFromOf,
  daysLeft as periodDaysLeft,
  type GoalCadence,
  type GoalPeriodRange,
  type PeriodSettings,
} from "@/lib/goals/goal-period";
import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { hasConnectedSource, isMeasuredAutomatically, periodStartOf, targetDirection } from "@/lib/goals/goal-measure";
import { childContribution, childPeriodsHoldingClose, meanScore, unclampedProgress, type PeriodGraph } from "@/lib/goals/period-rollup";
import { kpiMonthValues, kpiValueForPeriod, latestPeriods, rowIsHand, type StoredPeriod } from "@/lib/goals/period-graph.server";
import { patchPeriodScore } from "@/lib/goals/goal-period-score.server";
import { pausedTooLong } from "@/lib/goals/goal-source";
import { notifyPeriodResults } from "@/lib/goals/goal-period-notify.server";
import { calculatePerformanceScore } from "@/services/performanceScoreService";
import { keyResultProgress, persistGoalRollupChains, computeGoalRollups } from "@/lib/alignment";
import { logActivity } from "@/lib/activity";
import { zonedDateKey } from "@/lib/zoned-time";
import { periodNameAtStart } from "@/lib/goals/goal-form";

type Db = Prisma.TransactionClient;

/* ───────────────────────── Words ───────────────────────── */

export const REPEAT_WITH_DUE_DATE = "A repeating goal has no due date. Choose when it ends instead.";
export const KPI_NEEDS_MONTHS = "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.";
export const CHECK_IN_INSTEAD = "Check in to change this period's number.";
export const REPEAT_HAS_HISTORY = "This goal has history. Stop it repeating and create a one-time goal instead.";
const REPEAT_VALUE = "Repeats every is weekly, monthly, quarterly or yearly.";
const NOT_REPEATING = "Starts and Ends are for a repeating goal.";
const START_IN_PAST = "Starts is this period or a later one, never a past one.";
const START_TOO_FAR = "Starts is at most 12 periods ahead.";
const STARTED = "This goal has started, so when it starts can no longer change.";
const MARK_COMPLETE = "A repeating goal is not marked complete. Choose Stop repeating instead.";

/** A refusal a route answers as it stands (400 or 409, with the words). */
export class GoalPeriodRefusal extends Error {
  readonly status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 409) {
    super(message);
    this.name = "GoalPeriodRefusal";
    this.status = status;
  }
}

/** At most this many periods opened per goal per run (B3); longer downtime catches up over the next runs. */
export const MAX_OPEN_PER_RUN = 24;
/** Goals settled per transaction: a month opening for a whole workspace is many short transactions, not one long one. */
export const CHUNK = 150;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Nov": a day key as the refusals name it. */
function dayWords(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ───────────────────────── Settings and locks ───────────────────────── */

/** The org's period settings (Settings > Locale: zone, week start, fiscal start). */
export async function orgPeriodSettings(orgId: string, db: Pick<Db, "organization"> = prisma): Promise<PeriodSettings> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return periodSettingsOf(org?.settings);
}

/**
 * One goal's lock, held to the end of the transaction, taken before any row
 * lock everywhere. hashtextextended keeps the whole id in the key (as the
 * punch route does), and the prefix keeps it apart from other locks.
 */
async function lockGoal(tx: Db, okrId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('goal-periods:' || ${okrId}, 0))`;
}

/**
 * Many goals' locks in ONE statement, taken in the order of their lock keys,
 * so two batches (or a batch and a single lock) can never wait on each other
 * in a circle. Re-entrant with lockGoal inside one transaction.
 */
async function lockGoals(tx: Db, okrIds: readonly string[]): Promise<void> {
  const ids = [...new Set(okrIds)];
  if (ids.length === 0) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(s.h) FROM (SELECT DISTINCT hashtextextended('goal-periods:' || k, 0) AS h FROM unnest(${ids}::text[]) AS k ORDER BY h) AS s`;
}

interface LockedPeriod {
  id: string;
  okrId: string;
  key: string;
  cadence: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  graceEndsAt: Date;
  closesAt: Date;
  scorePatchedAt: Date | null;
}

/** The period row, locked FOR UPDATE: a close and a check-in on it run one after the other. */
async function lockPeriodRow(tx: Db, periodId: string): Promise<LockedPeriod | null> {
  const rows = await tx.$queryRaw<LockedPeriod[]>`
    SELECT "id", "okrId", "key", "cadence", "status", "startsAt", "endsAt", "graceEndsAt", "closesAt", "scorePatchedAt"
    FROM "GoalPeriod" WHERE "id" = ${periodId} FOR UPDATE`;
  return rows[0] ?? null;
}

const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

/* ───────────────────────── Parsing the repeat fields ───────────────────────── */

export interface RepeatFields {
  /** undefined: not sent; null: one time; a cadence: repeating. */
  repeat: GoalCadence | null | undefined;
  repeatStart: string | undefined;
  /** undefined: not sent; null: never ends. */
  repeatUntil: string | null | undefined;
  /** A3 conversion: open the current period at the start value, or count what was added since it began. */
  firstPeriodStart: "start" | "change" | undefined;
}

/** The repeat fields of a POST or PATCH body, checked for shape only. */
export function parseRepeatFields(body: Record<string, unknown>): { ok: true; value: RepeatFields } | { ok: false; error: string } {
  const r = body.repeat;
  if (r !== undefined && r !== null && !isGoalCadence(r)) return { ok: false, error: REPEAT_VALUE };
  const s = body.repeatStart;
  if (s !== undefined && s !== null && !(typeof s === "string" && DAY_KEY.test(s))) return { ok: false, error: "Starts must be a period's first day (yyyy-mm-dd)." };
  const u = body.repeatUntil;
  if (u !== undefined && u !== null && !(typeof u === "string" && DAY_KEY.test(u))) return { ok: false, error: "Ends must be a day (yyyy-mm-dd), or empty for Never." };
  const f = body.firstPeriodStart;
  if (f !== undefined && f !== null && f !== "start" && f !== "change") return { ok: false, error: "The first period starts at the start value or at what was added since it began." };
  return {
    ok: true,
    value: {
      repeat: r === undefined ? undefined : (r as GoalCadence | null),
      repeatStart: typeof s === "string" ? s : undefined,
      repeatUntil: u === undefined ? undefined : (u as string | null),
      firstPeriodStart: f === "start" || f === "change" ? f : undefined,
    },
  };
}

/** Starts (A2): the period holding the chosen day, the current one or one of the next 12, never a past one. */
function resolveStart(cadence: GoalCadence, key: string | undefined, now: Date, s: PeriodSettings): GoalPeriodRange {
  if (!key) return defaultStart(cadence, now, s);
  const chosen = periodFor(cadence, startOfZonedDay(key, s.timezone), s);
  const current = periodFor(cadence, now, s);
  if (chosen.startsAt.getTime() < current.startsAt.getTime()) throw new GoalPeriodRefusal(START_IN_PAST, 400);
  let p = current;
  for (let i = 0; i < 12 && p.startsAt.getTime() < chosen.startsAt.getTime(); i++) p = periodFor(cadence, p.endsAt, s);
  if (chosen.startsAt.getTime() > p.startsAt.getTime()) throw new GoalPeriodRefusal(START_TOO_FAR, 400);
  return chosen;
}

/** UTC midnight of a period's first day (A1), so the readers that cut startDate to ten characters show 1 October. */
const startDateOf = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** The first period a goal that has not started yet will open: the one holding its startDate. */
function firstPeriodOf(cadence: GoalCadence, startDate: Date | null, createdAt: Date, s: PeriodSettings): GoalPeriodRange {
  return periodFor(cadence, startDate ? startOfZonedDay(startDate.toISOString().slice(0, 10), s.timezone) : createdAt, s);
}

/* ───────────────────────── createGoal (A1) ───────────────────────── */

export interface CreateGoalData {
  organizationId: string;
  title: string;
  description?: string | null;
  level: "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";
  quarter?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  ownerId?: string | null;
  departmentId?: string | null;
  parentId?: string | null;
  checkInCadence?: string;
}

export interface CreateGoalTarget {
  title: string;
  unit?: string | null;
  startValue: number;
  targetValue: number;
  currentValue?: number;
  kpiId?: string | null;
}

export type CreateGoalResult<T> = { ok: true; okr: T } | { ok: false; status: 400; error: string };

/**
 * Create a goal, one time or repeating (A1). A repeating goal: refused while
 * the switch is off, refused with a due date, refused weekly with a KPI
 * target (C6); its startDate holds UTC midnight of its first period's key,
 * its endDate stays null, and its first period opens here when it has
 * begun. The goal is made once: should the opening fail after it, the
 * answer is still the goal (logged), and the next read or the cron opens
 * the period, once (the unique key and the lock).
 */
export async function createGoal<T extends { id: string }>(input: {
  data: CreateGoalData;
  keyResults?: readonly CreateGoalTarget[];
  repeat?: unknown;
  repeatStart?: unknown;
  repeatUntil?: unknown;
  select?: Prisma.OKRSelect;
  now?: Date;
}): Promise<CreateGoalResult<T>> {
  const now = input.now ?? new Date();
  const parsed = parseRepeatFields({ repeat: input.repeat, repeatStart: input.repeatStart, repeatUntil: input.repeatUntil });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { repeat, repeatStart, repeatUntil } = parsed.value;
  const krs = input.keyResults ?? [];
  const data: Prisma.OKRUncheckedCreateInput = {
    organizationId: input.data.organizationId,
    title: input.data.title,
    description: input.data.description ?? null,
    level: input.data.level,
    quarter: input.data.quarter ?? null,
    startDate: input.data.startDate ?? null,
    endDate: input.data.endDate ?? null,
    ownerId: input.data.ownerId ?? null,
    departmentId: input.data.departmentId ?? null,
    parentId: input.data.parentId ?? null,
    ...(input.data.checkInCadence ? { checkInCadence: input.data.checkInCadence } : {}),
  };

  if (repeat) {
    if (!recurringGoalsOn()) return { ok: false, status: 400, error: RECURRING_GOALS_OFF };
    if (input.data.endDate) return { ok: false, status: 400, error: REPEAT_WITH_DUE_DATE };
    if (repeat === "WEEKLY" && krs.some((k) => k.kpiId)) return { ok: false, status: 400, error: KPI_NEEDS_MONTHS };
    const settings = await orgPeriodSettings(input.data.organizationId);
    let first: GoalPeriodRange;
    try {
      first = resolveStart(repeat, repeatStart, now, settings);
    } catch (e) {
      if (e instanceof GoalPeriodRefusal) return { ok: false, status: 400, error: e.message };
      throw e;
    }
    if (repeatUntil && repeatUntil < nominalLastDayKey(first, settings)) {
      return { ok: false, status: 400, error: `Ends is on or after the first period's last day, ${dayWords(nominalLastDayKey(first, settings))}.` };
    }
    data.repeat = repeat;
    data.repeatUntil = repeatUntil ?? null;
    data.startDate = startDateOf(first.key);
    data.endDate = null;
    // The first period's trackedFrom is the later of its start and this.
    data.createdAt = now;
  } else if (repeatStart !== undefined || repeatUntil != null) {
    return { ok: false, status: 400, error: NOT_REPEATING };
  }

  const okr = (await prisma.oKR.create({
    data: {
      ...data,
      ...(krs.length > 0
        ? {
            keyResults: {
              create: krs.map((kr) => ({
                title: kr.title,
                unit: kr.unit ?? null,
                startValue: kr.startValue,
                targetValue: kr.targetValue,
                // A repeating goal's target reads its start until a period
                // moves it (a count-down target carries its level, B4).
                ...(kr.currentValue !== undefined ? { currentValue: kr.currentValue } : repeat ? { currentValue: kr.startValue } : {}),
                kpiId: kr.kpiId ?? null,
                ...(repeat ? { createdAt: now } : {}),
              })),
            },
          }
        : {}),
    } as Prisma.OKRUncheckedCreateInput,
    ...(input.select ? { select: input.select } : {}),
  })) as unknown as T;

  if (repeat) {
    try {
      await settleGoalPeriods(input.data.organizationId, [okr.id], now);
    } catch (e) {
      console.error(`[goal-periods] a new goal's first period did not open (the next read or the cron opens it): ${errText(e)}`);
    }
  }
  return { ok: true, okr };
}

/* ───────────────────────── Opening periods (B3, B4) ───────────────────────── */

interface OpenTarget {
  id: string;
  title: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  kpiId: string | null;
  source: unknown;
  periodStart: string | null;
  /** A connected source's pause, carried onto a period opened while it lasts (C10). */
  sourcePausedReason: string | null;
  createdAt: Date;
  kpi: { direction: string | null; lowerIsBetter: boolean } | null;
}

interface OpenGoal {
  id: string;
  ownerId: string | null;
  repeat: string | null;
  repeatUntil: string | null;
  startDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  keyResults: OpenTarget[];
}

type OpenPeriod = GoalPeriodRange & { id: string; createdAt: Date; has: Set<string>; prevRows: Map<string, number | null> };

interface OpenState {
  goals: OpenGoal[];
  /** Each goal's latest period (by start), with its rows' values by target. */
  latest: Map<string, { range: GoalPeriodRange; rows: Map<string, number | null> }>;
  /** Each goal's OPEN periods, with the targets that already have a row. */
  open: Map<string, OpenPeriod[]>;
}

const GOAL_OPEN_SELECT = {
  id: true, ownerId: true, repeat: true, repeatUntil: true, startDate: true, createdAt: true, completedAt: true,
  keyResults: {
    select: {
      id: true, title: true, unit: true, startValue: true, targetValue: true, currentValue: true,
      kpiId: true, source: true, periodStart: true, sourcePausedReason: true, createdAt: true,
      kpi: { select: { direction: true, lowerIsBetter: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

/**
 * What the opening needs to know, in a bounded number of reads whatever the
 * number of goals: the goals, their open periods, their latest periods (one
 * DISTINCT ON), those periods' rows, and only when an open period misses a
 * row, the period before it. Inside a transaction (`lockRows`) the goal rows
 * are held FOR KEY SHARE first, so a goal cannot be deleted under the
 * inserts; one deleted before is not read.
 */
async function loadOpenState(db: Db, orgId: string, okrIds: readonly string[] | null, lockRows = false): Promise<OpenState> {
  let ids = okrIds ? [...okrIds] : null;
  if (lockRows && ids) {
    const held = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "OKR" WHERE "id" = ANY(${ids}) FOR KEY SHARE`;
    ids = held.map((r) => r.id);
  }
  const state: OpenState = { goals: [], latest: new Map(), open: new Map() };
  if (ids && ids.length === 0) return state;
  state.goals = (await db.oKR.findMany({
    where: { organizationId: orgId, repeat: { not: null }, ...(ids ? { id: { in: ids } } : {}) },
    select: GOAL_OPEN_SELECT,
  })) as unknown as OpenGoal[];
  if (state.goals.length === 0) return state;
  const goalIds = state.goals.map((g) => g.id);
  const [openPeriods, latest] = await Promise.all([
    db.goalPeriod.findMany({
      where: { okrId: { in: goalIds }, status: "OPEN" },
      orderBy: { startsAt: "asc" },
      select: { id: true, okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, createdAt: true },
    }),
    latestPeriods(db, goalIds),
  ]);
  const periodIds = new Set<string>();
  for (const p of openPeriods) periodIds.add(p.id);
  for (const p of latest) periodIds.add(p.id);
  const rows = periodIds.size
    ? await db.keyResultPeriod.findMany({ where: { periodId: { in: [...periodIds] } }, select: { keyResultId: true, periodId: true, currentValue: true } })
    : [];
  const rowsByPeriod = new Map<string, Map<string, number | null>>();
  const addRows = (list: Array<{ keyResultId: string | null; periodId: string; currentValue: number | null }>) => {
    for (const r of list) {
      if (!r.keyResultId) continue;
      let m = rowsByPeriod.get(r.periodId);
      if (!m) {
        m = new Map();
        rowsByPeriod.set(r.periodId, m);
      }
      m.set(r.keyResultId, r.currentValue);
    }
  };
  addRows(rows);
  const goalById = new Map(state.goals.map((g) => [g.id, g]));
  for (const p of latest) {
    if (!isGoalCadence(p.cadence)) continue;
    state.latest.set(p.okrId, { range: { key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt }, rows: rowsByPeriod.get(p.id) ?? new Map() });
  }
  // The period before an open one, read only for the open periods missing a row (its carry).
  const missing = openPeriods.filter((p) => {
    const has = rowsByPeriod.get(p.id);
    return (goalById.get(p.okrId)?.keyResults ?? []).some((k) => !(has?.has(k.id)) && k.createdAt.getTime() < p.endsAt.getTime());
  });
  const beforeByKey = new Map<string, string>();
  if (missing.length > 0) {
    const before = await db.goalPeriod.findMany({ where: { OR: missing.map((p) => ({ okrId: p.okrId, endsAt: p.startsAt })) }, select: { id: true, okrId: true, endsAt: true } });
    for (const b of before) beforeByKey.set(`${b.okrId}|${b.endsAt.getTime()}`, b.id);
    const unread = before.map((b) => b.id).filter((id) => !rowsByPeriod.has(id));
    if (unread.length) addRows(await db.keyResultPeriod.findMany({ where: { periodId: { in: unread } }, select: { keyResultId: true, periodId: true, currentValue: true } }));
  }
  for (const p of openPeriods) {
    if (!isGoalCadence(p.cadence)) continue;
    const prevId = beforeByKey.get(`${p.okrId}|${p.startsAt.getTime()}`);
    const entry: OpenPeriod = {
      id: p.id, key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt, createdAt: p.createdAt,
      has: new Set((rowsByPeriod.get(p.id) ?? new Map()).keys()),
      prevRows: prevId ? rowsByPeriod.get(prevId) ?? new Map() : new Map(),
    };
    const list = state.open.get(p.okrId);
    if (list) list.push(entry);
    else state.open.set(p.okrId, [entry]);
  }
  return state;
}

/** How one goal's opening is steered (a conversion or a restart opens with its own rules). */
export interface OpenOverride {
  /** The moment the goal became repeating or restarted: trackedFrom is the later of this and the period start. */
  since: Date;
  /** Restart after it ended (A4): from the current period, the skipped periods not invented. */
  restart?: boolean;
  /** A3 conversion: what each target opens the first period at. */
  initial?: Map<string, number>;
}

interface PlannedPeriod extends GoalPeriodRange {
  trackedFrom: Date;
  graceEndsAt: Date;
  closesAt: Date;
}

interface PlannedRow {
  okrId: string;
  /** Set for a new period (its id is read back), or the id of an open period missing the row. */
  periodKey: string;
  periodId?: string;
  keyResultId: string;
  title: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  carried: boolean;
  /** The KPI and the person this row reads, fixed at opening (C6, M6 of the review). */
  kpiId: string | null;
  kpiUserId: string | null;
  /** A connected source paused when the period opens stays paused from its start (C10). */
  pausedSince: Date | null;
  pausedReason: string | null;
}

interface GoalPlan {
  okrId: string;
  periods: PlannedPeriod[];
  rows: PlannedRow[];
}

const dirOf = (kr: OpenTarget) => targetDirection({ startValue: kr.startValue, targetValue: kr.targetValue, kpi: kr.kpi });

/** What a target opens a new period at (B4): its start value, or last period's number ("Carried from October"). */
function openingValue(kr: OpenTarget, prevValue: number | null | undefined, override?: OpenOverride): { value: number; carried: boolean } {
  const given = override?.initial?.get(kr.id);
  if (given !== undefined) return { value: given, carried: false };
  // A KPI or a connected source measures the period itself: it opens at its
  // start and the first read or count fills it (C3, C6). Opening counts
  // nothing, so a month opening for a whole workspace stays a fixed handful
  // of statements.
  if (kr.kpiId || hasConnectedSource(kr.source)) return { value: kr.startValue, carried: false };
  if (periodStartOf({ periodStart: kr.periodStart, direction: dirOf(kr) }) === "LAST") {
    if (prevValue != null) return { value: prevValue, carried: true };
    // No period before (a new or converted goal): the target's running number.
    return { value: kr.currentValue ?? kr.startValue, carried: false };
  }
  return { value: kr.startValue, carried: false };
}

function rowFor(goal: OpenGoal, kr: OpenTarget, periodKey: string, open: { value: number; carried: boolean }, periodId: string | undefined, startsAt: Date): PlannedRow {
  const paused = hasConnectedSource(kr.source) && kr.sourcePausedReason ? kr.sourcePausedReason : null;
  return {
    okrId: goal.id, periodKey, periodId, keyResultId: kr.id, title: kr.title, unit: kr.unit,
    startValue: kr.startValue, targetValue: kr.targetValue, currentValue: open.value,
    progress: keyResultProgress(kr.startValue, kr.targetValue, open.value, dirOf(kr)), carried: open.carried,
    kpiId: kr.kpiId, kpiUserId: kr.kpiId ? goal.ownerId : null,
    pausedSince: paused ? startsAt : null, pausedReason: paused,
  };
}

/** The periods and rows one goal needs now (pure, over what loadOpenState read). */
function planGoal(goal: OpenGoal, state: OpenState, s: PeriodSettings, now: Date, override?: OpenOverride): GoalPlan {
  const plan: GoalPlan = { okrId: goal.id, periods: [], rows: [] };
  if (!isGoalCadence(goal.repeat)) return plan;
  const cadence = goal.repeat;

  // Rows an OPEN period is missing (a target added since, or a crash
  // between the two inserts). Not a target added after the period ended
  // (B5: a target added during a previous period's grace gets a row only in
  // the current period).
  for (const p of state.open.get(goal.id) ?? []) {
    for (const kr of goal.keyResults) {
      if (p.has.has(kr.id) || kr.createdAt.getTime() >= p.endsAt.getTime()) continue;
      const carry = periodStartOf({ periodStart: kr.periodStart, direction: dirOf(kr) }) === "LAST" ? p.prevRows.get(kr.id) : null;
      const open = isMeasuredAutomatically(kr) ? { value: kr.startValue, carried: false } : carry != null ? { value: carry, carried: true } : { value: kr.startValue, carried: false };
      plan.rows.push(rowFor(goal, kr, p.key, open, p.id, p.startsAt));
    }
  }

  if (goal.completedAt && !override?.restart) return plan;
  const latest = state.latest.get(goal.id);
  const since = override?.since ?? goal.createdAt;
  let prev: GoalPeriodRange | null = latest?.range ?? null;
  let prevRows: Map<string, number | null> = latest?.rows ?? new Map();
  let next: GoalPeriodRange;
  if (override?.restart) next = restartPeriod(prev, cadence, now, s);
  else if (prev) next = nextPeriod(prev, cadence, s);
  else next = firstPeriodOf(cadence, goal.startDate, goal.createdAt, s);

  const stored: GoalPeriodRange[] = prev ? [prev] : [];
  while (next.startsAt.getTime() <= now.getTime() && plan.periods.length < MAX_OPEN_PER_RUN) {
    if (goal.repeatUntil && nominalLastDayKey(next, s) > goal.repeatUntil) break;
    if (!mayOpen(next, stored)) break;
    const values = new Map<string, number | null>();
    let kpiLinked = false;
    for (const kr of goal.keyResults) {
      if (kr.createdAt.getTime() >= next.endsAt.getTime()) continue;
      const open = openingValue(kr, prevRows.get(kr.id), plan.periods.length === 0 ? override : undefined);
      plan.rows.push(rowFor(goal, kr, next.key, open, undefined, next.startsAt));
      values.set(kr.id, open.value);
      if (kr.kpiId) kpiLinked = true;
    }
    plan.periods.push({
      ...next,
      trackedFrom: trackedFromOf(next, since),
      graceEndsAt: periodGraceEndsAt(next, s),
      // Held for the KPI month only when this period has a KPI row.
      closesAt: periodClosesAt(next, s, { kpiLinked }),
    });
    stored.push(next);
    prev = next;
    prevRows = values;
    next = nextPeriod(next, cadence, s);
  }
  return plan;
}

const hasWork = (p: GoalPlan) => p.periods.length > 0 || p.rows.length > 0;

/** Open the planned periods and rows of these goals, under their locks, re-planned on what the locks let it read. */
async function openPeriodsTx(
  tx: Db,
  orgId: string,
  okrIds: readonly string[],
  s: PeriodSettings,
  now: Date,
  overrides?: ReadonlyMap<string, OpenOverride>,
): Promise<{ opened: number; touched: string[] }> {
  const sorted = [...new Set(okrIds)].sort();
  await lockGoals(tx, sorted);
  const state = await loadOpenState(tx, orgId, sorted, true);
  const plans: GoalPlan[] = [];
  for (const g of state.goals) {
    const p = planGoal(g, state, s, now, overrides?.get(g.id));
    if (hasWork(p)) plans.push(p);
  }
  if (plans.length === 0) return { opened: 0, touched: [] };

  const newPeriods: Array<{ okrId: string; r: PlannedPeriod }> = [];
  for (const p of plans) for (const r of p.periods) newPeriods.push({ okrId: p.okrId, r });
  const idOf = new Map<string, string>();
  if (newPeriods.length > 0) {
    await tx.goalPeriod.createMany({
      data: newPeriods.map(({ okrId, r }) => ({
        okrId, organizationId: orgId, key: r.key, cadence: r.cadence, startsAt: r.startsAt, endsAt: r.endsAt,
        trackedFrom: r.trackedFrom, graceEndsAt: r.graceEndsAt, closesAt: r.closesAt, status: "OPEN", createdAt: now, updatedAt: now,
      })),
      skipDuplicates: true,
    });
    const written = await tx.goalPeriod.findMany({
      where: { okrId: { in: [...new Set(newPeriods.map((n) => n.okrId))] }, key: { in: [...new Set(newPeriods.map((n) => n.r.key))] } },
      select: { id: true, okrId: true, key: true, startsAt: true },
    });
    const byKey = new Map(written.map((w) => [`${w.okrId}|${w.key}`, w]));
    for (const { okrId, r } of newPeriods) {
      // Only the row this run cut: a key some older period already holds is never written into.
      const w = byKey.get(`${okrId}|${r.key}`);
      if (w && w.startsAt.getTime() === r.startsAt.getTime()) idOf.set(`${okrId}|${r.key}`, w.id);
    }
  }
  const rows: Array<PlannedRow & { periodId: string }> = [];
  for (const p of plans) {
    for (const r of p.rows) {
      const periodId = r.periodId ?? idOf.get(`${r.okrId}|${r.periodKey}`);
      if (periodId) rows.push({ ...r, periodId });
    }
  }
  if (rows.length > 0) {
    await tx.keyResultPeriod.createMany({
      data: rows.map((r) => ({
        keyResultId: r.keyResultId, periodId: r.periodId, title: r.title, unit: r.unit, startValue: r.startValue,
        targetValue: r.targetValue, currentValue: r.currentValue, progress: r.progress, carried: r.carried,
        kpiId: r.kpiId, kpiUserId: r.kpiUserId, pausedSince: r.pausedSince, pausedReason: r.pausedReason, createdAt: now, updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  // The mirror (B8): the current period's numbers on each hand-checked
  // target's KeyResult row, for the readers that read the row, in one
  // statement for the chunk.
  const isNow = (p: GoalPeriodRange) => p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime();
  const goalById = new Map(state.goals.map((g) => [g.id, g]));
  const mirrors: Array<{ id: string; value: number; progress: number }> = [];
  for (const plan of plans) {
    const g = goalById.get(plan.okrId)!;
    const key = plan.periods.find(isNow)?.key ?? (state.open.get(g.id) ?? []).find(isNow)?.key;
    if (!key) continue;
    const krById = new Map(g.keyResults.map((k) => [k.id, k]));
    for (const r of plan.rows) {
      if (r.periodKey !== key) continue;
      const kr = krById.get(r.keyResultId);
      if (!kr || kr.kpiId || kr.currentValue === r.currentValue) continue;
      mirrors.push({ id: kr.id, value: r.currentValue, progress: r.progress });
    }
  }
  await mirrorMany(tx, mirrors);
  return { opened: newPeriods.length, touched: plans.map((p) => p.okrId) };
}

/** The KeyResult mirror of the current period (B8). Called only from this module's writers. */
async function mirror(tx: Db, keyResultId: string, currentValue: number, progress: number): Promise<void> {
  await tx.keyResult.update({ where: { id: keyResultId }, data: { currentValue, progress } });
}

/** mirror() for many targets at once, in one statement. */
async function mirrorMany(tx: Db, list: ReadonlyArray<{ id: string; value: number; progress: number }>): Promise<void> {
  if (list.length === 0) return;
  const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = sorted.map((m) => m.id);
  const values = sorted.map((m) => m.value);
  const progress = sorted.map((m) => m.progress);
  await tx.$executeRaw`UPDATE "KeyResult" AS k SET "currentValue" = v."currentValue", "progress" = v."progress" FROM unnest(${ids}::text[], ${values}::float8[], ${progress}::int[]) AS v("id", "currentValue", "progress") WHERE k."id" = v."id"`;
}

/**
 * B3: open every missing period of these repeating goals (or every
 * repeating goal of the org, for null) up to now, and every OPEN period's
 * missing rows. Writes only when something is missing, CHUNK goals per
 * transaction, then the close holds and the org rollup once. Never closes
 * anything. A chunk that fails leaves the others standing; the first error
 * is thrown after them (a read path catches it: settleOnRead).
 */
export async function settleGoalPeriods(
  orgId: string,
  okrIds: readonly string[] | null,
  now: Date = new Date(),
  overrides?: ReadonlyMap<string, OpenOverride>,
): Promise<{ opened: number; touched: string[] }> {
  if (okrIds && okrIds.length === 0) return { opened: 0, touched: [] };
  const pre = await loadOpenState(prisma, orgId, okrIds);
  if (pre.goals.length === 0) return { opened: 0, touched: [] };
  const settings = await orgPeriodSettings(orgId);
  const needs = pre.goals.filter((g) => hasWork(planGoal(g, pre, settings, now, overrides?.get(g.id)))).map((g) => g.id).sort();
  if (needs.length === 0) return { opened: 0, touched: [] };
  let opened = 0;
  const touched: string[] = [];
  let failure: unknown = null;
  for (let i = 0; i < needs.length; i += CHUNK) {
    const chunk = needs.slice(i, i + CHUNK);
    try {
      const r = await prisma.$transaction((tx) => openPeriodsTx(tx, orgId, chunk, settings, now, overrides), TX_OPTS);
      opened += r.opened;
      for (const id of r.touched) touched.push(id);
    } catch (e) {
      failure ??= e;
    }
  }
  if (touched.length > 0) {
    await syncCloseHolds(orgId, touched, settings);
    await persistGoalRollupChains(orgId, touched, now);
  }
  if (failure) throw failure;
  return { opened, touched };
}

/**
 * settleGoalPeriods on a READ path (the list, Home, the goal page, the goal
 * route, assess, my-okrs, the profile, the periods route): a failure is
 * logged once and the read goes on with the stored numbers, which the next
 * read or the cron catches up.
 */
export async function settleOnRead(orgId: string, okrIds: readonly string[] | null, where: string, now: Date = new Date()): Promise<void> {
  try {
    await settleGoalPeriods(orgId, okrIds, now);
  } catch (e) {
    console.error(`[goal-periods] settling on ${where} failed; showing the stored numbers: ${errText(e)}`);
  }
}

/* ───────────────────────── Close holds (B7, D2) ───────────────────────── */

/**
 * Each OPEN period's closesAt: its own (its grace, or the KPI month when a
 * row of it reads a KPI), or later when a child's period the parent reads
 * is held later (a KPI-held Department goal holds its Company goal's close,
 * so the parent never freezes on a child still taking numbers). The child
 * periods that hold are the ones D2 reads for the parent on its cadence or
 * a finer one (childPeriodsHoldingClose): a quarterly goal waits for its
 * monthly child's December, never only for a child on its own cadence.
 * Recomputed for `goalIds` and every goal above them, deepest first. Never
 * moves the close of a period by a target that has no row in it, so an
 * ended period in its grace keeps its close when a KPI target is added.
 */
export async function syncCloseHolds(orgId: string, goalIds: readonly string[], settings?: PeriodSettings): Promise<void> {
  if (goalIds.length === 0) return;
  const s = settings ?? (await orgPeriodSettings(orgId));
  const goals = await prisma.oKR.findMany({ where: { organizationId: orgId }, select: { id: true, parentId: true, repeat: true } });
  const parentOf = new Map(goals.map((g) => [g.id, g.parentId]));
  const childrenOf = new Map<string, string[]>();
  for (const g of goals) {
    if (!g.parentId || !parentOf.has(g.parentId)) continue;
    const list = childrenOf.get(g.parentId);
    if (list) list.push(g.id);
    else childrenOf.set(g.parentId, [g.id]);
  }
  // The goals named, and every goal above them.
  const involved = new Set<string>();
  for (const id of goalIds) {
    let cursor: string | null | undefined = id;
    while (cursor && !involved.has(cursor)) {
      involved.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  const read = new Set(involved);
  for (const id of involved) for (const c of childrenOf.get(id) ?? []) read.add(c);
  const open = await prisma.goalPeriod.findMany({
    where: { okrId: { in: [...read] }, status: "OPEN" },
    select: { id: true, okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, closesAt: true, targets: { select: { kpiId: true } } },
  });
  const openByGoal = new Map<string, typeof open>();
  for (const p of open) {
    const list = openByGoal.get(p.okrId);
    if (list) list.push(p);
    else openByGoal.set(p.okrId, [p]);
  }
  const depth = (id: string) => {
    let d = 0;
    let cursor = parentOf.get(id);
    const seen = new Set<string>([id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      d += 1;
      cursor = parentOf.get(cursor);
    }
    return d;
  };
  const order = [...involved].sort((a, b) => depth(b) - depth(a));
  const updates: Array<{ id: string; closesAt: Date }> = [];
  for (const goalId of order) {
    for (const p of openByGoal.get(goalId) ?? []) {
      if (!isGoalCadence(p.cadence)) continue;
      const range = { key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt };
      let want = periodClosesAt(range, s, { kpiLinked: p.targets.some((t) => t.kpiId) }).getTime();
      for (const c of childrenOf.get(goalId) ?? []) {
        const typed = (openByGoal.get(c) ?? []).filter((cp) => isGoalCadence(cp.cadence)).map((cp) => ({ ...cp, cadence: cp.cadence as GoalCadence }));
        for (const cp of childPeriodsHoldingClose(typed, range, s)) want = Math.max(want, cp.closesAt.getTime());
      }
      if (want !== p.closesAt.getTime()) {
        p.closesAt = new Date(want);
        updates.push({ id: p.id, closesAt: p.closesAt });
      }
    }
  }
  if (updates.length === 0) return;
  await prisma.$transaction(updates.map((u) => prisma.goalPeriod.update({ where: { id: u.id }, data: { closesAt: u.closesAt } })));
}

/* ───────────────────────── writePeriodValue (B8) ───────────────────────── */

export type PeriodWriteMode = "checkin" | "edit" | "freeze" | "refresh";

/** What a source count writes on the row beside its number (C7, C10). */
export interface SourceRowFacts {
  refreshedAt?: Date;
  sourceSig?: string | null;
  sourceListCount?: number | null;
  pausedSince?: Date | null;
  pausedReason?: string | null;
}

/**
 * The 409 of a write into a period that no longer takes it (B7, final
 * review M4), naming the day it last took numbers, the same day the goal
 * page names ("Took numbers until 5 Oct"), never the day the cron closed it:
 * "September took its last numbers on 5 Oct. Its numbers are final." A
 * period past its grace that still waits for its KPI month refuses hand
 * check-ins only, and says so: "September took its last check-ins on 5
 * Oct. Its KPI numbers are taken until 31 Oct."
 */
function closedWords(p: { key: string; cadence: string; status: string; startsAt: Date; endsAt: Date; graceEndsAt: Date; closesAt: Date }, s: PeriodSettings, now: Date): string {
  if (!isGoalCadence(p.cadence)) return "That period takes no more numbers.";
  const range = { key: p.key, cadence: p.cadence, startsAt: p.startsAt, endsAt: p.endsAt };
  const label = periodLabel(range, s, now);
  const name = p.cadence === "MONTHLY" ? label.replace(/ \d{4}$/, "") : label;
  if (p.status === "OPEN" && now.getTime() < p.closesAt.getTime()) {
    const kpi = kpiLastDayKey(range, s);
    const grace = zonedDateKey(new Date(p.graceEndsAt.getTime() - 1), s.timezone);
    return `${name} took its last check-ins on ${dayWords(grace)}. ${kpi ? `Its KPI numbers are taken until ${dayWords(kpi)}.` : "Its final numbers are being saved."}`;
  }
  return `${name} took its last numbers on ${dayWords(lastNumbersDayKey({ ...range, graceEndsAt: p.graceEndsAt, closesAt: p.closesAt }, s))}. Its numbers are final.`;
}

/**
 * THE writer of a repeating goal's target numbers (B8). Inside the caller's
 * transaction: the goal's lock, then the period row FOR UPDATE; 409 unless
 * the period is OPEN and, for a hand check-in, started, before its
 * graceEndsAt and not on a row its KPI measures in that period; then the
 * row, the KeyResult mirror when the period is the current one, and a
 * carried row of the next period (still "Carried from October") follows a
 * late October number. A source count ("refresh", or "freeze" for a Right
 * now count's final number) writes its facts on the row too (`source`).
 */
export async function writePeriodValue(
  tx: Db,
  args: { okrId: string; keyResultId: string; periodId: string; value: number; mode: PeriodWriteMode; now: Date; settings: PeriodSettings; source?: SourceRowFacts },
): Promise<{ progress: number; periodKey: string }> {
  const { okrId, keyResultId, periodId, value, mode, now, settings } = args;
  if (!Number.isFinite(value)) throw new GoalPeriodRefusal("A number is needed.", 400);
  await lockGoal(tx, okrId);
  const p = await lockPeriodRow(tx, periodId);
  if (!p || p.okrId !== okrId) throw new GoalPeriodRefusal("That period was not found.", 404);
  if (p.status !== "OPEN") throw new GoalPeriodRefusal(closedWords(p, settings, now));
  if (mode === "checkin") {
    if (now.getTime() < p.startsAt.getTime()) throw new GoalPeriodRefusal("That period has not started yet.");
    if (now.getTime() >= p.graceEndsAt.getTime()) throw new GoalPeriodRefusal(closedWords(p, settings, now));
  }
  const kr = await tx.keyResult.findUnique({
    where: { id: keyResultId },
    select: { id: true, okrId: true, title: true, unit: true, startValue: true, targetValue: true, kpiId: true, kpi: { select: { direction: true, lowerIsBetter: true } }, okr: { select: { ownerId: true } } },
  });
  if (!kr || kr.okrId !== okrId) throw new GoalPeriodRefusal("Key Result not found", 404);
  let row = await tx.keyResultPeriod.findUnique({ where: { keyResultId_periodId: { keyResultId, periodId } } });
  if (!row) {
    // A row the opening never wrote (a crash between the inserts): made here, from the target.
    await tx.keyResultPeriod.createMany({
      data: [{
        keyResultId, periodId, title: kr.title, unit: kr.unit, startValue: kr.startValue, targetValue: kr.targetValue,
        currentValue: kr.startValue, progress: 0, kpiId: kr.kpiId, kpiUserId: kr.kpiId ? kr.okr.ownerId : null, createdAt: now, updatedAt: now,
      }],
      skipDuplicates: true,
    });
    row = await tx.keyResultPeriod.findUnique({ where: { keyResultId_periodId: { keyResultId, periodId } } });
    if (!row) throw new GoalPeriodRefusal("This target has no number in that period.");
  }
  if (mode === "checkin" && row.kpiId) throw new GoalPeriodRefusal(`"${kr.title}" is measured by its KPI in that period. Record the KPI number instead.`);
  const direction = targetDirection({ startValue: row.startValue, targetValue: row.targetValue, kpi: kr.kpi });
  const progress = keyResultProgress(row.startValue, row.targetValue, value, direction);
  await tx.keyResultPeriod.update({
    where: { id: row.id },
    data: { currentValue: value, progress, carried: mode === "edit" ? row.carried : false, ...(mode === "freeze" ? { frozenAt: now } : {}), ...(args.source ?? {}), updatedAt: now },
  });
  const isCurrent = p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime();
  if (isCurrent && !kr.kpiId && !row.kpiId) await mirror(tx, keyResultId, value, progress);

  // A late number for a period in its grace: the next period's row, while
  // it is still carried from this one, carries the new number.
  if (mode === "checkin" && !isCurrent && !kr.kpiId) {
    const next = await tx.goalPeriod.findFirst({ where: { okrId, startsAt: p.endsAt, status: "OPEN" }, select: { id: true, startsAt: true, endsAt: true } });
    if (next) {
      const carried = await tx.keyResultPeriod.findUnique({ where: { keyResultId_periodId: { keyResultId, periodId: next.id } } });
      if (carried?.carried) {
        const cp = keyResultProgress(carried.startValue, carried.targetValue, value, targetDirection({ startValue: carried.startValue, targetValue: carried.targetValue, kpi: kr.kpi }));
        await tx.keyResultPeriod.update({ where: { id: carried.id }, data: { currentValue: value, progress: cp, updatedAt: now } });
        if (next.startsAt.getTime() <= now.getTime() && now.getTime() < next.endsAt.getTime()) await mirror(tx, keyResultId, value, cp);
      }
    }
  }
  return { progress, periodKey: p.key };
}

/* ───────────────────────── Check-ins (C1, B7) ───────────────────────── */

/**
 * A hand check-in on a repeating goal (C1): into the current period, or the
 * one named by `periodKey` while it takes late numbers, the check-in and
 * the value in ONE transaction through writePeriodValue. Throws
 * GoalPeriodRefusal (409) outside the window.
 */
export async function checkInRepeating(args: {
  orgId: string;
  okrId: string;
  keyResultId: string;
  value: number;
  note: string | null;
  userId: string;
  periodKey?: string | null;
  now?: Date;
}): Promise<{ periodId: string; periodKey: string; krProgress: number }> {
  const now = args.now ?? new Date();
  await settleOnRead(args.orgId, [args.okrId], "a check-in", now);
  const settings = await orgPeriodSettings(args.orgId);
  let period: { id: string } | null;
  if (args.periodKey) {
    period = await prisma.goalPeriod.findUnique({ where: { okrId_key: { okrId: args.okrId, key: args.periodKey } }, select: { id: true } });
    if (!period) throw new GoalPeriodRefusal("That period was not found.", 404);
  } else {
    const stored = await prisma.goalPeriod.findMany({ where: { okrId: args.okrId, startsAt: { lte: now }, endsAt: { gt: now } }, select: { id: true, startsAt: true, endsAt: true } });
    period = periodAt(stored, now);
    if (!period) throw new GoalPeriodRefusal("This goal has no period running now. Its next one has not started.");
  }
  const periodId = period.id;
  const written = await prisma.$transaction(async (tx) => {
    const w = await writePeriodValue(tx, { okrId: args.okrId, keyResultId: args.keyResultId, periodId, value: args.value, mode: "checkin", now, settings });
    await tx.kRCheckIn.create({ data: { keyResultId: args.keyResultId, value: args.value, note: args.note, userId: args.userId, periodId, createdAt: now } });
    return w;
  }, TX_OPTS);
  return { periodId, periodKey: written.periodKey, krProgress: written.progress };
}

/* ───────────────────────── KPI links (C6) ───────────────────────── */

export const KPI_AFTER_WEEKS = "This goal still runs weekly for now. A KPI is recorded monthly, so link it once its first month starts.";

/**
 * L4's refusal, plain and fixable (final review product): when the weeks
 * end and the first month starts. "This goal runs weekly until 1 Nov. A KPI
 * is recorded monthly, so link it from 2 Nov."
 */
export function kpiAfterWeeksWords(firstMonthStarts: string | null): string {
  if (!firstMonthStarts) return KPI_AFTER_WEEKS;
  const [y, m, d] = firstMonthStarts.split("-").map(Number);
  const lastWeekDay = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return `This goal runs weekly until ${dayWords(lastWeekDay)}. A KPI is recorded monthly, so link it from ${dayWords(firstMonthStarts)}.`;
}

/**
 * Linking a KPI on someone else's goal needs the right to read the owner's
 * KPI numbers (final review privacy L2), said with who can fix it: "You can
 * link a KPI only when you can see Priya's KPI numbers. Ask Priya or their
 * manager to link it."
 */
export function kpiOwnerDeniedWords(ownerName: string | null | undefined): string {
  const who = ownerName?.trim();
  return who
    ? `You can link a KPI only when you can see ${who}'s KPI numbers. Ask ${who} or their manager to link it.`
    : "You can link a KPI only when you can see the owner's KPI numbers. Ask the owner or their manager to link it.";
}

/** kpiOwnerDeniedWords with the owner's first name read from their row. */
export async function kpiOwnerDenied(ownerId: string): Promise<string> {
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { firstName: true, lastName: true } });
  return kpiOwnerDeniedWords(owner?.firstName?.trim() || owner?.lastName?.trim() || null);
}

/**
 * C6 and A3: may a target of this goal read a KPI now? Not while a weekly
 * period runs or is still to come: a goal changed from weekly to a coarser
 * cadence keeps running whole weeks until the new cadence starts (A3), and a
 * KPI row in a week reads no month (kpiMonths is empty for a week), so the
 * target would read nothing all week and hold the week's close for a KPI
 * month (final review L4). Null when it may, else the refusal's words. A
 * week that has ended takes no new KPI row (the opening and a target edit
 * write only the period running now), so it holds nothing.
 */
export async function kpiLinkRefusal(orgId: string, okr: { id: string; repeat: string | null; completedAt?: Date | null }, now: Date = new Date()): Promise<string | null> {
  if (okr.repeat === "WEEKLY") return KPI_NEEDS_MONTHS;
  if (!isGoalCadence(okr.repeat)) return null;
  // An ended goal opens nothing more; a restart opens on its own cadence (restartPeriod).
  if (okr.completedAt) return null;
  const periods = await prisma.goalPeriod.findMany({
    where: { okrId: okr.id, OR: [{ endsAt: { gt: now } }, { status: "OPEN" }] },
    select: { cadence: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  });
  // The weeks still to run end where the new cadence's first period starts: the refusal names that day.
  const cadence = okr.repeat;
  const firstMonth = async (from: Pick<GoalPeriodRange, "cadence" | "endsAt">): Promise<string | null> => {
    const settings = await orgPeriodSettings(orgId);
    let p = from;
    for (let i = 0; i < 60 && p.cadence === "WEEKLY"; i++) p = nextPeriod(p, cadence, settings);
    return p.cadence === "WEEKLY" ? null : zonedDateKey((p as GoalPeriodRange).startsAt, settings.timezone);
  };
  const runningWeek = periods.filter((p) => p.cadence === "WEEKLY" && p.endsAt.getTime() > now.getTime()).pop();
  if (runningWeek) return kpiAfterWeeksWords(await firstMonth({ cadence: "WEEKLY", endsAt: runningWeek.endsAt }));
  // The periods not opened yet, up to the one holding now: still a week
  // while the new cadence has not started (a week that has already ended,
  // never opened because nobody read the goal, is stepped past).
  const latest = periods[periods.length - 1] ?? (await prisma.goalPeriod.findFirst({ where: { okrId: okr.id }, orderBy: { startsAt: "desc" }, select: { cadence: true, startsAt: true, endsAt: true } }));
  if (!latest || latest.cadence !== "WEEKLY") return null;
  const settings = await orgPeriodSettings(orgId);
  let p: Pick<GoalPeriodRange, "cadence" | "endsAt"> = { cadence: "WEEKLY", endsAt: latest.endsAt };
  for (let i = 0; i < 60 && p.cadence === "WEEKLY" && p.endsAt.getTime() <= now.getTime(); i++) p = nextPeriod(p, cadence, settings);
  return p.cadence === "WEEKLY" ? kpiAfterWeeksWords(await firstMonth(p)) : null;
}

/* ───────────────────────── Target edits (B5) ───────────────────────── */

/**
 * B5: a target's start, target, title, unit or KPI link changed. The
 * template is the caller's write; this updates the CURRENT open period's
 * row (a typo on day 1 is fixable today; a new KPI link reads from now),
 * never a closed one or one that has ended, re-reads its progress through
 * writePeriodValue, and returns the words for Activity.
 */
export async function applyTargetEditToPeriod(args: {
  orgId: string;
  okrId: string;
  keyResultId: string;
  before: { title: string; unit: string | null; startValue: number; targetValue: number; kpiId: string | null };
  after: { title: string; unit: string | null; startValue: number; targetValue: number; kpiId: string | null };
  ownerId: string | null;
  now?: Date;
}): Promise<string | null> {
  const now = args.now ?? new Date();
  await settleOnRead(args.orgId, [args.okrId], "a target edit", now);
  const settings = await orgPeriodSettings(args.orgId);
  const stored = await prisma.goalPeriod.findMany({ where: { okrId: args.okrId, status: "OPEN", startsAt: { lte: now }, endsAt: { gt: now } }, select: { id: true, key: true, cadence: true, startsAt: true, endsAt: true } });
  const current = periodAt(stored, now);
  if (current) {
    await prisma.$transaction(async (tx) => {
      await lockGoal(tx, args.okrId);
      const row = await tx.keyResultPeriod.findUnique({ where: { keyResultId_periodId: { keyResultId: args.keyResultId, periodId: current.id } } });
      if (!row) return;
      await tx.keyResultPeriod.update({
        where: { id: row.id },
        data: {
          title: args.after.title, unit: args.after.unit, startValue: args.after.startValue, targetValue: args.after.targetValue,
          kpiId: args.after.kpiId, kpiUserId: args.after.kpiId ? args.ownerId : null, updatedAt: now,
        },
      });
      await writePeriodValue(tx, { okrId: args.okrId, keyResultId: args.keyResultId, periodId: current.id, value: row.currentValue ?? args.after.startValue, mode: "edit", now, settings });
    }, TX_OPTS);
  }
  if (args.before.kpiId !== args.after.kpiId) await syncCloseHolds(args.orgId, [args.okrId], settings);
  if (!current) return null;
  const label = isGoalCadence(current.cadence) ? periodLabel({ ...current, cadence: current.cadence }, settings, now) : current.key;
  // The goal's Activity card shows these lines, so each names its target (final review M5).
  if (args.before.targetValue !== args.after.targetValue) return `${args.after.title}: target changed from ${args.before.targetValue} to ${args.after.targetValue} for ${label}`;
  if (args.before.startValue !== args.after.startValue) return `${args.after.title}: start changed from ${args.before.startValue} to ${args.after.startValue} for ${label}`;
  return null;
}

/**
 * Why each of these targets of a repeating goal can't be deleted yet (B5,
 * fixes review M1), by target id; a target that can go now is absent. A
 * period that has ended but not closed (in its grace, held for a KPI month,
 * or closing) still holds a row of it, and that row's number may still
 * change: kept with no target behind it, the close and the graph would read
 * it as a hand row, so a KPI row's quarter would fall back to its latest
 * month, a List row would read as checked in by hand, and a long pause
 * would no longer leave it out. So the delete waits for that close, and
 * says until when, naming the last day the period takes numbers (its KPI
 * day for a KPI hold), the day the goal page names. Of two such periods,
 * the one that closes last. The goal page reads it to say so before the
 * confirm; the delete reads it again under the goal's lock.
 */
export async function targetDeleteRefusals(
  db: Pick<Db, "goalPeriod" | "keyResultPeriod">,
  okrId: string,
  keyResultIds: readonly string[],
  settings: PeriodSettings,
  now: Date,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(keyResultIds)];
  if (ids.length === 0) return out;
  const ended = await db.goalPeriod.findMany({
    where: { okrId, status: "OPEN", endsAt: { lte: now } },
    orderBy: [{ closesAt: "desc" }, { startsAt: "desc" }],
    select: { id: true, key: true, cadence: true, startsAt: true, endsAt: true, graceEndsAt: true, closesAt: true },
  });
  if (ended.length === 0) return out;
  const held = await db.keyResultPeriod.findMany({ where: { periodId: { in: ended.map((p) => p.id) }, keyResultId: { in: ids } }, select: { keyResultId: true, periodId: true } });
  const periodsOf = new Map<string, Set<string>>();
  for (const r of held) {
    if (!r.keyResultId) continue;
    const set = periodsOf.get(r.keyResultId) ?? new Set<string>();
    set.add(r.periodId);
    periodsOf.set(r.keyResultId, set);
  }
  for (const [krId, periodIds] of periodsOf) {
    // `ended` is newest close first: the first holding the row is the one the delete waits for.
    const p = ended.find((x) => periodIds.has(x.id));
    if (p && isGoalCadence(p.cadence)) out.set(krId, deleteWaitWords({ ...p, cadence: p.cadence }, settings, now));
  }
  return out;
}

/**
 * The delete's wait (fixes review M1): "October still takes numbers until 5
 * Nov, so this target can't be deleted yet. Delete it after that." For a KPI
 * hold, the hold's last day ("until 30 Nov"). Past its close but not yet
 * frozen by the cron (twice an hour): "October is closing, so this target
 * can't be deleted yet. Try again in an hour."
 */
export function deleteWaitWords(p: GoalPeriodRange & { graceEndsAt: Date; closesAt: Date }, s: PeriodSettings, now: Date): string {
  const name = periodNameAtStart(periodLabel(p, s, now), p.cadence);
  if (now.getTime() >= p.closesAt.getTime()) return `${name} is closing, so this target can't be deleted yet. Try again in an hour.`;
  return `${name} still takes numbers until ${dayWords(lastNumbersDayKey(p, s))}, so this target can't be deleted yet. Delete it after that.`;
}

/**
 * B5: deleting a target of a repeating goal. Refused (409, GoalPeriodRefusal)
 * while a period that has ended but not closed still holds a row of it
 * (targetDeleteRefusals, fixes review M1), read under the goal's lock, so a
 * close and a delete run one after the other. Otherwise, in one transaction,
 * its rows in the periods that have not ended yet (the current one and any
 * later) go first, then the target, whose ON DELETE SET NULL keeps its rows
 * in the closed periods: their copied title and unit keep them readable, and
 * past results never change. Its check-ins go with it. A period running now
 * that was held for its KPI closes on its grace again (syncCloseHolds).
 */
export async function deleteRepeatingTarget(orgId: string, okrId: string, keyResultId: string, now: Date = new Date()): Promise<void> {
  const settings = await orgPeriodSettings(orgId);
  await prisma.$transaction(async (tx) => {
    await lockGoal(tx, okrId);
    const wait = (await targetDeleteRefusals(tx, okrId, [keyResultId], settings, now)).get(keyResultId);
    if (wait) throw new GoalPeriodRefusal(wait, 409);
    const open = await tx.goalPeriod.findMany({ where: { okrId, status: "OPEN", endsAt: { gt: now } }, select: { id: true } });
    if (open.length > 0) await tx.keyResultPeriod.deleteMany({ where: { keyResultId, periodId: { in: open.map((p) => p.id) } } });
    await tx.keyResult.delete({ where: { id: keyResultId } });
  }, TX_OPTS);
  await syncCloseHolds(orgId, [okrId]);
}

/* ───────────────────────── PATCH /api/okrs (A3, A4) ───────────────────────── */

export interface RepeatPatchPlan {
  /** Columns to set on the OKR row. */
  okrData: Prisma.OKRUncheckedUpdateInput;
  /** Period changes, run in the same transaction as the update, under the goal's lock. */
  apply: ((tx: Db) => Promise<void>) | null;
  /** How the opening in that transaction is steered (a conversion's first period, a restart). */
  open: OpenOverride | null;
  /** Activity lines to write after it. */
  activity: string[];
  /** The goal repeats after the update. */
  repeating: boolean;
}

type ConversionRecord = { repeatChange: "became_repeating"; previousStartDate: string | null; previousEndDate: string | null };

/**
 * The update rules of a goal's type, cadence, Starts and Ends (A3, A4), for
 * PATCH /api/okrs. Returns what to write, or a refusal. `updates` is the
 * route's already-filtered body; its startDate and endDate are removed here
 * for a repeating goal (a repeating goal has no due date; Starts moves
 * through repeatStart).
 */
export async function planRepeatPatch(args: {
  orgId: string;
  actorId: string;
  existing: { id: string; repeat: string | null; repeatUntil: string | null; endDate: Date | null; completedAt: Date | null; startDate: Date | null; createdAt: Date; ownerId: string | null };
  body: Record<string, unknown>;
  updates: Record<string, unknown>;
  now?: Date;
}): Promise<{ ok: true; plan: RepeatPatchPlan | null } | { ok: false; status: 400; error: string }> {
  const now = args.now ?? new Date();
  const parsed = parseRepeatFields(args.body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { repeat, repeatStart, repeatUntil, firstPeriodStart } = parsed.value;
  const stop = args.body.stopRepeating === true;
  const was = isGoalCadence(args.existing.repeat) ? args.existing.repeat : null;
  const next = repeat === undefined ? was : repeat;
  const refuse = (error: string) => ({ ok: false as const, status: 400 as const, error });
  const okrId = args.existing.id;

  // One time, staying one time.
  if (!was && !next) {
    if (repeatStart !== undefined || repeatUntil != null || stop || firstPeriodStart) return refuse(NOT_REPEATING);
    return { ok: true, plan: null };
  }

  const settings = await orgPeriodSettings(args.orgId);
  const goal = await prisma.oKR.findUnique({ where: { id: okrId }, select: { keyResults: { select: { id: true, kpiId: true, startValue: true, targetValue: true, currentValue: true, source: true, periodStart: true, createdAt: true, kpi: { select: { direction: true, lowerIsBetter: true } } } } } });
  const krs = goal?.keyResults ?? [];
  const kpiLinked = krs.some((k) => k.kpiId);
  const plan: RepeatPatchPlan = { okrData: {}, apply: null, open: null, activity: [], repeating: !!next };
  const word = (c: GoalCadence) => ({ WEEKLY: "weekly", MONTHLY: "monthly", QUARTERLY: "quarterly", YEARLY: "yearly" })[c];
  const marksComplete = "completed" in args.body || args.updates.status === "COMPLETED";

  // One time to Repeating (A3).
  if (!was && next) {
    if (!recurringGoalsOn()) return refuse(RECURRING_GOALS_OFF);
    if (args.updates.endDate) return refuse(REPEAT_WITH_DUE_DATE);
    if (marksComplete) return refuse(MARK_COMPLETE);
    if (next === "WEEKLY" && kpiLinked) return refuse(KPI_NEEDS_MONTHS);
    if (stop) return refuse("A goal that does not repeat yet has nothing to stop.");
    let first: GoalPeriodRange;
    try {
      first = resolveStart(next, repeatStart, now, settings);
    } catch (e) {
      if (e instanceof GoalPeriodRefusal) return refuse(e.message);
      throw e;
    }
    if (repeatUntil && repeatUntil < nominalLastDayKey(first, settings)) return refuse(`Ends is on or after the first period's last day, ${dayWords(nominalLastDayKey(first, settings))}.`);
    delete args.updates.startDate;
    delete args.updates.endDate;
    plan.okrData = { repeat: next, repeatUntil: repeatUntil ?? null, startDate: startDateOf(first.key), endDate: null, ...(args.existing.completedAt ? { completedAt: null } : {}) };
    // The dates the goal had, kept with the change (A3 undo, review M5).
    const record: ConversionRecord = {
      repeatChange: "became_repeating",
      previousStartDate: args.existing.startDate?.toISOString() ?? null,
      previousEndDate: args.existing.endDate?.toISOString() ?? null,
    };
    const description = args.existing.endDate
      ? `Due date ${dayWords(args.existing.endDate.toISOString().slice(0, 10))} removed when this goal became ${word(next)}`
      : `This goal became ${word(next)}`;
    plan.apply = async (tx) => {
      await tx.activityLog.create({ data: { type: "okr_updated", actorId: args.actorId, organizationId: args.orgId, description, targetId: okrId, targetType: "okr", metadata: record } });
    };
    if (first.startsAt.getTime() <= now.getTime()) {
      // Every target starts the first period by its own rule (B4): its
      // start value, or a count-down target's current level. "What was
      // added since 1 Oct" counts an up-counting target's change, and only
      // where the number at the period start is known (never the whole
      // running total): the last check-in before the start, or, for a
      // target added after the period began, its start value (it held that
      // at the start; step 3 review M4).
      // Check-ins made before keep no period.
      const initial = new Map<string, number>();
      if (firstPeriodStart === "change") {
        const before = await prisma.kRCheckIn.findMany({
          where: { keyResultId: { in: krs.map((k) => k.id) }, createdAt: { lt: first.startsAt } },
          orderBy: { createdAt: "desc" },
          distinct: ["keyResultId"],
          select: { keyResultId: true, value: true },
        });
        const atStart = new Map(before.map((c) => [c.keyResultId, c.value]));
        for (const k of krs) {
          if (isMeasuredAutomatically(k) || targetDirection(k) !== "HIGHER") continue;
          const was0 = atStart.get(k.id) ?? (k.createdAt.getTime() >= first.startsAt.getTime() ? k.startValue : undefined);
          if (was0 === undefined || k.currentValue === was0) continue;
          initial.set(k.id, k.startValue + (k.currentValue - was0));
        }
      }
      plan.open = { since: now, initial };
    }
    return { ok: true, plan };
  }

  // From here the goal repeated before. Its missing periods open first, so
  // "the current period" is the stored one holding now.
  await settleOnRead(args.orgId, [okrId], "a goal update", now);
  const periods = await prisma.goalPeriod.findMany({
    where: { okrId },
    orderBy: { startsAt: "asc" },
    select: { id: true, key: true, cadence: true, startsAt: true, endsAt: true, status: true },
  });
  const closedAny = periods.some((p) => p.status === "CLOSED");
  const typed = periods.filter((p) => isGoalCadence(p.cadence)).map((p) => ({ ...p, cadence: p.cadence as GoalCadence }));
  const holding = periodAt(typed, now);
  const latest = typed[typed.length - 1] ?? null;
  const current = holding ?? latest;

  // Repeating to One time (A3): only while no period has ended (closed, or
  // ended and still taking late or KPI numbers: discarding that one would
  // delete a finished period's result, final review L6). Its open
  // period is discarded (its check-ins stay in Activity with no period, ON
  // DELETE SET NULL). A goal made repeating by mistake, with nothing checked
  // into its period, goes back to the numbers and the start date it had;
  // one with check-ins keeps the period's numbers, and Activity says so.
  if (was && !next) {
    if (closedAny || periods.some((p) => p.endsAt.getTime() <= now.getTime())) return refuse(REPEAT_HAS_HISTORY);
    plan.okrData = { repeat: null, repeatUntil: null };
    plan.repeating = false;
    const checkIns = periods.length ? await prisma.kRCheckIn.count({ where: { periodId: { in: periods.map((p) => p.id) } } }) : 0;
    const restore: Array<{ id: string; value: number; progress: number }> = [];
    if (checkIns === 0) {
      const hand = krs.filter((k) => !isMeasuredAutomatically(k));
      const lastBefore = hand.length
        ? await prisma.kRCheckIn.findMany({ where: { keyResultId: { in: hand.map((k) => k.id) }, periodId: null }, orderBy: { createdAt: "desc" }, distinct: ["keyResultId"], select: { keyResultId: true, value: true } })
        : [];
      const lastBy = new Map(lastBefore.map((c) => [c.keyResultId, c.value]));
      for (const k of hand) {
        const value = lastBy.get(k.id) ?? k.startValue;
        restore.push({ id: k.id, value, progress: keyResultProgress(k.startValue, k.targetValue, value, targetDirection(k)) });
      }
      const record = await prisma.activityLog.findFirst({
        where: { organizationId: args.orgId, targetId: okrId, targetType: "okr", metadata: { path: ["repeatChange"], equals: "became_repeating" } },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      });
      const r = record?.metadata as ConversionRecord | null | undefined;
      if (r) {
        if (!("startDate" in args.updates)) plan.okrData.startDate = r.previousStartDate ? new Date(r.previousStartDate) : null;
        if (!("endDate" in args.updates) && r.previousEndDate) plan.okrData.endDate = new Date(r.previousEndDate);
      }
    } else if (current) {
      plan.activity.push(`Stopped repeating. Targets keep ${periodLabel(current, settings, now)}'s numbers.`);
    }
    plan.apply = async (tx) => {
      await tx.goalPeriod.deleteMany({ where: { okrId } });
      for (const m of restore) await mirror(tx, m.id, m.value, m.progress);
    };
    return { ok: true, plan };
  }

  const cadence = next as GoalCadence;
  if (args.updates.endDate) return refuse(REPEAT_WITH_DUE_DATE);
  delete args.updates.startDate;
  delete args.updates.endDate;
  if (marksComplete) return refuse(MARK_COMPLETE);
  const applies: Array<(tx: Db) => Promise<void>> = [];

  // Repeats every (A3): from the first boundary of the new cadence on or
  // after the current period's end; the current period is never cut short.
  if (repeat && repeat !== was) {
    if (!recurringGoalsOn()) return refuse(RECURRING_GOALS_OFF);
    if (repeat === "WEEKLY" && kpiLinked) return refuse(KPI_NEEDS_MONTHS);
    plan.okrData.repeat = repeat;
    if (holding && holding.status === "OPEN") {
      const change = planCadenceChange(holding, repeat, settings);
      if (change.currentEndsAt.getTime() !== holding.endsAt.getTime()) {
        // A stretched period keeps its name and nominal last day; its grace
        // and its close are recomputed from the new end (and the close holds
        // run again after the update).
        const stretched = { cadence: holding.cadence, startsAt: holding.startsAt, endsAt: change.currentEndsAt };
        const grace = periodGraceEndsAt(stretched, settings);
        applies.push(async (tx) => {
          const rows = await tx.keyResultPeriod.findMany({ where: { periodId: holding.id }, select: { kpiId: true } });
          const closes = periodClosesAt(stretched, settings, { kpiLinked: rows.some((r) => r.kpiId) });
          await tx.goalPeriod.update({ where: { id: holding.id }, data: { endsAt: change.currentEndsAt, graceEndsAt: grace, closesAt: closes } });
        });
      }
    } else if (!holding && typed.length === 0 && args.existing.startDate) {
      // Not started yet: Starts moves to the new cadence's first boundary on or after it.
      const at = startOfZonedDay(args.existing.startDate.toISOString().slice(0, 10), settings.timezone);
      const b = firstBoundaryOnOrAfter(repeat, at, settings);
      plan.okrData.startDate = startDateOf(periodFor(repeat, b, settings).key);
    }
  }

  // Starts (A3): editable while the first period is the only one (moving it
  // later then discards that period); refused once a second has opened.
  if (repeatStart !== undefined) {
    if (!recurringGoalsOn()) return refuse(RECURRING_GOALS_OFF);
    if (closedAny || typed.length > 1) return refuse(STARTED);
    let chosen: GoalPeriodRange;
    try {
      chosen = resolveStart(cadence, repeatStart, now, settings);
    } catch (e) {
      if (e instanceof GoalPeriodRefusal) return refuse(e.message);
      throw e;
    }
    const first = typed[0];
    if (!first || first.key !== chosen.key) {
      if (first && chosen.startsAt.getTime() < first.startsAt.getTime()) return refuse(START_IN_PAST);
      plan.okrData.startDate = startDateOf(chosen.key);
      if (first) {
        applies.push(async (tx) => {
          await tx.goalPeriod.delete({ where: { id: first.id } });
          // Nothing runs now: each target that starts every period at its
          // start value reads it again. One that starts at last period's
          // number (B4, a level such as "open bugs") keeps its level, which
          // the new first period opens at (final review L9): reading it back
          // to its baseline would open the new period at 30 open bugs.
          for (const k of krs) {
            if (k.kpiId || periodStartOf({ periodStart: k.periodStart, direction: targetDirection(k) }) === "LAST") continue;
            await mirror(tx, k.id, k.startValue, keyResultProgress(k.startValue, k.targetValue, k.startValue, targetDirection(k)));
          }
        });
      }
      if (chosen.startsAt.getTime() <= now.getTime()) plan.open = { since: now };
    }
  }

  // The owner changed: the period running now reads the new owner's KPI
  // records; a period that has ended keeps the person it was opened for.
  if ("ownerId" in args.updates && (args.updates.ownerId ?? null) !== args.existing.ownerId && holding && holding.status === "OPEN") {
    const owner = (args.updates.ownerId as string | null) ?? null;
    applies.push(async (tx) => {
      await tx.keyResultPeriod.updateMany({ where: { periodId: holding.id, kpiId: { not: null } }, data: { kpiUserId: owner } });
    });
  }

  // Ends and Stop repeating (A4). Before the goal has started, Ends is read
  // against its first period, as at create.
  let until = repeatUntil;
  if (stop) {
    if (args.existing.completedAt) return refuse("This goal has already stopped repeating.");
    if (!current) return refuse("This goal has not started yet. Change when it starts, or delete it.");
    until = nominalLastDayKey(current, settings);
  }
  if (until !== undefined) {
    const ended = !!args.existing.completedAt;
    if (ended) {
      if (!recurringGoalsOn()) return refuse(RECURRING_GOALS_OFF);
      // Restart from the current period (restartPeriod); the skipped periods are not invented.
      const restart = restartPeriod(latest, cadence, now, settings);
      if (until && until < nominalLastDayKey(restart, settings)) return refuse(`Ends is on or after ${dayWords(nominalLastDayKey(restart, settings))}.`);
      plan.okrData.completedAt = null;
      plan.open = { since: now, restart: true };
    } else {
      const reference = current ?? firstPeriodOf(cadence, plan.okrData.startDate instanceof Date ? plan.okrData.startDate : args.existing.startDate, args.existing.createdAt, settings);
      const last = nominalLastDayKey(reference, settings);
      if (until && until < last) {
        return refuse(current
          ? `The current period always finishes. Choose Ends on or after ${dayWords(last)}.`
          : `Ends is on or after the first period's last day, ${dayWords(last)}.`);
      }
    }
    plan.okrData.repeatUntil = until;
  }

  if (applies.length > 0) plan.apply = async (tx) => { for (const a of applies) await a(tx); };
  return { ok: true, plan };
}

/**
 * Run a PATCH's period plan in ONE transaction: the OKR update, the period
 * changes, and the opening (a conversion's first period with its own
 * numbers and trackedFrom, a restart from the current period), so no
 * settle can land between the update and the opening and open it the
 * ordinary way. The close holds run after it; the route persists the rollup.
 */
export async function applyRepeatPatch(orgId: string, okrId: string, plan: RepeatPatchPlan, updates: Prisma.OKRUncheckedUpdateInput, now: Date = new Date()): Promise<void> {
  const settings = await orgPeriodSettings(orgId);
  const opened = await prisma.$transaction(async (tx) => {
    await lockGoal(tx, okrId);
    await tx.oKR.update({ where: { id: okrId }, data: { ...updates, ...plan.okrData } });
    if (plan.apply) await plan.apply(tx);
    if (!plan.repeating) return null;
    return openPeriodsTx(tx, orgId, [okrId], settings, now, plan.open ? new Map([[okrId, plan.open]]) : undefined);
  }, TX_OPTS);
  if (plan.repeating) await syncCloseHolds(orgId, [okrId, ...(opened?.touched ?? [])], settings);
}

/** Activity lines of a period plan. */
export function logRepeatActivity(orgId: string, actorId: string, okrId: string, lines: readonly string[]): void {
  for (const description of lines) {
    logActivity({ type: "okr_updated", actorId, organizationId: orgId, description, targetId: okrId, targetType: "okr" });
  }
}

/* ───────────────────────── Closing (B3, B6, B7, D2) ───────────────────────── */

/** Each goal's depth below its root (a root is 0), over the org's parent links. */
function depthsOf(goals: ReadonlyArray<{ id: string; parentId: string | null }>): Map<string, number> {
  const parent = new Map(goals.map((g) => [g.id, g.parentId]));
  const out = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const known = out.get(id);
    if (known !== undefined) return known;
    const p = parent.get(id);
    if (!p || !parent.has(p) || seen.has(p)) return 0;
    seen.add(id);
    const d = depth(p, seen) + 1;
    out.set(id, d);
    return d;
  };
  for (const g of goals) out.set(g.id, depth(g.id, new Set()));
  return out;
}

export interface CloseRunResult {
  closed: number;
  scorePatched: number;
  failed: number;
}

/**
 * The cron's close (B3): every OPEN period of the org whose closesAt has
 * passed, deepest goals first, the graph (and the one-time children as of
 * each period's end) read once per level. One period failing is logged and
 * counted and never stops the others; the score patch retries next run.
 */
export async function closeDuePeriods(orgId: string, now: Date = new Date()): Promise<CloseRunResult> {
  const result: CloseRunResult = { closed: 0, scorePatched: 0, failed: 0 };
  const due = await prisma.goalPeriod.findMany({
    where: { organizationId: orgId, status: "OPEN", closesAt: { lte: now } },
    select: { id: true, okrId: true, startsAt: true },
    orderBy: { startsAt: "asc" },
  });
  const touched = new Set<string>();
  if (due.length > 0) {
    const settings = await orgPeriodSettings(orgId);
    const all = await prisma.oKR.findMany({ where: { organizationId: orgId }, select: { id: true, parentId: true } });
    const depth = depthsOf(all);
    const levels = [...new Set(due.map((d) => depth.get(d.okrId) ?? 0))].sort((a, b) => b - a);
    for (const level of levels) {
      const here = due.filter((x) => (depth.get(x.okrId) ?? 0) === level);
      // One last count of this level's windowed List sources (C3), before
      // its closes: ONE pass scoped to these goals and periods (not one
      // org-wide pass per period), written through writePeriodValue while
      // the periods are still OPEN, and no rollup of its own (the close
      // stores one at the end). A Right now count was frozen at the first
      // run after the end, and a paused one keeps its number. A count that
      // fails keeps the stored numbers: the close never waits on a source.
      await finalCountOf(orgId, here, now);
      let ctx: Awaited<ReturnType<typeof computeGoalRollups>>;
      try {
        // Read again for each level, so a parent reads the children this run just froze.
        ctx = await computeGoalRollups(orgId, now);
      } catch (e) {
        result.failed += here.length;
        console.error(`[goal-periods] reading the goals to close failed: ${errText(e)}`);
        continue;
      }
      for (const d of here) {
        try {
          if (await closeOnePeriod(d.id, now, settings, ctx)) {
            result.closed += 1;
            touched.add(d.okrId);
          }
        } catch (e) {
          result.failed += 1;
          console.error(`[goal-periods] a period did not close (the next run tries again): ${errText(e)}`);
        }
      }
    }
  }
  // The score patch, exactly once per closed period, retried until it has run.
  const unpatched = await prisma.goalPeriod.findMany({
    where: { organizationId: orgId, status: "CLOSED", scorePatchedAt: null },
    select: { id: true },
    orderBy: { closesAt: "asc" },
  });
  const patched: string[] = [];
  for (const p of unpatched) {
    try {
      if (await patchScoreOnce(p.id, now)) {
        result.scorePatched += 1;
        patched.push(p.id);
      }
    } catch (e) {
      result.failed += 1;
      console.error(`[goal-periods] a score patch failed (the next run tries again): ${errText(e)}`);
    }
  }
  // The results (F): one Inbox row per owner for what this run finished. A
  // patch runs once, so a period is reported once.
  if (patched.length > 0) {
    try {
      await notifyPeriodResults(orgId, patched, now);
    } catch (e) {
      result.failed += 1;
      console.error(`[goal-periods] the results rows were not written: ${errText(e)}`);
    }
  }
  if (touched.size > 0) {
    try {
      await persistGoalRollupChains(orgId, [...touched], now);
    } catch (e) {
      result.failed += 1;
      console.error(`[goal-periods] storing the rollup after the close failed (the next read stores it): ${errText(e)}`);
    }
  }
  return result;
}

/**
 * The final count of one level's closing periods (C3, C5, C7): their
 * windowed List and table sources, counted once more, together. Scoped to the level's goals
 * and periods, so the count reads only their targets (never every sourced
 * target of the workspace once per period), and with no rollup (the close
 * stores one for everything it closed). Never throws: a failure is logged
 * and the periods close on the stored numbers.
 */
async function finalCountOf(orgId: string, here: ReadonlyArray<{ id: string; okrId: string }>, now: Date): Promise<void> {
  if (here.length === 0) return;
  try {
    // Loaded here, at a close: the count reads the List engine, which no
    // other path of this module needs (and which imports server-only code).
    const { refreshGoalSources } = await import("@/lib/goals/goal-source.server");
    await refreshGoalSources(orgId, {
      okrIds: [...new Set(here.map((d) => d.okrId))], periodIds: here.map((d) => d.id),
      force: true, windowedOnly: true, rollup: false, now,
    });
  } catch (e) {
    console.error(`[goal-periods] the final count of the closing periods' sources failed (they close on the stored numbers): ${errText(e)}`);
  }
}

async function closeOnePeriod(
  periodId: string,
  now: Date,
  settings: PeriodSettings,
  ctx: Awaited<ReturnType<typeof computeGoalRollups>>,
): Promise<boolean> {
  const meta = await prisma.goalPeriod.findUnique({ where: { id: periodId }, select: { okrId: true, cadence: true, startsAt: true, endsAt: true } });
  if (!meta || !isGoalCadence(meta.cadence)) return false;
  const range = { cadence: meta.cadence, startsAt: meta.startsAt, endsAt: meta.endsAt };
  const goal = await prisma.oKR.findUnique({
    where: { id: meta.okrId },
    select: { id: true, organizationId: true, repeat: true, repeatUntil: true, completedAt: true, keyResults: { select: { id: true, source: true, kpi: { select: { direction: true, lowerIsBetter: true } } } } },
  });
  if (!goal || !isGoalCadence(goal.repeat)) return false;
  // Read outside the locks (step 1 of the close): the KPI months' numbers
  // of the KPI and person each row was opened for. Its List sources had
  // their last count with the rest of its level (finalCountOf).
  const identities = await prisma.keyResultPeriod.findMany({ where: { periodId, kpiId: { not: null } }, select: { kpiId: true, kpiUserId: true } });
  const kpiValues = await kpiMonthValues(identities.map((r) => ({ kpiId: r.kpiId as string, userId: r.kpiUserId, months: kpiMonths(range, settings) })));
  const graph: PeriodGraph | null = ctx.periodGraph ? { ...ctx.periodGraph, now, memo: new Map() } : null;
  const children = graph ? graph.childrenOf.get(goal.id) ?? [] : [];

  return prisma.$transaction(async (tx) => {
    await lockGoal(tx, goal.id);
    const p = await lockPeriodRow(tx, periodId);
    if (!p || p.status !== "OPEN" || !isGoalCadence(p.cadence)) return false;
    const cadence = p.cadence;
    // A child's period this one reads, on its cadence or a finer one, still
    // held open (a KPI month) holds this close too (review L1, final review
    // M1): the close moves to the child's. A quarter waits for its monthly
    // children's December, not only for a quarterly child.
    if (children.length > 0) {
      const held = await tx.goalPeriod.findMany({
        where: { okrId: { in: [...children] }, status: "OPEN", closesAt: { gt: now }, startsAt: { lt: p.endsAt }, endsAt: { gt: p.startsAt } },
        select: { okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, closesAt: true },
      });
      const byChild = new Map<string, Array<(typeof held)[number] & { cadence: GoalCadence }>>();
      for (const h of held) {
        if (!isGoalCadence(h.cadence)) continue;
        const list = byChild.get(h.okrId) ?? [];
        list.push({ ...h, cadence: h.cadence });
        byChild.set(h.okrId, list);
      }
      let hold = 0;
      const self = { key: p.key, cadence, startsAt: p.startsAt, endsAt: p.endsAt };
      for (const list of byChild.values()) {
        for (const h of childPeriodsHoldingClose(list, self, settings)) hold = Math.max(hold, h.closesAt.getTime());
      }
      if (hold > 0) {
        await tx.goalPeriod.update({ where: { id: periodId }, data: { closesAt: new Date(hold) } });
        return false;
      }
    }
    const full = await tx.goalPeriod.findUnique({ where: { id: periodId }, select: { trackedFrom: true, createdAt: true, graceEndsAt: true } });
    if (!full) return false;
    const rows = await tx.keyResultPeriod.findMany({ where: { periodId }, select: { id: true, keyResultId: true, startValue: true, targetValue: true, currentValue: true, kpiId: true, kpiUserId: true, pausedSince: true } });
    const late = openedAfterWindow({ graceEndsAt: full.graceEndsAt }, full.createdAt);
    const krById = new Map(goal.keyResults.map((k) => [k.id, k]));
    const parts: Array<{ progress: number; attainment: number }> = [];
    for (const r of rows) {
      const kr = r.keyResultId ? krById.get(r.keyResultId) : undefined;
      const fromKpi = kpiValueForPeriod(kpiValues, r, kr?.source, { cadence, startsAt: p.startsAt, endsAt: p.endsAt }, settings);
      const value = fromKpi ?? r.currentValue ?? r.startValue;
      // Freeze: every row through the one writer. A delete now waits for
      // this close (fixes review M1), so a row with no target is only one
      // left by the delete as it was before: it freezes in place, at the
      // number the close counts for it.
      if (r.keyResultId) await writePeriodValue(tx, { okrId: goal.id, keyResultId: r.keyResultId, periodId, value, mode: "freeze", now, settings });
      else await freezeDeletedTargetRow(tx, r, value, now);
      // B6: a hand-checked target in a period opened after its window is left
      // out, and so is a source paused for more than half the period (C10).
      if (rowIsHand(r, kr) && late) continue;
      if (kr && hasConnectedSource(kr.source) && pausedTooLong(r, p, now)) continue;
      const a = unclampedProgress(r.startValue, r.targetValue, value, targetDirection({ startValue: r.startValue, targetValue: r.targetValue, kpi: kr?.kpi ?? null }));
      parts.push({ progress: Math.max(0, Math.min(100, a)), attainment: a });
    }
    // Each measured child's contribution for this period (D2), from the
    // graph read after the deeper goals closed; a one-time child as of this
    // period's end.
    if (graph) {
      const self = { id: periodId, key: p.key, cadence, startsAt: p.startsAt, endsAt: p.endsAt, status: "OPEN", progress: null, attainment: null, targets: [] };
      for (const childId of children) {
        const c = childContribution(childId, self, graph);
        if (c.progress != null) parts.push({ progress: c.progress, attainment: c.attainment ?? c.progress });
      }
    }
    const score = meanScore(parts);
    const result = resultFor(score.progress);
    const scored = isScored({ result, startsAt: p.startsAt, endsAt: p.endsAt, trackedFrom: full.trackedFrom, openedAfterWindow: late });
    await tx.goalPeriod.update({
      where: { id: periodId },
      data: { status: "CLOSED", closedAt: now, progress: score.progress, attainment: score.attainment, result, scored, updatedAt: now },
    });
    // The goal ends at its final close (A4: Stop repeating, or its Ends).
    if (goal.repeatUntil && !goal.completedAt) {
      const later = await tx.goalPeriod.count({ where: { okrId: goal.id, startsAt: { gte: p.endsAt } } });
      const following = nextPeriod({ cadence, endsAt: p.endsAt }, goal.repeat as GoalCadence, settings);
      if (later === 0 && nominalLastDayKey(following, settings) > goal.repeatUntil) {
        await tx.oKR.update({ where: { id: goal.id }, data: { completedAt: now, status: "COMPLETED" } });
      }
    }
    return true;
  }, TX_OPTS);
}

/**
 * The close of a row whose target was deleted while its period had ended but
 * not closed (B5, final review M3; since fixes review M1 a delete waits for
 * the close, so only a row left before that): its number and progress as
 * the close counts them, and frozenAt, on the row alone (no target is left
 * to mirror onto). Part of this module's one writer of period numbers (B8),
 * called only by closeOnePeriod under the period's lock.
 */
async function freezeDeletedTargetRow(
  tx: Db,
  r: { id: string; startValue: number; targetValue: number },
  value: number,
  now: Date,
): Promise<void> {
  const progress = keyResultProgress(r.startValue, r.targetValue, value, targetDirection({ startValue: r.startValue, targetValue: r.targetValue, kpi: null }));
  await tx.keyResultPeriod.update({ where: { id: r.id }, data: { currentValue: value, progress, frozenAt: now, updatedAt: now } });
}

/**
 * The score patch of one closed period, exactly once (B3 step 3, G): the
 * row FOR UPDATE, and only while scorePatchedAt is still null, the patch
 * (goal-period-score.server.ts) and, when it asked for no recalculation, the
 * stamp, in one transaction. A month the server is still in asks for the
 * service's own recalculation instead, after the commit; the stamp is
 * written only once every one of those has run (final review L10), so a
 * recalculation that fails is tried again by the next run, never lost. The
 * patch of a running month writes no row (it only names the people), so
 * running it again is harmless, and the stamp's `scorePatchedAt: null`
 * guard lets one run alone report it. Throws when a recalculation fails, so
 * the run counts it.
 */
export async function patchScoreOnce(periodId: string, now: Date = new Date()): Promise<boolean> {
  const done = await prisma.$transaction(async (tx) => {
    const p = await lockPeriodRow(tx, periodId);
    if (!p || p.status !== "CLOSED" || p.scorePatchedAt) return null;
    const out = (await patchPeriodScore(tx, periodId, now)) ?? { recalculate: [] };
    if (out.recalculate.length === 0) await tx.goalPeriod.update({ where: { id: periodId }, data: { scorePatchedAt: now } });
    return out;
  }, TX_OPTS);
  if (!done) return false;
  if (done.recalculate.length === 0) return true;
  // A month still running on the server (G2): the service's own
  // recalculation, after the commit, so it reads the period just frozen and
  // the weeks still open.
  for (const r of done.recalculate) {
    try {
      await calculatePerformanceScore(r.userId, r.organizationId);
    } catch (e) {
      console.error(`[goal-periods] recomputing a running month's score failed (the next run tries again): ${errText(e)}`);
      throw e;
    }
  }
  const stamped = await prisma.goalPeriod.updateMany({ where: { id: periodId, status: "CLOSED", scorePatchedAt: null }, data: { scorePatchedAt: now } });
  return stamped.count > 0;
}

/* ───────────────────────── The closer's dead-man check (B3) ───────────────────────── */

/** How long past its close a period may wait for the goal-periods cron (it runs twice an hour) before it counts as stuck. */
export const STALE_CLOSE_MS = 2 * 60 * 60 * 1000;

/**
 * Every OPEN period, in every workspace, more than two hours past its
 * closesAt (final review M6). The goal-periods cron is the only closer and
 * runs twice an hour, so any such period means its crontab row is missing
 * or the run keeps failing: nothing closes, results never reach the score,
 * and every read keeps more open periods. okr-reminders, an installed job,
 * counts them and alerts ops (the "status", "closesAt" index).
 */
export async function staleCloseCount(now: Date = new Date()): Promise<number> {
  return prisma.goalPeriod.count({ where: { status: "OPEN", closesAt: { lt: new Date(now.getTime() - STALE_CLOSE_MS) } } });
}

/* ───────────────────────── Reading periods ───────────────────────── */

export type PeriodState = "open" | "grace" | "closing" | "closed";

/** Where a stored period stands at `now` (E2, I): open, taking late numbers, past its close and waiting for the cron, or closed. */
export function periodState(p: { status: string; endsAt: Date; graceEndsAt: Date; closesAt: Date }, now: Date): PeriodState {
  if (p.status === "CLOSED") return "closed";
  if (now.getTime() < p.endsAt.getTime()) return "open";
  if (now.getTime() < p.closesAt.getTime()) return "grace";
  return "closing";
}

/** The current period as GET /api/okrs carries it (I). */
export interface CurrentPeriodPayload {
  key: string;
  label: string;
  startsAt: string;
  endsAt: string;
  graceEndsAt: string;
  closesAt: string;
  trackedFrom: string;
  daysLeft: number;
  state: PeriodState;
  /** Its last day, yyyy-mm-dd in the workspace zone (the list's Due sort and filter, E1). */
  lastDay: string;
  /** The last day of the nominal period it stands for (B2): Ends and Stop repeating compare against it. */
  nominalLastDay: string;
  /** The day the next period starts, yyyy-mm-dd in the workspace zone ("Resets 1 Nov", E1, E4). */
  resetsOn: string;
}

type PayloadPeriod = Pick<StoredPeriod, "key" | "cadence" | "startsAt" | "endsAt" | "graceEndsAt" | "closesAt" | "trackedFrom" | "status">;

/** The stored period a repeating goal shows for now: the one holding now, else the latest that has started. */
export function currentStoredPeriod<T extends PayloadPeriod>(periods: readonly T[], now: Date): T | null {
  const holding = periodAt(periods, now);
  if (holding) return holding;
  let p: T | null = null;
  for (const x of periods) if (x.startsAt.getTime() <= now.getTime() && (!p || x.startsAt > p.startsAt)) p = x;
  return p;
}

export function currentPeriodPayload(periods: readonly PayloadPeriod[], settings: PeriodSettings, now: Date): CurrentPeriodPayload | null {
  const p = currentStoredPeriod(periods, now);
  if (!p) return null;
  return {
    key: p.key,
    label: periodLabel(p, settings, now),
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    graceEndsAt: p.graceEndsAt.toISOString(),
    closesAt: p.closesAt.toISOString(),
    trackedFrom: p.trackedFrom.toISOString(),
    daysLeft: periodDaysLeft(p, now, settings),
    state: periodState(p, now),
    lastDay: lastDayKey(p, settings),
    nominalLastDay: nominalLastDayKey(p, settings),
    resetsOn: zonedDateKey(p.endsAt, settings.timezone),
  };
}

/** One goal's current period as the create and update answers carry it (I), or null for a one-time goal. */
export async function currentPeriodFor(orgId: string, okrId: string, now: Date = new Date()): Promise<CurrentPeriodPayload | null> {
  const periods = await prisma.goalPeriod.findMany({
    where: { okrId },
    orderBy: { startsAt: "asc" },
    select: { key: true, cadence: true, startsAt: true, endsAt: true, graceEndsAt: true, closesAt: true, trackedFrom: true, status: true },
  });
  const typed = periods.filter((p) => isGoalCadence(p.cadence)).map((p) => ({ ...p, cadence: p.cadence as GoalCadence }));
  if (typed.length === 0) return null;
  return currentPeriodPayload(typed, await orgPeriodSettings(orgId), now);
}

/** Re-exported for the close holds of the key-results routes. */
export async function recomputeOpenCloses(orgId: string, okrId: string): Promise<void> {
  await syncCloseHolds(orgId, [okrId]);
}
