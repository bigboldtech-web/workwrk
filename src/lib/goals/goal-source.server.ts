// Counting a target from a List or a table (docs/plans/recurring-goals.md
// C3, C5, C7, C8, C10): the count, the connector's checks, the pause, and the
// refresh that stores the number on the period (or, for a one-time goal, on
// the target).
//
// A TABLE (C5, step 5) counts its filled rows only, by the Tables list's own
// rule (ROW_HAS_DATA, lib/table-counts.ts liveTableRows), never a trashed
// one; then its column filters and its Date column's window; Count of rows,
// or Sum of or Average of a number or formula column (table-count.ts).
// Formulas run here, through the embed's engine path (lib/sheet-embed.ts
// embedEngine) with TODAY() given the WORKSPACE zone's day (a period's final
// number: its last day, tableClockAt). Caps: 50,000 filled rows for plain
// columns; 20,000 live rows when a formula is read (the engine reads every
// live row, blank ones too, so A1 refs anchor as in the grid); over either,
// the source pauses ("This table is too large to count from a goal."). A
// plain read loads only the columns it names. One table at a time per run:
// every target on a table counted together, one read of it, released after
// its last count, yielding between tables; a request's count shares a small
// cache with the preview instead (sharedTableReads). The Tables module
// turned off, the table deleted or moved to Trash, a column it reads removed
// or retyped, a value filter none of whose options the column still offers,
// a formula it reads broken (a "#REF!" in it, or an error in every row it
// would read), or the connector losing the table pauses it, by the same
// rules as a List.
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
// a List's grouped by connector and a table's by table, oldest first, inside
// a time budget, a signature skipping a recount when nothing changed), the
// goal page (counted more
// than 10 minutes ago, for people who may check in), Refresh in the row
// menu, and one last count at the close.
//
// Server-only (prisma).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { actingPerson, type ActingPerson } from "@/lib/access/acting-person";
import { levelHeldIn } from "@/lib/access/acting-workspace";
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
  parseConnectedSource,
  PAUSE,
  pauseWordsFor,
  periodWindow,
  PRIVATE_LIST_WORDS,
  PRIVATE_TABLE_WORDS,
  serializeConnectedSource,
  serializeListSource,
  sourceSignature,
  widgetSourceOf,
  type ConnectedSource,
  type ListSource,
  type SourceWindow,
} from "@/lib/goals/goal-source";
import {
  columnConnectWords,
  columnPauseWords,
  columnsRead,
  readsBrokenFormula,
  readsFormulaColumn,
  TABLE_FORMULA_CAP,
  TABLE_PAUSE,
  TABLE_PLAIN_CAP,
  tableColumnProblem,
  tableColumnsOf,
  type TableSource,
} from "@/lib/goals/table-source";
import { countTableRows, readsStoredFormula, wallClockIn, type TableRowRead } from "@/lib/goals/table-count";
import { embedColumnsOf, embedEngine, namedRangesOf } from "@/lib/sheet-embed";
import { EmbedSnapshotCache } from "@/lib/sheet-embed-cache";
import { filledRowCounts, liveTableRows } from "@/lib/table-counts";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_APP_KEY } from "@/lib/modules";
import type { TableEngine } from "@/lib/sheet-engine-host";

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
export async function sourceAccessProblem(orgId: string, source: ConnectedSource, c: Connector): Promise<string | null> {
  const ctx = nodeCtxFromViewer(c.viewer);
  if (source.kind === "table") {
    const read = await tableAsConnector(orgId, source.tableId, c, { id: true });
    return "problem" in read ? read.problem : null;
  }
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
 * C9: is every List the source counts readable by any member of the
 * workspace (a member with no grant of their own)? The target editor says
 * "Everyone who can see this goal will see this number." when it is not.
 * `counted` is the Lists the count read (its scope): a Space open to the
 * workspace can hold a private List, and that List's tasks are counted.
 */
export async function sourceOpenToWorkspace(orgId: string, source: ConnectedSource, counted: readonly string[] = []): Promise<boolean> {
  const ctx = nodeCtxFromLevel("workspace-member", orgId, "EMPLOYEE");
  if (source.kind === "table") return roleAtLeast((await nodeRole(ctx, { kind: "table", id: source.tableId })).role, "VIEW");
  if (source.kind === "space" && !roleAtLeast((await nodeRole(ctx, { kind: "space", id: source.spaceId ?? "" })).role, "VIEW")) return false;
  const ids = [...new Set([...source.listIds, ...counted])];
  if (ids.length === 0) return true;
  const roles = await nodeRoleMap(ctx, "list", ids);
  return ids.every((id) => roleAtLeast(roles.get(id) ?? "none", "VIEW"));
}

/** Can this viewer open the source (its name, its settings, its tasks)? C9's question, on the page. */
export async function viewerCanOpenSource(orgId: string, source: ConnectedSource, viewer: Viewer): Promise<boolean> {
  const ctx = nodeCtxFromViewer(viewer);
  if (source.kind === "table") return roleAtLeast((await nodeRole(ctx, { kind: "table", id: source.tableId })).role, "VIEW");
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
export async function connectSourceProblem(orgId: string, userId: string, source: ConnectedSource): Promise<string | null> {
  if (source.kind === "table") return connectTableProblem(orgId, userId, source);
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

/**
 * listCount: how many Lists a List or Space count read (C3); null for a
 * table. errorRows: a table count's rows left out because a formula it reads
 * shows an error there (the preview says so; C5).
 */
export type CountOutcome =
  | { kind: "paused"; reason: string }
  | { kind: "same"; sig: string; listCount: number | null }
  | { kind: "counted"; value: number | null; listCount: number | null; listIds: string[]; spaceName: string | null; sig: string; errorRows?: number };

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
  // change nothing stamps, such as a tag, is caught by the next day). The
  // linked tasks by id, not by how many: one link swapped for another moves
  // the number and may move nothing else.
  const [items, done] = await Promise.all([
    prisma.item.aggregate({ where: base, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.itemCompletion.aggregate({ where: completionScope, _count: { _all: true }, _max: { doneAt: true } }),
  ]);
  const sig = sourceSignature([
    JSON.stringify(serializeListSource(source)), listIds.join(","), [...linked].sort().join(","),
    window?.firstKey ?? "", window?.lastKey ?? "", zone, dateKeyOf(now, zone),
    countOf(items._count), items._max.updatedAt?.toISOString() ?? "", countOf(done._count), done._max.doneAt?.toISOString() ?? "",
  ]);
  if (args.prevSig && args.prevSig === sig) return { kind: "same", sig, listCount: listIds.length };
  if (listIds.length === 0) return { kind: "counted", value: aggregateRows([], source.metric), listCount: 0, listIds, spaceName, sig };

  const needsTags = source.filter.rules.some((x) => x.field === "tags");
  let rows: WidgetRow[];
  if (source.countedBy === "done") {
    // One row per completion inside the window, of a task in scope now. The
    // cap is decided on those (after the window, the top-level and the
    // archive rules), so a List's subtask or archived completions never
    // pause it.
    const range = window ? looseInstantRange(window) : {};
    const inside = await completionsInScope({ ...completionScope, ...(range.gte || range.lt ? { doneAt: range } : {}) }, base, window, zone);
    if (!inside) return { kind: "paused", reason: PAUSE.tooMany };
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
      // A window too wide for prefixes (or open at an end) still reads only
      // tasks whose field is set: a Date field is a string, so any prefix.
      const prefixes = fieldPrefixes(window) ?? [""];
      const key = source.dateFieldKey ?? "";
      // A linked task keeps its value under the List's own key, which no
      // path names here: linked tasks are read whole and tested in memory.
      where = { AND: [base, { OR: [...prefixes.map((p) => ({ metadata: { path: [key], string_starts_with: p } })), ...(linked.length ? [{ id: { in: linked } }] : [])] }] };
    }
    // Counted before anything is loaded: over the cap pauses with no row read.
    const total = where === base ? countOf(items._count) : await prisma.item.count({ where });
    if (total > LIST_SOURCE_CAP) return { kind: "paused", reason: PAUSE.tooMany };
    const loaded = await loadWidgetRows(r, scope, { where, cap: LIST_SOURCE_CAP, needsTags }, reader);
    // Tasks added between the count and the read can still cross it.
    if (loaded.truncated) return { kind: "paused", reason: PAUSE.tooMany };
    rows = loaded.rows;
    if (window && source.countedBy === "created") rows = rows.filter((x) => keyInWindow(dateKeyOf(x.createdAt, zone), window));
    if (window && source.countedBy === "due") rows = rows.filter((x) => keyInWindow(dateKeyOf(x.dueAt, zone), window));
    if (window && source.countedBy === "field") rows = rows.filter((x) => keyInWindow(dateKeyOf(x.metadata[source.dateFieldKey ?? ""], zone), window));
  }
  const kept = applyWidgetFilter(rows, source.filter, zone);
  return { kind: "counted", value: aggregateRows(kept, source.metric), listCount: listIds.length, listIds, spaceName, sig };
}

function countOf(c: unknown): number {
  if (typeof c === "number") return c;
  const o = c as { _all?: number } | null;
  return o?._all ?? 0;
}

/** Completions read a page at a time once a window holds more than the cap before its filters. */
const COMPLETION_PAGE = 5_000;

type CompletionFacts = { itemId: string; status: string; doneAt: Date };

/**
 * The completions a Done-date count reads (C3, C4): inside the window's day
 * keys, of a task the count reads now (top level, not archived, not a system
 * item: `base`). Null when more than the cap remain after those filters.
 * Counted first: a window at or under the cap is read in one go (the row
 * loader applies `base` after), and only one over it is paged, each page
 * checked against `base`, so the cap is never decided on subtasks or
 * archived tasks, and never more than the cap and one page sit in memory.
 */
async function completionsInScope(
  where: Prisma.ItemCompletionWhereInput,
  base: Prisma.ItemWhereInput,
  window: SourceWindow | null,
  zone: string,
): Promise<CompletionFacts[] | null> {
  const inWindow = (list: CompletionFacts[]) => (window ? list.filter((x) => keyInWindow(dateKeyOf(x.doneAt, zone), window)) : list);
  const total = await prisma.itemCompletion.count({ where });
  if (total <= LIST_SOURCE_CAP) {
    return total === 0 ? [] : inWindow(await prisma.itemCompletion.findMany({ where, select: { itemId: true, status: true, doneAt: true } }));
  }
  const kept: CompletionFacts[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: Array<CompletionFacts & { id: string }> = await prisma.itemCompletion.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      orderBy: { id: "asc" },
      take: COMPLETION_PAGE,
      select: { id: true, itemId: true, status: true, doneAt: true },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    const inside = inWindow(page);
    const ids = [...new Set(inside.map((x) => x.itemId))];
    const counted = ids.length
      ? new Set((await prisma.item.findMany({ where: { AND: [base, { id: { in: ids } }] }, select: { id: true } })).map((x) => x.id))
      : new Set<string>();
    for (const x of inside) if (counted.has(x.itemId)) kept.push({ itemId: x.itemId, status: x.status, doneAt: x.doneAt });
    if (kept.length > LIST_SOURCE_CAP) return null;
    if (page.length < COMPLETION_PAGE) break;
  }
  return kept;
}

/* ───────────────────────── A table (C5) ───────────────────────── */

const TABLES_MODULE = MODULE_BY_APP_KEY.tables.productSlug;

/** What one refresh run shares between its table counts: the module answer per workspace, and the table being counted. */
export interface TableCountMemo {
  tablesOn: Map<string, Promise<boolean>>;
  reads: EmbedSnapshotCache<TableRead | null>;
}

/**
 * One run's memo (C5): the run counts every target on a table together, so
 * it holds that one table only, its plain read and its engine (two entries,
 * no TTL), and the run clears it after the table's last count. One evaluated
 * engine at most sits in memory, and each table is read once.
 */
export function tableCountMemo(): TableCountMemo {
  return { tablesOn: new Map(), reads: new EmbedSnapshotCache<TableRead | null>({ maxEntries: 2, ttlMs: Number.POSITIVE_INFINITY }) };
}

/**
 * The reads a REQUEST's count shares (C5): the preview, the count when a
 * source is saved, the goal page's Refresh. Per process, three tables, a
 * minute each, keyed as the public embed's memo is (the table, then the zone
 * and the day TODAY() reads for an engine, or the columns a plain read
 * loads), with the data signature as its sig, so any edit is a miss. Safe to
 * share between people: a read depends on the table alone, never on the
 * connector, and every check of the connector (the module, the table, its
 * columns) runs before it on each count. Keep it that way.
 */
const sharedTableReads = new EmbedSnapshotCache<TableRead | null>({ maxEntries: 3, ttlMs: 60_000 });

/** For tests: the shared reads emptied (each suite seeds its tables under the same ids and times). */
export function clearSharedTableReads(): void {
  sharedTableReads.clear();
}

/**
 * The instant TODAY() and NOW() read for a count (C5): now, except a
 * period's final number (a Right now freeze, the close's final count, a
 * one-time goal's last count after its due date), which reads the period's
 * last moment, min(now, end - 1ms), so a freeze on 1 November reads 31
 * October in the workspace zone.
 */
export function tableClockAt(now: Date, end: Date | null, final: boolean): Date {
  if (!final || !end) return now;
  return new Date(Math.min(now.getTime(), end.getTime() - 1));
}

/** A table's rows as a count reads them, and its engine when a formula is read. */
interface TableRead {
  rows: TableRowRead[];
  engine: TableEngine | null;
}

/** Is the Tables module on for this workspace (C10: off pauses every table source)? */
async function tablesModuleOn(orgId: string, memo?: TableCountMemo): Promise<boolean> {
  if (!memo) return isModuleActive(orgId, TABLES_MODULE);
  let on = memo.tablesOn.get(orgId);
  if (!on) {
    on = isModuleActive(orgId, TABLES_MODULE);
    memo.tablesOn.set(orgId, on);
  }
  return on;
}

/**
 * The table as the connector may open it now (nodeCtxFromViewer, which
 * honors a denied person), or the pause's words: gone (deleted, or moved to
 * Trash, which removes the row until a restore brings it back with its id),
 * or no longer theirs to open.
 */
async function tableAsConnector<S extends Prisma.DataTableSelect>(
  orgId: string,
  tableId: string,
  c: Connector,
  select: S,
): Promise<{ table: Prisma.DataTableGetPayload<{ select: S }> } | { problem: string }> {
  const table = await prisma.dataTable.findFirst({ where: { id: tableId, organizationId: orgId }, select });
  if (!table) return { problem: TABLE_PAUSE.tableGone };
  const role = (await nodeRole(nodeCtxFromViewer(c.viewer), { kind: "table", id: tableId })).role;
  return roleAtLeast(role, "VIEW") ? { table } : { problem: TABLE_PAUSE.lostTable(c.firstName) };
}

/**
 * H for a table: the Tables module on, Can view on the table at that moment
 * by the person connecting it, and every column it reads a column of the
 * table of a type that may be read that way (C5: never a link, lookup or
 * rollup column). Null when it may be connected, else the 400's words.
 */
async function connectTableProblem(orgId: string, userId: string, source: TableSource): Promise<string | null> {
  if (!(await tablesModuleOn(orgId))) return TABLE_PAUSE.tablesOff;
  const conn = await connectorFor(orgId, userId);
  if (!conn.ok) return "You can't connect a source right now.";
  const read = await tableAsConnector(orgId, source.tableId, conn.connector, { id: true, columns: true });
  if ("problem" in read) return "You can only count from a table you can open.";
  const problem = tableColumnProblem(source, tableColumnsOf(read.table.columns));
  return problem ? columnConnectWords(problem) : null;
}

const TABLE_SELECT = { id: true, name: true, columns: true, settings: true, updatedAt: true } satisfies Prisma.DataTableSelect;

/** Let other work run between two tables (C5): an engine pass over a large table holds the event loop. */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * One table source counted over one window as its connector (C5, C8, C10).
 * `prevSig` skips the recount when the signature has not moved (the cron).
 * A null window counts "Right now". The signature is the embed memo's key
 * (the table's updatedAt, its newest row's updatedAt and its row count),
 * with the settings, the window, the zone and the day TODAY() reads.
 * `clockAt` is the instant TODAY() and NOW() read (tableClockAt; now when
 * not given). `readColumns`: the columns a plain read loads, when a run
 * counts several targets on the table (the union of theirs, so one read
 * serves them all); this source's own when not given. Without `memo` the
 * read comes from the shared request cache.
 */
export async function countTableSource(args: {
  orgId: string;
  source: TableSource;
  connector: Connector;
  window: SourceWindow | null;
  zone: string;
  now: Date;
  clockAt?: Date;
  prevSig?: string | null;
  memo?: TableCountMemo;
  readColumns?: readonly string[];
}): Promise<CountOutcome> {
  const { orgId, source, connector: c, zone, now } = args;
  if (!(await tablesModuleOn(orgId, args.memo))) return { kind: "paused", reason: TABLE_PAUSE.tablesOff };
  const read = await tableAsConnector(orgId, source.tableId, c, TABLE_SELECT);
  if ("problem" in read) return { kind: "paused", reason: read.problem };
  const { table } = read;
  const columns = tableColumnsOf(table.columns);
  const misfit = tableColumnProblem(source, columns);
  if (misfit) return { kind: "paused", reason: columnPauseWords(misfit) };
  // A column a formula it reads named was deleted: every row reads #REF!.
  if (readsBrokenFormula(source, columns)) return { kind: "paused", reason: TABLE_PAUSE.formulas };

  const window = source.countedBy === "now" ? null : args.window;
  const clockAt = args.clockAt ?? now;
  const agg = await prisma.dataTableRow.aggregate({ where: { tableId: table.id, deletedAt: null }, _count: { _all: true }, _max: { updatedAt: true } });
  const live = countOf(agg._count);
  const dataSig = `${table.updatedAt.getTime()}:${agg._max.updatedAt?.getTime() ?? 0}:${live}`;
  const day = dateKeyOf(clockAt, zone) ?? "";
  const sig = sourceSignature([
    JSON.stringify(serializeConnectedSource(source)), dataSig,
    window?.firstKey ?? "", window?.lastKey ?? "", zone, day,
  ]);
  if (args.prevSig && args.prevSig === sig) return { kind: "same", sig, listCount: null };

  // Plain columns read the filled rows only; a formula read runs the engine
  // over every live row (its A1 refs anchor to storage order), under the
  // lower cap. Counted before any row is loaded.
  const formulaColumn = readsFormulaColumn(source, columns);
  if (formulaColumn ? live > TABLE_FORMULA_CAP : live > TABLE_PLAIN_CAP && ((await filledRowCounts([table.id])).get(table.id) ?? 0) > TABLE_PLAIN_CAP) {
    return { kind: "paused", reason: TABLE_PAUSE.tooLarge };
  }
  // A plain read loads the filled rows' named columns only (`filled` is
  // decided on the whole row in SQL), and depends on nothing but the table;
  // an engine reads every live row whole, with the zone's clock.
  const plainKeys = [...new Set([...(args.readColumns ?? []), ...columnsRead(source)])].sort();
  const load = async (engineToo: boolean): Promise<TableRead | null> => {
    const rows = (await liveTableRows(table.id, engineToo ? { filledOnly: false } : { filledOnly: true, keys: plainKeys })).map((r) => ({
      id: r.id,
      values: r.values && typeof r.values === "object" && !Array.isArray(r.values) ? (r.values as Record<string, unknown>) : {},
      filled: r.filled,
    }));
    if (!engineToo) return { rows, engine: null };
    const engine = embedEngine({ columns: embedColumnsOf(table.columns), rows, namedRanges: namedRangesOf(table.settings), clock: () => wallClockIn(zone, clockAt) });
    return engine ? { rows, engine } : null;
  };
  // Null: the engine could not be built over this table (a malformed one).
  // A read that throws is not kept (the cache drops it), so the next count tries again.
  const reads = args.memo?.reads ?? sharedTableReads;
  const memoized = (engineToo: boolean): Promise<TableRead | null> =>
    reads.get(engineToo ? `${table.id}|${zone}|${day}|engine` : `${table.id}|plain|${plainKeys.join(",")}`, dataSig, () => load(engineToo));

  let evaluated = await memoized(formulaColumn);
  // A plain column can still hold a cell formula of its own: then the engine
  // runs too, over every live row, under the formula cap.
  if (evaluated && !formulaColumn && readsStoredFormula(evaluated.rows, columnsRead(source))) {
    if (live > TABLE_FORMULA_CAP) return { kind: "paused", reason: TABLE_PAUSE.tooLarge };
    evaluated = await memoized(true);
  }
  if (!evaluated) return { kind: "paused", reason: TABLE_PAUSE.formulas };
  const tally = countTableRows({ source, columns, rows: evaluated.rows, engine: evaluated.engine, window, zone });
  // Every row it would read shows an error: a broken formula, not a 0.
  if (tally.broken) return { kind: "paused", reason: TABLE_PAUSE.formulas };
  return { kind: "counted", value: tally.value, listCount: null, listIds: [], spaceName: null, sig, errorRows: tally.errorRows };
}

/** A List or a table source, counted as its connector: the one door the refresh and the preview use. */
export async function countSource(args: {
  orgId: string;
  source: ConnectedSource;
  connector: Connector;
  window: SourceWindow | null;
  zone: string;
  now: Date;
  /** A table's TODAY() (tableClockAt); a List ignores it. */
  clockAt?: Date;
  prevSig?: string | null;
  memo?: TableCountMemo;
  /** A table's plain read columns for this run (countTableSource). */
  readColumns?: readonly string[];
}): Promise<CountOutcome> {
  const { source } = args;
  return source.kind === "table" ? countTableSource({ ...args, source }) : countListSource({ ...args, source });
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
  /**
   * Stop starting new counts after this long; the rest wait for the next
   * run. A Right now freeze is never held back by it: its number is the one
   * at the first run after the end, so it runs first, whatever is left.
   */
  budgetMs?: number;
  /** False: the caller stores the rollup itself (the close stores its own once). Default true. */
  rollup?: boolean;
  /**
   * A request's count (the goal page's Refresh, a source just connected or
   * reconnected): its table reads come from the shared request cache, so the
   * preview, the save after it and the page's refresh build one engine
   * between them. Without it (the cron, the close) the run keeps its own
   * memo, released table by table.
   */
  sharedReads?: boolean;
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
  source: ConnectedSource;
  /** A period row of a repeating goal, or null for a one-time goal's target. */
  row: PeriodRowFacts | null;
  mode: "refresh" | "freeze";
  window: SourceWindow | null;
  lastAt: number;
  /** What a table's TODAY() reads (tableClockAt): the period's last moment for its final number, else now. */
  clockAt: Date;
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
 * Count the List and table sources of a workspace's goals and store their
 * numbers: every open period's row (repeating goals) or the target itself
 * (one-time goals), as each source's connector, oldest first (orderJobs: a
 * List's grouped by connector, a table's by table). Tables one at a time,
 * yielding to other work after each, one read of a table shared by its
 * targets and let go after its last (tableCountMemo). Writes go through
 * writePeriodValue (B8); a period closed meanwhile is left as it froze.
 * Never throws for one source: a failure is logged and the others go on.
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
  const sourced = targets.map((kr) => ({ kr, source: parseConnectedSource(kr.source) })).filter((t): t is { kr: TargetRow; source: ConnectedSource } => !!t.source);
  if (sourced.length === 0) return out;
  const settings = await orgPeriodSettings(orgId);
  const memo: TableCountMemo = opts.sharedReads ? { tablesOn: new Map(), reads: sharedTableReads } : tableCountMemo();
  const jobs = await planJobs(sourced, settings, now, opts);
  jobs.sort((a, b) => a.lastAt - b.lastAt);
  // A table's plain read loads the columns every target on it reads, so one read serves them all.
  const readColumns = new Map<string, string[]>();
  for (const j of jobs) {
    if (j.source.kind !== "table") continue;
    readColumns.set(j.source.tableId, [...new Set([...(readColumns.get(j.source.tableId) ?? []), ...columnsRead(j.source)])]);
  }

  const connectors = new Map<string, Promise<ConnectorCheck>>();
  const editors = new Map<string, Promise<boolean>>();
  const pausedBy = new Map<string, string>();
  const countedKr = new Set<string>();
  const changed = new Set<string>();
  for (const { job, lastOfTable } of orderJobs(jobs)) {
    const connectorId = job.kr.sourceById ?? "";
    try {
      if (job.mode === "refresh" && opts.budgetMs != null && (opts.budgetMs <= 0 || Date.now() - started > opts.budgetMs)) {
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
            ? await countSource({
                orgId, source: job.source, connector: conn.connector, window: job.window, zone: settings.timezone, now, clockAt: job.clockAt,
                prevSig: opts.force || job.mode === "freeze" ? null : job.row ? job.row.sourceSig : null, memo,
                readColumns: job.source.kind === "table" ? readColumns.get(job.source.tableId) : undefined,
              })
            : { kind: "paused", reason: PAUSE.lostGoal(conn.connector.firstName) };
          // One table at a time (C5): an engine pass holds the event loop, so other work runs between two.
          if (job.source.kind === "table") await yieldToLoop();
        }
        if (outcome.kind === "paused") {
          out.paused += 1;
          pausedBy.set(job.kr.id, outcome.reason);
          // Paused at its freeze: the number it stood at is the final one, so
          // a source that comes back in the grace never counts November into October.
          if (job.mode === "freeze" && job.row) await freezeStored(job, outcome.reason, settings, now);
          else await storePause(job, outcome.reason, now);
          continue;
        }
        out.counted += 1;
        countedKr.add(job.kr.id);
        if (await storeCount(orgId, job, outcome, settings, now)) changed.add(job.kr.okrId);
      } catch (e) {
        out.skipped += 1;
        console.error(`[goal-source] counting a target failed (the next run tries again): ${errText(e)}`);
      }
    } finally {
      // The table's last count in this run: its rows and its engine go (C5).
      if (lastOfTable && !opts.sharedReads) memo.reads.clear();
    }
  }

  // The target's own state: paused (the first pause sends the Inbox rows), or counting again.
  for (const { kr } of sourced) {
    const reason = pausedBy.get(kr.id);
    if (reason) await markPaused(orgId, kr, reason, now);
    else if (countedKr.has(kr.id)) {
      await prisma.keyResult.updateMany({ where: { id: kr.id }, data: { sourceRefreshedAt: now, sourcePausedReason: null } });
    }
  }
  out.changed = [...changed];
  if (out.changed.length > 0 && opts.rollup !== false) {
    try {
      await persistGoalRollupChains(orgId, out.changed, now);
    } catch (e) {
      console.error(`[goal-source] storing the rollup after a count failed (the next read stores it): ${errText(e)}`);
    }
  }
  return out;
}

/**
 * The order a run counts in (C3, C5, C7). The Right now freezes first and
 * outside the budget (C3: the number at the first run after the end, never a
 * later one), then the counts. Inside each, a List's counts grouped by their
 * connector (one Viewer each), and a table's counts together whoever
 * connected them (the connector map reads each Viewer once anyway), so the
 * run reads a table once and holds one table at a time; groups oldest first
 * (a group by its oldest count), a tie by table or connector id, and a
 * table's counts by the instant TODAY() reads. `lastOfTable` marks a table's
 * last count, after which the run lets its read go.
 */
function orderJobs(jobs: readonly Job[]): Array<{ job: Job; lastOfTable: boolean }> {
  const out: Array<{ job: Job; lastOfTable: boolean }> = [];
  for (const mode of ["freeze", "refresh"] as const) {
    const groups = new Map<string, { at: number; key: string; table: boolean; jobs: Job[] }>();
    for (const j of jobs) {
      if (j.mode !== mode) continue;
      const table = j.source.kind === "table";
      const key = table ? `table:${(j.source as TableSource).tableId}` : `list:${j.kr.sourceById ?? ""}`;
      const g = groups.get(key);
      if (g) {
        g.jobs.push(j);
        g.at = Math.min(g.at, j.lastAt);
      } else groups.set(key, { at: j.lastAt, key, table, jobs: [j] });
    }
    const sorted = [...groups.values()].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const g of sorted) {
      const list = g.table ? [...g.jobs].sort((a, b) => a.clockAt.getTime() - b.clockAt.getTime() || a.lastAt - b.lastAt) : g.jobs;
      list.forEach((job, i) => out.push({ job, lastOfTable: g.table && i === list.length - 1 }));
    }
  }
  return out;
}

