// Counting a target from a List (docs/plans/recurring-goals.md C3, C7, C8,
// C10): the count, the connector's checks, the pause, and the refresh that
// stores the number on the period (or, for a one-time goal, on the target).
//
// ONE ENGINE (C3). A target counts on the dashboard stat card's engine, not a
// new one: the Lists resolve through widget-data.ts sourceResolver and
// resolveListScope (the Lists' own tasks and the tasks linked into them, each
// once), the rows load through loadWidgetRows, and every filter rule runs in
// memory through applyWidgetFilter, in the WORKSPACE zone (one number for
// everyone). Only the window, top-level tasks, not archived and not system
// items run in SQL. The cap is 20,000 rows after the window; over it the
// source pauses ("Too many tasks to count. Narrow the filter."): a goal feeds
// the score, so it never shows a silently cut number.
//
// COUNTED BY. Done date reads ItemCompletion (one row per completion, so an
// "After completion" task done four times in October counts 4, and a status
// rule matches the status the completion entered while every other rule
// matches the task now); Created date, Due date and a Date field compare
// day keys in the workspace zone (goal-source.ts dateKeyOf); Right now has
// no window, and its final number is stored at the first cron run after the
// period's end (frozenAt), so a bug closed on 2 November leaves October alone.
//
// WHOSE ACCESS (C8): the person who connected it (KeyResult.sourceById).
// Every count first reads their User row (deleted or INACTIVE pauses: "Priya
// no longer works here. Reconnect it."), builds their Viewer and decides List
// and Space access with nodeCtxFromViewer (which honors a denied person),
// and checks Can edit on the goal with canEditGoal on a session built from
// that row. Any check that fails pauses the source (C10): the last counted
// number stands, the row reads "Paused", the first pause sends ONE
// goal_source_paused Inbox row to the owner and the connector, and a source
// that comes back resumes on its own. A source paused for more than half a
// period is left out of that period's progress and score.
//
// WHEN (C7). The number is STORED, so the list never counts anything: the
// goal-periods cron (every open period counted more than 50 minutes ago,
// grouped by connector, oldest first, inside a time budget, a signature
// skipping a recount when nothing changed), the goal page (counted more
// than 10 minutes ago, for people who may check in), Refresh in the row
// menu, and one last count at the close.
//
// Server-only (prisma).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { actingPerson, type ActingPerson } from "@/lib/access/acting-person";
import { nodeCtxFromViewer, nodeRole, nodeRoleMap } from "@/lib/access/node-access";
import { nodeCtxFromLevel, roleAtLeast } from "@/lib/access/node-rules";
import type { Viewer } from "@/lib/access/types";
import { canEditGoal } from "@/lib/alignment-scope";
import { keyResultProgress, persistGoalRollupChains } from "@/lib/alignment";
import { listReader, resolveListScope, type LinkViewer } from "@/lib/list-links-server";
import { loadWidgetRows, sourceResolver, type WidgetReader } from "@/lib/dashboards/widget-data";
import { applyWidgetFilter, type WidgetRow } from "@/lib/dashboards/widget-math";
import { parseBoardSchema } from "@/lib/field-catalog";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { logActivity } from "@/lib/activity";
import { isGoalCadence, type PeriodSettings } from "@/lib/goals/goal-period";
import { targetDirection } from "@/lib/goals/goal-measure";
import { GoalPeriodRefusal, orgPeriodSettings, writePeriodValue } from "@/lib/goals/goal-periods.server";
import {
  aggregateRows,
  dateKeyOf,
  fieldPrefixes,
  GOAL_DATE_TYPES,
  GOAL_NUMBER_TYPES,
  goalDatesWindow,
  isWindowed,
  keyInWindow,
  LIST_SOURCE_CAP,
  listCountChangeWords,
  looseInstantRange,
  parseListSource,
  PAUSE,
  periodWindow,
  PRIVATE_LIST_WORDS,
  serializeListSource,
  sourceSignature,
  widgetSourceOf,
  type ListSource,
  type SourceWindow,
} from "@/lib/goals/goal-source";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

/* ───────────────────────── The connector (C8) ───────────────────────── */

/** The person a source counts as, checked. */
export interface Connector {
  id: string;
  firstName: string | null;
  viewer: Viewer;
  link: LinkViewer;
  /** A session built from their User row, for canEditGoal. */
  session: ActingPerson["session"];
}

export type ConnectorCheck = { ok: true; connector: Connector } | { ok: false; reason: string };