/** Which counts are due: each open period row of a repeating goal, or a one-time goal's target. */
async function planJobs(
  sourced: ReadonlyArray<{ kr: TargetRow; source: ConnectedSource }>,
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
    // Its final number (a Right now freeze, the close's final count) reads TODAY() as the period's last day.
    const clockAt = tableClockAt(now, p.endsAt, mode === "freeze" || !!opts.periodIds);
    jobs.push({ kr: t.kr, source: t.source, row, mode, window: windowed ? periodWindow(p, settings) : null, lastAt: row.refreshedAt?.getTime() ?? 0, clockAt });
  }
  if (!opts.periodIds) {
    // A ONE-TIME goal's target (C2): its window is its start date to its due
    // date. Once that has ended it is counted ONE more time, at the first run
    // after the end, and then its number stands: a windowed count reads the
    // whole window by then, and a Right now count's final number is the
    // cron's first run after the end (C3), as a repeating period's is. Its
    // last count's time (sourceRefreshedAt, a pause's too) says it was made.
    for (const t of sourced) {
      if (isGoalCadence(t.kr.okr.repeat) || t.kr.okr.completedAt) continue;
      const windowed = isWindowed(t.source);
      if (opts.windowedOnly && !windowed) continue;
      const dates = goalDatesWindow(t.kr.okr.startDate, t.kr.okr.endDate, settings.timezone);
      const last = t.kr.sourceRefreshedAt;
      let mode: Job["mode"] = "refresh";
      const ended = !!dates.to && now.getTime() >= dates.to.getTime();
      if (ended) {
        if (last && dates.to && last.getTime() >= dates.to.getTime()) continue;
        if (!windowed) {
          if (!opts.freezeRightNow) continue;
          mode = "freeze";
        }
      } else if (!old(last)) continue;
      // Its last count after the due date is its final number: TODAY() reads the due date.
      jobs.push({ kr: t.kr, source: t.source, row: null, mode, window: windowed ? dates : null, lastAt: last?.getTime() ?? 0, clockAt: tableClockAt(now, dates.to, ended) });
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

/**
 * A Right now freeze that found its source paused (C3, C10): the number it
 * stood at becomes the period's final one, through writePeriodValue, with the
 * pause recorded (the close leaves out a target paused for more than half
 * the period).
 */
async function freezeStored(job: Job, reason: string, settings: PeriodSettings, now: Date): Promise<void> {
  const row = job.row;
  if (!row) return;
  const p = row.period;
  try {
    await prisma.$transaction((tx) => writePeriodValue(tx, {
      okrId: job.kr.okrId, keyResultId: job.kr.id, periodId: row.periodId, value: row.currentValue ?? row.startValue, mode: "freeze", now, settings,
      source: { refreshedAt: now, pausedSince: row.pausedSince ?? new Date(Math.max(now.getTime(), p.startsAt.getTime())), pausedReason: reason },
    }), TX_OPTS);
  } catch (e) {
    // Closed meanwhile: it keeps what it froze at.
    if (!(e instanceof GoalPeriodRefusal)) throw e;
  }
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
  // A Space source counting another number of Lists says so (C3). Everyone
  // who sees the goal reads its Activity, so the line names the Space only
  // when the whole workspace may open it (C9).
  if (job.source.kind === "space" && row.sourceListCount != null && outcome.listCount != null && row.sourceListCount !== outcome.listCount) {
    const named = outcome.spaceName && (await sourceOpenToWorkspace(orgId, { ...job.source, listIds: [] })) ? outcome.spaceName : null;
    logActivity({ type: "okr_updated", actorId: null, organizationId: orgId, description: listCountChangeWords(named, outcome.listCount, row.sourceListCount), targetId: kr.okrId, targetType: "okr" });
  }
  return value !== row.currentValue;
}

/**
 * The target paused: its reason, and on the FIRST pause (none recorded
 * before) one goal_source_paused Inbox row to the owner and to the
 * connector (never `except`: the leaver at a handover). No repeat while it
 * stays paused; the reason may change.
 */
async function markPaused(orgId: string, kr: TargetRow, reason: string, now: Date, opts: { except?: string } = {}): Promise<void> {
  const first = await prisma.keyResult.updateMany({ where: { id: kr.id, sourcePausedReason: null }, data: { sourcePausedReason: reason, sourceRefreshedAt: now } });
  if (first.count === 0) {
    await prisma.keyResult.updateMany({ where: { id: kr.id }, data: { sourcePausedReason: reason, sourceRefreshedAt: now } });
    return;
  }
  await notifySourcePaused(orgId, kr.okr, kr.title, reason, [kr.okr.ownerId, kr.sourceById].filter((u) => u !== opts.except));
}

/**
 * goal_source_paused (F, C10): "{goal}: {target} stopped counting." with
 * the reason, to the goal. Only to people who still work here: not deleted,
 * not deactivated, and holding a level in THIS workspace (a person removed
 * from it keeps an active account elsewhere, and the goal is not theirs to
 * open any more).
 */
export async function notifySourcePaused(
  orgId: string,
  goal: { id: string; title: string },
  target: string,
  reason: string,
  to: ReadonlyArray<string | null>,
): Promise<number> {
  const users = [...new Set(to.filter((u): u is string => !!u))];
  if (users.length === 0) return 0;
  const active = await prisma.user.findMany({ where: { id: { in: users }, deletedAt: null, status: { not: "INACTIVE" } }, select: { id: true } });
  // Two people at most (the owner and the connector), each read fresh.
  const held = await Promise.all(active.map(async (u) => ((await levelHeldIn(u.id, orgId)) ? u : null)));
  const live = held.filter((u): u is (typeof active)[number] => !!u);
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
 * the List, Space or table); any that fail stay with the leaver, paused, and
 * the owner's Inbox row says why. Returns what moved and what stayed.
 */
export async function handOverGoalSources(orgId: string, fromId: string, toId: string): Promise<{ moved: number; paused: number }> {
  const targets = await prisma.keyResult.findMany({ where: { sourceById: fromId, okr: { organizationId: orgId } }, select: TARGET_SELECT });
  const sourced = targets.map((kr) => ({ kr, source: parseConnectedSource(kr.source) })).filter((t): t is { kr: TargetRow; source: ConnectedSource } => !!t.source);
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
    // The owner hears it; the leaver is never told about their own leaving.
    await markPaused(orgId, kr, PAUSE.left(leaver?.firstName?.trim() || null), new Date(), { except: fromId });
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
  /** What it counts: a List or Space, or a table (the editor's Measured by). */
  kind: "list" | "table";
  /** "From Sales pipeline", "From 3 Lists", "From Marketing", "From Hiring log", "From a private List" or "From a private table". */
  label: string;
  /** The viewer cannot open the source: no name, no link, no settings (C9). */
  private: boolean;
  /** Open source, for a viewer who can open it (a table: while Tables is on). */
  href: string | null;
  /** Reconnect may be offered (to an editor, while paused): the viewer can open the source, and for a table Tables is on. */
  reconnectable: boolean;
  /** Who connected it: for an editor only (C9: an editor reads it on a private source). */
  connectorName: string | null;
  /** Why it stopped counting (for an editor; "Paused" for everyone else), or null. */
  paused: string | null;
  /** The source's settings, for the target editor; null when private. */
  settings: Record<string, unknown> | null;
}

/**
 * C9 for the goal page: each target counted from a List or a table as THIS
 * viewer may see it. Everyone who sees the goal sees the number; one who
 * cannot open the source reads "From a private List" or "From a private
 * table" with no name, link or settings. Who connected it and why it paused
 * are an editor's (C9, C10): the reason can name the connector and what they
 * lost, so anyone else reads "Paused".
 * This is the ONE place a source's settings leave the server: the goal
 * routes and the profile strip them (alignment.ts enrichKeyResults).
 */
export async function describeTargetSources(
  orgId: string,
  viewerId: string,
  targets: ReadonlyArray<{ id: string; source: unknown; sourceById: string | null; sourcePausedReason: string | null }>,
  opts: { canEdit?: boolean } = {},
): Promise<Map<string, TargetSourceView>> {
  const editor = opts.canEdit === true;
  const out = new Map<string, TargetSourceView>();
  const sourced = targets.map((t) => ({ t, s: parseConnectedSource(t.source) })).filter((x): x is { t: (typeof targets)[number]; s: ConnectedSource } => !!x.s);
  if (sourced.length === 0) return out;
  const viewer = (await actingPerson(orgId, viewerId))?.viewer ?? null;
  // Tables off (C10): a table source names its table to who can open it, with no link and no Reconnect.
  const tablesOn = sourced.some((x) => x.s.kind === "table") ? await tablesModuleOn(orgId) : true;
  const lists = sourced.map((x) => x.s).filter((s): s is ListSource => s.kind !== "table");
  const listIds = [...new Set(lists.flatMap((s) => s.listIds))];
  const spaceIds = [...new Set(lists.map((s) => s.spaceId).filter((v): v is string => !!v))];
  const tableIds = [...new Set(sourced.map((x) => (x.s.kind === "table" ? x.s.tableId : null)).filter((v): v is string => !!v))];
  const connectorIds = [...new Set(sourced.map((x) => x.t.sourceById).filter((v): v is string => !!v))];
  const [boards, spaces, tables, people] = await Promise.all([
    listIds.length ? prisma.board.findMany({ where: { id: { in: listIds }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : Promise.resolve([]),
    spaceIds.length ? prisma.space.findMany({ where: { id: { in: spaceIds }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : Promise.resolve([]),
    tableIds.length ? prisma.dataTable.findMany({ where: { id: { in: tableIds }, organizationId: orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
    connectorIds.length ? prisma.user.findMany({ where: { id: { in: connectorIds } }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
  ]);
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const nameOf = new Map(people.map((p) => [p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null]));
  for (const { t, s } of sourced) {
    const opens = viewer ? await viewerCanOpenSource(orgId, s, viewer) : false;
    const connectorName = editor && t.sourceById ? nameOf.get(t.sourceById) ?? null : null;
    const paused = pauseWordsFor(t.sourcePausedReason, editor);
    const kind = s.kind === "table" ? "table" : "list";
    if (!opens) {
      out.set(t.id, { kind, label: s.kind === "table" ? PRIVATE_TABLE_WORDS : PRIVATE_LIST_WORDS, private: true, href: null, reconnectable: false, connectorName, paused, settings: null });
      continue;
    }
    if (s.kind === "table") {
      const tb = tableById.get(s.tableId);
      out.set(t.id, {
        kind, label: tb ? `From ${tb.name}` : "From a table", private: false, href: tb && tablesOn ? `/tables/${tb.id}` : null, reconnectable: tablesOn,
        connectorName, paused, settings: serializeConnectedSource(s),
      });
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
    out.set(t.id, { kind, label, private: false, href, reconnectable: true, connectorName, paused, settings: serializeListSource(s) });
  }
  return out;
}