/**
 * C8: the connector's User row first (deleted, deactivated or not in this
 * workspace pauses the source), then their Viewer at the level they hold
 * here now (access/acting-person.ts). Read once per connector per run (the
 * cron groups sources by it).
 */
export async function connectorFor(orgId: string, userId: string): Promise<ConnectorCheck> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, firstName: true, status: true, deletedAt: true } });
  const name = row?.firstName?.trim() || null;
  if (!row || row.deletedAt || row.status === "INACTIVE") return { ok: false, reason: PAUSE.left(name) };
  const acting = await actingPerson(orgId, userId);
  if (!acting || acting.viewer.deleted || acting.viewer.status === "INACTIVE") return { ok: false, reason: PAUSE.left(name) };
  return { ok: true, connector: { id: row.id, firstName: name, viewer: acting.viewer, link: acting.link, session: acting.session } };
}

/**
 * The source's Lists or Space as the connector may open them now, with
 * nodeCtxFromViewer (never nodeCtxFromLevel, which cannot deny a removed
 * person). Null when they may; else the pause's words.
 */
export async function sourceAccessProblem(orgId: string, source: ListSource, c: Connector): Promise<string | null> {
  const ctx = nodeCtxFromViewer(c.viewer);
  if (source.kind === "space") {
    const space = await prisma.space.findFirst({ where: { id: source.spaceId ?? "", organizationId: orgId }, select: { id: true, archivedAt: true } });
    if (!space || space.archivedAt) return PAUSE.spaceGone;
    const role = (await nodeRole(ctx, { kind: "space", id: space.id })).role;
    return roleAtLeast(role, "VIEW") ? null : PAUSE.lostSpace(c.firstName);
  }
  const boards = await prisma.board.findMany({ where: { id: { in: source.listIds }, organizationId: orgId }, select: { id: true, archivedAt: true } });
  if (boards.length !== source.listIds.length) return PAUSE.listGone;
  if (boards.some((b) => b.archivedAt)) return PAUSE.listArchived;
  const roles = await nodeRoleMap(ctx, "list", source.listIds);
  return source.listIds.every((id) => roleAtLeast(roles.get(id) ?? "none", "VIEW")) ? null : PAUSE.lostList(c.firstName);
}

/**
 * C9: is every List the source names readable by any member of the
 * workspace (a member with no grant of their own)? The target editor says
 * "Everyone who can see this goal will see this number." when it is not.
 */
export async function sourceOpenToWorkspace(orgId: string, source: ListSource): Promise<boolean> {
  const ctx = nodeCtxFromLevel("workspace-member", orgId, "EMPLOYEE");
  if (source.kind === "space") return roleAtLeast((await nodeRole(ctx, { kind: "space", id: source.spaceId ?? "" })).role, "VIEW");
  const roles = await nodeRoleMap(ctx, "list", source.listIds);
  return source.listIds.every((id) => roleAtLeast(roles.get(id) ?? "none", "VIEW"));
}

/** Can this viewer open the source (its name, its settings, its tasks)? C9's question, on the page. */
export async function viewerCanOpenSource(orgId: string, source: ListSource, viewer: Viewer): Promise<boolean> {
  const ctx = nodeCtxFromViewer(viewer);
  if (source.kind === "space") return roleAtLeast((await nodeRole(ctx, { kind: "space", id: source.spaceId ?? "" })).role, "VIEW");
  const roles = await nodeRoleMap(ctx, "list", source.listIds);
  return source.listIds.every((id) => roleAtLeast(roles.get(id) ?? "none", "VIEW"));
}

/**
 * H: connecting (or reconnecting) a source needs Can view on its Lists or
 * Space at that moment, by the person connecting it; its fields must be
 * fields of those Lists (a number field to add up, a Date field to count
 * by). The goal's Can edit is the route's own gate. Null when it may be
 * connected, else the 400's words.
 */
export async function connectSourceProblem(orgId: string, userId: string, source: ListSource): Promise<string | null> {
  const conn = await connectorFor(orgId, userId);
  if (!conn.ok) return "You can't connect a source right now.";
  const denied = await sourceAccessProblem(orgId, source, conn.connector);
  if (denied) return source.kind === "space" ? "You can only count from a Space you can open." : "You can only count from Lists you can open.";
  if (source.metric.op === "count" && source.countedBy !== "field") return null;
  const r: WidgetReader = { ctx: conn.connector.link, viewer: conn.connector.viewer, zone: "UTC", now: new Date() };
  const ids = (await sourceResolver(r)(widgetSourceOf(source))) ?? [];
  const boards = ids.length ? await prisma.board.findMany({ where: { id: { in: ids } }, select: { schema: true } }) : [];
  const fields = boards.flatMap((b) => parseBoardSchema(b.schema).fields);
  if (source.metric.op !== "count") {
    const key = source.metric.fieldKey;
    if (!fields.some((f) => f.key === key && GOAL_NUMBER_TYPES.has(String(f.type)))) return "Choose a number field of these Lists to add up.";
  }
  if (source.countedBy === "field" && !fields.some((f) => f.key === source.dateFieldKey && GOAL_DATE_TYPES.has(String(f.type)))) {
    return "Choose a Date field of these Lists to count by.";
  }
  return null;
}

/* ───────────────────────── The count (C3) ───────────────────────── */

export type CountOutcome =
  | { kind: "paused"; reason: string }
  | { kind: "same"; sig: string; listCount: number }
  | { kind: "counted"; value: number | null; listCount: number; spaceName: string | null; sig: string };

/**
 * One source counted over one window as its connector. `prevSig` skips the
 * recount when the signature has not moved (the cron); without it the count
 * always runs. A null window counts "Right now".
 */
export async function countListSource(args: {
  orgId: string;
  source: ListSource;
  connector: Connector;
  window: SourceWindow | null;
  zone: string;
  now: Date;
  prevSig?: string | null;
}): Promise<CountOutcome> {
  const { orgId, source, connector: c, zone, now } = args;
  const denied = await sourceAccessProblem(orgId, source, c);
  if (denied) return { kind: "paused", reason: denied };
  const r: WidgetReader = { ctx: c.link, viewer: c.viewer, zone, now };
  const reader = listReader(c.link);
  const ids = await sourceResolver(r, reader)(widgetSourceOf(source));
  if (!ids) return { kind: "paused", reason: source.kind === "space" ? PAUSE.lostSpace(c.firstName) : PAUSE.lostList(c.firstName) };
  const scope = await resolveListScope(c.link, ids, reader);
  const listIds = scope.lists.map((l) => l.id);
  const spaceName = source.kind === "space"
    ? (await prisma.space.findUnique({ where: { id: source.spaceId ?? "" }, select: { name: true } }))?.name ?? null
    : null;

  // The fields it adds up or counts by must still exist on a List it reads.
  if (listIds.length > 0 && (source.metric.op !== "count" || source.countedBy === "field")) {
    const boards = await prisma.board.findMany({ where: { id: { in: listIds } }, select: { schema: true } });
    const fields = boards.flatMap((b) => parseBoardSchema(b.schema).fields);
    if (source.metric.op !== "count") {
      const key = source.metric.fieldKey;
      if (!fields.some((f) => f.key === key && GOAL_NUMBER_TYPES.has(String(f.type)))) return { kind: "paused", reason: PAUSE.fieldGone };
    }
    if (source.countedBy === "field" && !fields.some((f) => f.key === source.dateFieldKey && GOAL_DATE_TYPES.has(String(f.type)))) {
      return { kind: "paused", reason: PAUSE.dateFieldGone };
    }
  }

  const window = source.countedBy === "now" ? null : args.window;
  const linked = [...scope.listsByItem.keys()];
  const base: Prisma.ItemWhereInput = { AND: [scope.where, { organizationId: orgId, archivedAt: null, parentItemId: null, ...NOT_SYSTEM_ITEMS }] };
  const completionScope: Prisma.ItemCompletionWhereInput = {
    organizationId: orgId,
    OR: [{ boardId: { in: listIds } }, ...(linked.length ? [{ itemId: { in: linked } }] : [])],
  };

  // The signature (C7): what the scope holds and when it last changed, the
  // newest completion, the settings and the window, and the day (so a
  // change nothing stamps, such as a tag, is caught by the next day).
  const [items, done] = await Promise.all([
    prisma.item.aggregate({ where: base, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.itemCompletion.aggregate({ where: completionScope, _count: { _all: true }, _max: { doneAt: true } }),
  ]);
  const sig = sourceSignature([
    JSON.stringify(serializeListSource(source)), listIds.join(","), linked.length,
    window?.firstKey ?? "", window?.lastKey ?? "", zone, dateKeyOf(now, zone),
    countOf(items._count), items._max.updatedAt?.toISOString() ?? "", countOf(done._count), done._max.doneAt?.toISOString() ?? "",
  ]);
  if (args.prevSig && args.prevSig === sig) return { kind: "same", sig, listCount: listIds.length };
  if (listIds.length === 0) return { kind: "counted", value: aggregateRows([], source.metric), listCount: 0, spaceName, sig };

  const needsTags = source.filter.rules.some((x) => x.field === "tags");
  let rows: WidgetRow[];
  if (source.countedBy === "done") {
    // One row per completion inside the window, of a task in scope now.
    const range = window ? looseInstantRange(window) : {};
    const completions = await prisma.itemCompletion.findMany({
      where: { ...completionScope, ...(range.gte || range.lt ? { doneAt: range } : {}) },
      take: LIST_SOURCE_CAP + 1,
      select: { itemId: true, status: true, doneAt: true },
    });
    if (completions.length > LIST_SOURCE_CAP) return { kind: "paused", reason: PAUSE.tooMany };
    const inside = window ? completions.filter((x) => keyInWindow(dateKeyOf(x.doneAt, zone), window)) : completions;
    const taskIds = [...new Set(inside.map((x) => x.itemId))];
    const loaded = taskIds.length
      ? await loadWidgetRows(r, scope, { where: { AND: [base, { id: { in: taskIds } }] }, cap: LIST_SOURCE_CAP, needsTags }, reader)
      : null;
    const byId = new Map((loaded?.rows ?? []).map((x) => [x.id, x]));
    rows = [];
    for (const x of inside) {
      const task = byId.get(x.itemId);
      if (task) rows.push({ ...task, status: x.status, done: true });
    }
  } else {
    let where: Prisma.ItemWhereInput = base;
    if (window && source.countedBy === "created") where = { AND: [base, { createdAt: looseInstantRange(window) }] };
    if (window && source.countedBy === "due") where = { AND: [base, { dueAt: looseInstantRange(window) }] };
    if (window && source.countedBy === "field") {
      const prefixes = fieldPrefixes(window);
      const key = source.dateFieldKey ?? "";
      // A linked task keeps its value under the List's own key, which no
      // path names here: linked tasks are read whole and tested in memory.
      if (prefixes) where = { AND: [base, { OR: [...prefixes.map((p) => ({ metadata: { path: [key], string_starts_with: p } })), ...(linked.length ? [{ id: { in: linked } }] : [])] }] };
    }
    const loaded = await loadWidgetRows(r, scope, { where, cap: LIST_SOURCE_CAP, needsTags }, reader);
    if (loaded.truncated) return { kind: "paused", reason: PAUSE.tooMany };
    rows = loaded.rows;
    if (window && source.countedBy === "created") rows = rows.filter((x) => keyInWindow(dateKeyOf(x.createdAt, zone), window));
    if (window && source.countedBy === "due") rows = rows.filter((x) => keyInWindow(dateKeyOf(x.dueAt, zone), window));
    if (window && source.countedBy === "field") rows = rows.filter((x) => keyInWindow(dateKeyOf(x.metadata[source.dateFieldKey ?? ""], zone), window));
  }
  const kept = applyWidgetFilter(rows, source.filter, zone);
  return { kind: "counted", value: aggregateRows(kept, source.metric), listCount: listIds.length, spaceName, sig };
}

function countOf(c: unknown): number {
  if (typeof c === "number") return c;
  const o = c as { _all?: number } | null;
  return o?._all ?? 0;
}

/* ───────────────────────── The refresh (C7, C10) ───────────────────────── */

export interface RefreshOptions {
  now?: Date;
  /** Only these goals' targets. */
  okrIds?: readonly string[];
  /** Only these targets. */
  keyResultIds?: readonly string[];
  /** Only these periods' rows (the close's final count). */
  periodIds?: readonly string[];
  /** Count even when counted recently or the signature has not moved (Refresh in the row menu, the close). */
  force?: boolean;
  /** Skip a target counted less than this long ago (the cron 50 minutes, the goal page 10). */
  minAgeMs?: number;
  /** The cron: a Right now count's final number, at the first run after the period's end. */
  freezeRightNow?: boolean;
  /** Windowed sources only (the close). */
  windowedOnly?: boolean;
  /** Stop starting new counts after this long; the rest wait for the next run. */
  budgetMs?: number;
}

export interface RefreshResult {
  counted: number;
  paused: number;
  skipped: number;
  /** Goals whose stored number moved. */
  changed: string[];
}

interface Job {
  kr: TargetRow;
  source: ListSource;
  /** A period row of a repeating goal, or null for a one-time goal's target. */
  row: PeriodRowFacts | null;
  mode: "refresh" | "freeze";
  window: SourceWindow | null;
  lastAt: number;
}

type TargetRow = Prisma.KeyResultGetPayload<{ select: typeof TARGET_SELECT }>;
type PeriodRowFacts = Prisma.KeyResultPeriodGetPayload<{ select: typeof ROW_SELECT }>;

const TARGET_SELECT = {
  id: true, okrId: true, title: true, startValue: true, targetValue: true, currentValue: true, source: true, sourceById: true,
  sourcePausedReason: true, sourceRefreshedAt: true,
  kpi: { select: { direction: true, lowerIsBetter: true } },
  okr: { select: { id: true, title: true, level: true, ownerId: true, repeat: true, startDate: true, endDate: true, completedAt: true } },
} as const;

const ROW_SELECT = {
  id: true, keyResultId: true, periodId: true, startValue: true, targetValue: true, currentValue: true, refreshedAt: true, frozenAt: true,
  sourceSig: true, sourceListCount: true, pausedSince: true, pausedReason: true,
  period: { select: { id: true, okrId: true, startsAt: true, endsAt: true, closesAt: true, status: true } },
} as const;

/**
 * Count the List sources of a workspace's goals and store their numbers:
 * every open period's row (repeating goals) or the target itself (one-time
 * goals), as each source's connector, grouped by connector, oldest first.
 * Writes go through writePeriodValue (B8); a period closed meanwhile is left
 * as it froze. Never throws for one source: a failure is logged and the
 * others go on.
 */
export async function refreshGoalSources(orgId: string, opts: RefreshOptions = {}): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const out: RefreshResult = { counted: 0, paused: 0, skipped: 0, changed: [] };
  const targets = await prisma.keyResult.findMany({
    where: {
      sourceById: { not: null },
      okr: { organizationId: orgId, ...(opts.okrIds ? { id: { in: [...opts.okrIds] } } : {}) },
      ...(opts.keyResultIds ? { id: { in: [...opts.keyResultIds] } } : {}),
    },
    select: TARGET_SELECT,
  });
  const sourced = targets.map((kr) => ({ kr, source: parseListSource(kr.source) })).filter((t): t is { kr: TargetRow; source: ListSource } => !!t.source);
  if (sourced.length === 0) return out;
  const settings = await orgPeriodSettings(orgId);
  const jobs = await planJobs(sourced, settings, now, opts);
  jobs.sort((a, b) => a.lastAt - b.lastAt);

  const connectors = new Map<string, Promise<ConnectorCheck>>();
  const editors = new Map<string, Promise<boolean>>();
  const pausedBy = new Map<string, string>();
  const countedKr = new Set<string>();
  const changed = new Set<string>();
  // Grouped by connector (one Viewer each), oldest first inside each.
  const byConnector = new Map<string, Job[]>();
  for (const j of jobs) {
    const id = j.kr.sourceById ?? "";
    const list = byConnector.get(id);
    if (list) list.push(j);
    else byConnector.set(id, [j]);
  }
  for (const [connectorId, group] of byConnector) {
    for (const job of group) {
      if (opts.budgetMs != null && Date.now() - started > opts.budgetMs) {
        out.skipped += 1;
        continue;
      }
      try {
        let check = connectors.get(connectorId);
        if (!check) {
          check = connectorFor(orgId, connectorId);
          connectors.set(connectorId, check);
        }
        const conn = await check;
        let outcome: CountOutcome;
        if (!conn.ok) outcome = { kind: "paused", reason: conn.reason };
        else {
          const editKey = `${connectorId}|${job.kr.okrId}`;
          let edits = editors.get(editKey);
          if (!edits) {
            edits = canEditGoal(conn.connector.session, { id: job.kr.okr.id, level: job.kr.okr.level, ownerId: job.kr.okr.ownerId });
            editors.set(editKey, edits);
          }
          outcome = (await edits)
            ? await countListSource({
                orgId, source: job.source, connector: conn.connector, window: job.window, zone: settings.timezone, now,
                prevSig: opts.force || job.mode === "freeze" ? null : job.row ? job.row.sourceSig : null,
              })
            : { kind: "paused", reason: PAUSE.lostGoal(conn.connector.firstName) };
        }
        if (outcome.kind === "paused") {
          out.paused += 1;
          pausedBy.set(job.kr.id, outcome.reason);
          await storePause(job, outcome.reason, now);
          continue;
        }
        out.counted += 1;
        countedKr.add(job.kr.id);
        if (await storeCount(orgId, job, outcome, settings, now)) changed.add(job.kr.okrId);
      } catch (e) {
        out.skipped += 1;
        console.error(`[goal-source] counting a target failed (the next run tries again): ${errText(e)}`);
      }
    }
  }

  // The target's own state: paused (the first pause sends the Inbox rows), or counting again.
  for (const { kr } of sourced) {
    const reason = pausedBy.get(kr.id);
    if (reason) await markPaused(kr, reason, now);
    else if (countedKr.has(kr.id)) {
      await prisma.keyResult.updateMany({ where: { id: kr.id }, data: { sourceRefreshedAt: now, sourcePausedReason: null } });
    }
  }
  out.changed = [...changed];
  if (out.changed.length > 0) {
    try {
      await persistGoalRollupChains(orgId, out.changed, now);
    } catch (e) {
      console.error(`[goal-source] storing the rollup after a count failed (the next read stores it): ${errText(e)}`);
    }
  }
  return out;
}

/** Which counts are due: each open period row of a repeating goal, or a one-time goal's target. */
async function planJobs(
  sourced: ReadonlyArray<{ kr: TargetRow; source: ListSource }>,
  settings: PeriodSettings,
  now: Date,
  opts: RefreshOptions,
): Promise<Job[]> {
  const jobs: Job[] = [];
  const minAge = opts.force ? 0 : opts.minAgeMs ?? 0;
  const old = (at: Date | null | undefined) => !at || now.getTime() - at.getTime() >= minAge;
  const repeating = sourced.filter((t) => isGoalCadence(t.kr.okr.repeat));
  const rows = repeating.length
    ? await prisma.keyResultPeriod.findMany({
        where: {
          keyResultId: { in: repeating.map((t) => t.kr.id) },
          period: { status: "OPEN" },
          ...(opts.periodIds ? { periodId: { in: [...opts.periodIds] } } : {}),
        },
        select: ROW_SELECT,
      })
    : [];
  const byKr = new Map(repeating.map((t) => [t.kr.id, t]));
  for (const row of rows) {
    const t = row.keyResultId ? byKr.get(row.keyResultId) : undefined;
    if (!t || row.frozenAt || row.period.status !== "OPEN") continue;
    const p = row.period;
    if (p.startsAt.getTime() > now.getTime()) continue;
    const windowed = isWindowed(t.source);
    if (opts.windowedOnly && !windowed) continue;
    let mode: Job["mode"] = "refresh";
    if (windowed) {
      if (now.getTime() >= p.closesAt.getTime() && !opts.periodIds) continue;
    } else if (now.getTime() >= p.endsAt.getTime()) {
      // Right now: its final number is the first CRON run after the end.
      if (!opts.freezeRightNow) continue;
      mode = "freeze";
    }
    if (mode === "refresh" && !old(row.refreshedAt)) continue;
    jobs.push({ kr: t.kr, source: t.source, row, mode, window: windowed ? periodWindow(p, settings) : null, lastAt: row.refreshedAt?.getTime() ?? 0 });
  }
  if (!opts.periodIds) {
    for (const t of sourced) {
      if (isGoalCadence(t.kr.okr.repeat) || t.kr.okr.completedAt) continue;
      if (opts.windowedOnly && !isWindowed(t.source)) continue;
      if (!old(t.kr.sourceRefreshedAt)) continue;
      jobs.push({
        kr: t.kr, source: t.source, row: null, mode: "refresh",
        window: isWindowed(t.source) ? goalDatesWindow(t.kr.okr.startDate, t.kr.okr.endDate, settings.timezone) : null,
        lastAt: t.kr.sourceRefreshedAt?.getTime() ?? 0,
      });
    }
  }
  return jobs;
}

/** A paused count: the number stands; the row (or target) records since when and why. */
async function storePause(job: Job, reason: string, now: Date): Promise<void> {
  if (!job.row) return;
  const p = job.row.period;
  await prisma.keyResultPeriod.updateMany({
    where: { id: job.row.id, frozenAt: null, period: { status: "OPEN" } },
    data: {
      pausedSince: job.row.pausedSince ?? new Date(Math.max(now.getTime(), p.startsAt.getTime())),
      pausedReason: reason,
      refreshedAt: now,
    },
  });
}

/** A count: stored through writePeriodValue (or on a one-time target). True when the number moved. */
async function storeCount(
  orgId: string,
  job: Job,
  outcome: Exclude<CountOutcome, { kind: "paused" }>,
  settings: PeriodSettings,
  now: Date,
): Promise<boolean> {
  const { kr } = job;
  if (!job.row) {
    if (outcome.kind === "same") return false;
    const value = outcome.value ?? kr.startValue;
    const progress = keyResultProgress(kr.startValue, kr.targetValue, value, targetDirection({ startValue: kr.startValue, targetValue: kr.targetValue, kpi: kr.kpi }));
    // A ONE-TIME goal's sourced target: its number is the count (C2).
    await prisma.keyResult.update({ where: { id: kr.id }, data: { currentValue: value, progress, sourceRefreshedAt: now, sourcePausedReason: null } });
    return value !== kr.currentValue;
  }
  const row = job.row;
  if (outcome.kind === "same") {
    await prisma.keyResultPeriod.updateMany({ where: { id: row.id, frozenAt: null, period: { status: "OPEN" } }, data: { refreshedAt: now, pausedSince: null, pausedReason: null } });
    return false;
  }
  const value = outcome.value ?? row.startValue;
  try {
    await prisma.$transaction((tx) => writePeriodValue(tx, {
      okrId: kr.okrId, keyResultId: kr.id, periodId: row.periodId, value, mode: job.mode, now, settings,
      source: { refreshedAt: now, sourceSig: outcome.sig, sourceListCount: outcome.listCount, pausedSince: null, pausedReason: null },
    }), TX_OPTS);
  } catch (e) {
    // Closed meanwhile: it keeps what it froze at.
    if (e instanceof GoalPeriodRefusal) return false;
    throw e;
  }
  // A Space source counting another number of Lists says so (C3).
  if (job.source.kind === "space" && row.sourceListCount != null && row.sourceListCount !== outcome.listCount) {
    logActivity({ type: "okr_updated", actorId: null, organizationId: orgId, description: listCountChangeWords(outcome.spaceName, outcome.listCount, row.sourceListCount), targetId: kr.okrId, targetType: "okr" });
  }
  return value !== row.currentValue;
}

/**
 * The target paused: its reason, and on the FIRST pause (none recorded
 * before) one goal_source_paused Inbox row to the owner and to the
 * connector. No repeat while it stays paused; the reason may change.
 */
async function markPaused(kr: TargetRow, reason: string, now: Date): Promise<void> {
  const first = await prisma.keyResult.updateMany({ where: { id: kr.id, sourcePausedReason: null }, data: { sourcePausedReason: reason, sourceRefreshedAt: now } });
  if (first.count === 0) {
    await prisma.keyResult.updateMany({ where: { id: kr.id }, data: { sourcePausedReason: reason, sourceRefreshedAt: now } });
    return;
  }
  await notifySourcePaused(kr.okr, kr.title, reason, [kr.okr.ownerId, kr.sourceById]);
}

/** goal_source_paused (F, C10): "{goal}: {target} stopped counting." with the reason, to the goal. */
export async function notifySourcePaused(
  goal: { id: string; title: string },
  target: string,
  reason: string,
  to: ReadonlyArray<string | null>,
): Promise<number> {
  const users = [...new Set(to.filter((u): u is string => !!u))];
  if (users.length === 0) return 0;
  const live = await prisma.user.findMany({ where: { id: { in: users }, deletedAt: null, status: { not: "INACTIVE" } }, select: { id: true } });
  if (live.length === 0) return 0;
  const written = await prisma.notification.createMany({
    data: live.map((u) => ({
      userId: u.id,
      type: "goal_source_paused",
      title: `${goal.title}: ${target} stopped counting.`,
      message: reason,
      link: `/okrs/${goal.id}`,
    })),
  });
  return written.count;
}

/* ───────────────────────── The handover (C10) ───────────────────────── */

/**
 * The leaver's connected sources (C10): each moves to the transferee when
 * the transferee passes the same checks (Can edit on the goal, Can view on
 * the List or Space); any that fail stay with the leaver, paused, and the
 * owner's Inbox row says why. Returns what moved and what stayed.
 */
export async function handOverGoalSources(orgId: string, fromId: string, toId: string): Promise<{ moved: number; paused: number }> {
  const targets = await prisma.keyResult.findMany({ where: { sourceById: fromId, okr: { organizationId: orgId } }, select: TARGET_SELECT });
  const sourced = targets.map((kr) => ({ kr, source: parseListSource(kr.source) })).filter((t): t is { kr: TargetRow; source: ListSource } => !!t.source);
  if (sourced.length === 0) return { moved: 0, paused: 0 };
  const to = await connectorFor(orgId, toId);
  let moved = 0;
  let paused = 0;
  const leaver = await prisma.user.findUnique({ where: { id: fromId }, select: { firstName: true } });
  for (const { kr, source } of sourced) {
    let problem: string | null = to.ok ? null : to.reason;
    if (to.ok) {
      problem = (await sourceAccessProblem(orgId, source, to.connector))
        ?? ((await canEditGoal(to.connector.session, { id: kr.okr.id, level: kr.okr.level, ownerId: kr.okr.ownerId })) ? null : PAUSE.lostGoal(to.connector.firstName));
    }
    if (!problem) {
      await prisma.keyResult.updateMany({ where: { id: kr.id, sourceById: fromId }, data: { sourceById: toId, sourcePausedReason: null, sourceRefreshedAt: null } });
      moved += 1;
      continue;
    }
    paused += 1;
    await markPaused(kr, PAUSE.left(leaver?.firstName?.trim() || null), new Date());
  }
  return { moved, paused };
}

/** How many targets this person's connected sources feed (the handover dialog's line). */
export async function connectedSourceCount(orgId: string, userId: string): Promise<number> {
  return prisma.keyResult.count({ where: { sourceById: userId, okr: { organizationId: orgId } } });
}

/* ───────────────────────── What the goal page shows (C9, C10) ───────────────────────── */

/** One sourced target as a viewer sees it on the goal page. */
export interface TargetSourceView {
  /** "From Sales pipeline", "From 3 Lists", "From Marketing", or "From a private List". */
  label: string;
  /** The viewer cannot open the source: no name, no link, no settings (C9). */
  private: boolean;
  /** Open source, for a viewer who can open it. */
  href: string | null;
  /** Who connected it (an editor reads it on a private source, C9). */
  connectorName: string | null;
  /** Why it stopped counting, or null. */
  paused: string | null;
  /** The source's settings, for the target editor; null when private. */
  settings: Record<string, unknown> | null;
}

/**
 * C9 for the goal page: each List-sourced target as THIS viewer may see it.
 * Everyone who sees the goal sees the number; one who cannot open the
 * source reads "From a private List" with no name, link or settings.
 */
export async function describeTargetSources(
  orgId: string,
  viewerId: string,
  targets: ReadonlyArray<{ id: string; source: unknown; sourceById: string | null; sourcePausedReason: string | null }>,
): Promise<Map<string, TargetSourceView>> {
  const out = new Map<string, TargetSourceView>();
  const sourced = targets.map((t) => ({ t, s: parseListSource(t.source) })).filter((x): x is { t: (typeof targets)[number]; s: ListSource } => !!x.s);
  if (sourced.length === 0) return out;
  const viewer = (await actingPerson(orgId, viewerId))?.viewer ?? null;
  const listIds = [...new Set(sourced.flatMap((x) => x.s.listIds))];
  const spaceIds = [...new Set(sourced.map((x) => x.s.spaceId).filter((v): v is string => !!v))];
  const connectorIds = [...new Set(sourced.map((x) => x.t.sourceById).filter((v): v is string => !!v))];
  const [boards, spaces, people] = await Promise.all([
    listIds.length ? prisma.board.findMany({ where: { id: { in: listIds }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : Promise.resolve([]),
    spaceIds.length ? prisma.space.findMany({ where: { id: { in: spaceIds }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : Promise.resolve([]),
    connectorIds.length ? prisma.user.findMany({ where: { id: { in: connectorIds } }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
  ]);
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const nameOf = new Map(people.map((p) => [p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null]));
  for (const { t, s } of sourced) {
    const opens = viewer ? await viewerCanOpenSource(orgId, s, viewer) : false;
    const connectorName = t.sourceById ? nameOf.get(t.sourceById) ?? null : null;
    if (!opens) {
      out.set(t.id, { label: PRIVATE_LIST_WORDS, private: true, href: null, connectorName, paused: t.sourcePausedReason, settings: null });
      continue;
    }
    let label: string;
    let href: string | null = null;
    if (s.kind === "space") {
      const sp = s.spaceId ? spaceById.get(s.spaceId) : undefined;
      label = sp ? `From ${sp.name}` : "From a Space";
      href = sp ? `/spaces/${sp.slug}` : null;
    } else if (s.listIds.length === 1) {
      const b = boardById.get(s.listIds[0]);
      label = b ? `From ${b.name}` : "From a List";
      href = b ? `/boards/${b.slug}` : null;
    } else {
      label = `From ${s.listIds.length} Lists`;
      const first = boardById.get(s.listIds[0]);
      href = first ? `/boards/${first.slug}` : null;
    }
    out.set(t.id, { label, private: false, href, connectorName, paused: t.sourcePausedReason, settings: serializeListSource(s) });
  }
  return out;
}
