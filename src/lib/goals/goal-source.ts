// A target counted from a List (docs/plans/recurring-goals.md C3, C7, C9,
// C10): the stored shape, its checks, the window, the date keys, the sum
// and average, the signature and the pause rules. Pure: no prisma, so the
// target editor, the routes and the server count read the same rules.
//
// THE STORED SHAPE (KeyResult.source):
//   { kind: "list", listIds, metric, filter, countedBy, dateFieldKey }   Choose Lists
//   { kind: "space", spaceId, metric, filter, countedBy, dateFieldKey }  A Space (its Lists now)
// metric is Count of tasks, Sum of or Average of a number field (NUMBER,
// MONEY, PERCENT, RATING); filter is the dashboard card's WidgetFilter,
// unchanged; countedBy is the window: Done date, Created date, Due date, a
// Date field of the Lists, or Right now (no window). Not "All my Lists": that
// set is every List the counting person can open, so the number would jump
// whenever their access changed.
//
// DATES ARE KEYS (C3). A value is compared as its yyyy-mm-dd day in the
// workspace zone: a bare date string is its own key; an instant at exactly
// 00:00:00.000Z (the Gantt's date-only write) is its UTC day; any other
// instant is its day in the workspace zone. So a task due 1 November counts
// in November in Kolkata and in New York, however it was written.

import { EMPTY_FILTER, MAX_WIDGET_LISTS, MAX_WIDGET_RULES, type WidgetFilter, type WidgetRule, type WidgetSource } from "@/lib/dashboards/widgets";
import { FILTER_OPERATORS, type FilterOperatorName } from "@/lib/list-comfort";
import { dayKeyInZone } from "@/lib/item-date";
import { firstDayKey, lastDayKey, startOfZonedDay, type GoalPeriodRange, type PeriodSettings } from "@/lib/goals/goal-period";
import { parseTableSource, serializeTableSource, type TableSource } from "@/lib/goals/table-source";

/** The cap after the window (C3): over it the source pauses, never a silently cut number. */
export const LIST_SOURCE_CAP = 20_000;

export type ListCountedBy = "done" | "created" | "due" | "field" | "now";
export type ListMetric = { op: "count" } | { op: "sum" | "average"; fieldKey: string };

export interface ListSource {
  kind: "list" | "space";
  /** Choose Lists. */
  listIds: string[];
  /** A Space. */
  spaceId: string | null;
  metric: ListMetric;
  filter: WidgetFilter;
  countedBy: ListCountedBy;
  /** The Date field counted by, for countedBy "field". */
  dateFieldKey: string | null;
}

/** The number-like field types a target may add up (C3). */
export const GOAL_NUMBER_TYPES: ReadonlySet<string> = new Set(["NUMBER", "MONEY", "PERCENT", "RATING"]);
/** The field types "a Date field" may be. */
export const GOAL_DATE_TYPES: ReadonlySet<string> = new Set(["DATE", "DATETIME"]);

export const COUNTED_BY_LABEL: Record<ListCountedBy, string> = {
  done: "Done date",
  created: "Created date",
  due: "Due date",
  field: "A Date field",
  now: "Right now",
};

const COUNTED: ReadonlySet<string> = new Set(["done", "created", "due", "field", "now"]);

function recordOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

function filterOf(raw: unknown): WidgetFilter | null {
  if (raw === undefined || raw === null) return { ...EMPTY_FILTER, rules: [] };
  const f = recordOf(raw);
  if (!f) return null;
  const rules: WidgetRule[] = [];
  const list = f.rules === undefined ? [] : f.rules;
  if (!Array.isArray(list) || list.length > MAX_WIDGET_RULES) return null;
  for (const r of list) {
    const o = recordOf(r);
    if (!o || !isKey(o.field) || typeof o.operator !== "string" || !(FILTER_OPERATORS as readonly string[]).includes(o.operator)) return null;
    if (o.value !== undefined && typeof o.value !== "string") return null;
    rules.push({ field: o.field, operator: o.operator as FilterOperatorName, value: typeof o.value === "string" ? o.value.slice(0, 200) : "" });
  }
  return { connector: f.connector === "OR" ? "OR" : "AND", rules, hideDone: f.hideDone === true };
}

/**
 * A List or Space source as stored or sent, or null when it is not one (a
 * KPI combine, a table, or something malformed). The one reader: the
 * routes refuse what this cannot read, and the count reads what it reads.
 */
export function parseListSource(raw: unknown): ListSource | null {
  const s = recordOf(raw);
  if (!s || (s.kind !== "list" && s.kind !== "space")) return null;
  let listIds: string[] = [];
  let spaceId: string | null = null;
  if (s.kind === "list") {
    if (!Array.isArray(s.listIds)) return null;
    listIds = [...new Set(s.listIds.filter(isId))];
    if (listIds.length === 0 || listIds.length > MAX_WIDGET_LISTS || listIds.length !== s.listIds.length) return null;
  } else {
    if (!isId(s.spaceId)) return null;
    spaceId = s.spaceId;
  }
  const m = recordOf(s.metric) ?? { op: "count" };
  let metric: ListMetric;
  if (m.op === "count") metric = { op: "count" };
  else if ((m.op === "sum" || m.op === "average") && isKey(m.fieldKey)) metric = { op: m.op, fieldKey: m.fieldKey };
  else return null;
  const filter = filterOf(s.filter);
  if (!filter) return null;
  const countedBy = typeof s.countedBy === "string" && COUNTED.has(s.countedBy) ? (s.countedBy as ListCountedBy) : null;
  if (!countedBy) return null;
  const dateFieldKey = countedBy === "field" ? (isKey(s.dateFieldKey) ? s.dateFieldKey : null) : null;
  if (countedBy === "field" && !dateFieldKey) return null;
  // Counted by Done date, every row is a completion, so Hide completed would
  // always leave 0: it does not apply (the editor hides the toggle) and is
  // read as off, here, the one reader.
  if (countedBy === "done") filter.hideDone = false;
  return { kind: s.kind, listIds, spaceId, metric, filter, countedBy, dateFieldKey };
}

/** The stored JSON of a source (exactly the keys parseListSource reads). */
export function serializeListSource(s: ListSource): Record<string, unknown> {
  return {
    kind: s.kind,
    ...(s.kind === "list" ? { listIds: s.listIds } : { spaceId: s.spaceId }),
    metric: s.metric,
    filter: s.filter,
    countedBy: s.countedBy,
    ...(s.countedBy === "field" ? { dateFieldKey: s.dateFieldKey } : {}),
  };
}

/** The dashboard source the row loader resolves (widget-data.ts sourceResolver). */
export function widgetSourceOf(s: ListSource): WidgetSource {
  return s.kind === "space" ? { kind: "space", spaceId: s.spaceId ?? "" } : { kind: "lists", listIds: s.listIds };
}

/** Counted inside a window (every way but Right now, a List's or a table's): grace and the final refresh apply (C3, C5). */
export function isWindowed(s: { countedBy: string }): boolean {
  return s.countedBy !== "now";
}

/** Two sources count the same thing (a PATCH that sends the stored one back keeps its connector). */
export function sameListSource(a: unknown, b: unknown): boolean {
  const x = parseListSource(a);
  const y = parseListSource(b);
  return !!x && !!y && JSON.stringify(serializeListSource(x)) === JSON.stringify(serializeListSource(y));
}

/* ───────────────────────── A List or a table (C2, C5) ───────────────────────── */

/** What a connected source counts: a List or Space (C3), or a table (C5, table-source.ts). */
export type ConnectedSource = ListSource | TableSource;

/** A List, Space or table source as stored or sent, or null when it is none of them. */
export function parseConnectedSource(raw: unknown): ConnectedSource | null {
  return parseListSource(raw) ?? parseTableSource(raw);
}

/** The stored JSON of a connected source. */
export function serializeConnectedSource(s: ConnectedSource): Record<string, unknown> {
  return s.kind === "table" ? serializeTableSource(s) : serializeListSource(s);
}

/** Two connected sources count the same thing (a PATCH that sends the stored one back keeps its connector). */
export function sameConnectedSource(a: unknown, b: unknown): boolean {
  const x = parseConnectedSource(a);
  const y = parseConnectedSource(b);
  return !!x && !!y && JSON.stringify(serializeConnectedSource(x)) === JSON.stringify(serializeConnectedSource(y));
}

/* ───────────────────────── The window and date keys (C3) ───────────────────────── */

/** The window a count reads, as workspace-zone day keys (inclusive) and instants (end exclusive); null ends are open. */
export interface SourceWindow {
  firstKey: string | null;
  lastKey: string | null;
  from: Date | null;
  to: Date | null;
}

/** A period's window: its first to its last day in the workspace zone. */
export function periodWindow(p: Pick<GoalPeriodRange, "startsAt" | "endsAt">, s: PeriodSettings): SourceWindow {
  return { firstKey: firstDayKey(p, s), lastKey: lastDayKey(p, s), from: p.startsAt, to: p.endsAt };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function nextKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * A one-time goal's window (C2): its start date to its due date, both read
 * as days in the workspace zone (stored as UTC midnight, cut to their
 * first 10 characters like every reader of them). A missing end is open.
 */
export function goalDatesWindow(startDate: Date | null, endDate: Date | null, zone: string): SourceWindow {
  const firstKey = startDate ? startDate.toISOString().slice(0, 10) : null;
  const lastKey = endDate ? endDate.toISOString().slice(0, 10) : null;
  return {
    firstKey,
    lastKey,
    from: firstKey ? startOfZonedDay(firstKey, zone) : null,
    to: lastKey ? startOfZonedDay(nextKey(lastKey), zone) : null,
  };
}

/** C3's rule: the yyyy-mm-dd day a date value stands for in the workspace zone, or null when it is no date. */
export function dateKeyOf(value: unknown, zone: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (DAY_KEY.test(t)) return t;
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(t)) return t.slice(0, 10);
  }
  const d = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  if (d.getTime() % DAY === 0) return d.toISOString().slice(0, 10);
  const key = dayKeyInZone(d, { timezone: zone });
  return key || null;
}

/** Whether a day key falls inside the window. */
export function keyInWindow(key: string | null, w: SourceWindow): boolean {
  if (!key) return false;
  if (w.firstKey && key < w.firstKey) return false;
  if (w.lastKey && key > w.lastKey) return false;
  return true;
}

/**
 * The SQL half of a window on an instant column (createdAt, dueAt, doneAt):
 * a day and a half either side of the zone's own bounds, so no value whose
 * key is inside can be left out (a UTC-midnight date read as its UTC day,
 * any zone up to 14 hours away); the exact key test runs in memory after.
 */
export function looseInstantRange(w: SourceWindow): { gte?: Date; lt?: Date } {
  const slack = 1.5 * DAY;
  return {
    ...(w.from ? { gte: new Date(w.from.getTime() - slack) } : {}),
    ...(w.to ? { lt: new Date(w.to.getTime() + slack) } : {}),
  };
}

/**
 * The SQL half of a window on a Date field (a string in Item.metadata): the
 * prefixes a value inside it can start with (each month the window covers,
 * and the day either side, where an instant written in another zone can
 * land), for an OR of string_starts_with. Null when the window is open at an
 * end, or would need more prefixes than a query should carry (the field
 * being set is the SQL half then).
 */
export function fieldPrefixes(w: SourceWindow): string[] | null {
  if (!w.firstKey || !w.lastKey) return null;
  const before = previousKey(w.firstKey);
  const after = nextKey(w.lastKey);
  const out = new Set<string>([before, after]);
  let cursor = w.firstKey.slice(0, 7);
  const last = w.lastKey.slice(0, 7);
  for (let i = 0; i < 400 && cursor <= last; i++) {
    out.add(cursor);
    const [y, m] = cursor.split("-").map(Number);
    cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return out.size > 40 ? null : [...out].sort();
}

function previousKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/* ───────────────────────── The number (C3) ───────────────────────── */

function numberOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Count of the rows, or Sum of or Average of a number field over them
 * (non-numbers ignored, as the dashboard's sum ignores them). An average of
 * nothing is null: the target reads its starting number.
 */
export function aggregateRows(rows: ReadonlyArray<{ metadata: Record<string, unknown> }>, metric: ListMetric): number | null {
  if (metric.op === "count") return rows.length;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const v = numberOf(r.metadata[metric.fieldKey]);
    if (v == null) continue;
    sum += v;
    n += 1;
  }
  if (metric.op === "sum") return sum;
  return n === 0 ? null : sum / n;
}

/** The source signature (C7): a recount is skipped while it is unchanged. */
export function sourceSignature(parts: ReadonlyArray<string | number | null | undefined>): string {
  // FNV-1a over the joined parts: short, stable, and never a stored secret.
  let h = 0x811c9dc5;
  const text = parts.map((p) => (p == null ? "" : String(p))).join("|");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v1:${h.toString(36)}:${text.length}`;
}

/* ───────────────────────── Pauses (C10) and the private words (C9) ───────────────────────── */

/** The words a paused source shows (its tooltip) and the Inbox row names. */
export const PAUSE = {
  left: (name: string | null) => `${name || "The person who connected it"} no longer works here. Reconnect it.`,
  lostList: (name: string | null) => `${name || "The person who connected it"} can no longer open a List it counts. Reconnect it.`,
  lostSpace: (name: string | null) => `${name || "The person who connected it"} can no longer open the Space it counts. Reconnect it.`,
  lostGoal: (name: string | null) => `${name || "The person who connected it"} can no longer edit this goal. Reconnect it.`,
  listGone: "A List it counts was deleted or moved to Trash.",
  listArchived: "A List it counts was archived.",
  spaceGone: "The Space it counts was deleted or moved to Trash.",
  fieldGone: "The field it adds up was removed.",
  dateFieldGone: "The date field it counts by was removed.",
  tooMany: "Too many tasks to count. Narrow the filter.",
} as const;

/**
 * What a paused source says to someone who may not edit the goal (C10: the
 * reason is in the tooltip for editors). The reason can name the connector
 * and what they lost, so it stays with the editors.
 */
export const PAUSED_WORD = "Paused";

/** A stored pause reason as one viewer reads it: the reason for an editor, "Paused" for everyone else, null when counting. */
export function pauseWordsFor(reason: string | null | undefined, editor: boolean): string | null {
  if (!reason) return null;
  return editor ? reason : PAUSED_WORD;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Oct": the workspace-zone day a source paused on, for "Paused from 14 Oct" (C10). Null when it is no date. */
export function pausedFromDay(at: Date | string, zone: string): string | null {
  const key = dayKeyInZone(at instanceof Date ? at : new Date(at), { timezone: zone });
  if (!DAY_KEY.test(key)) return null;
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

/** The words a viewer who cannot open the source reads in place of its name (C9). */
export const PRIVATE_LIST_WORDS = "From a private List";
export const PRIVATE_TABLE_WORDS = "From a private table";
/** The audience line before saving a source not open to the whole workspace (C9). */
export const AUDIENCE_LINE = "Everyone who can see this goal will see this number.";

/**
 * C10: a target paused for more than half a period is left out of that
 * period's progress and score. `at` is the moment it is judged (now for a
 * live read, the close for the freeze); the pause counts inside the period
 * only.
 */
export function pausedTooLong(
  row: { pausedSince: Date | null },
  period: { startsAt: Date; endsAt: Date },
  at: Date,
): boolean {
  if (!row.pausedSince) return false;
  const from = Math.max(row.pausedSince.getTime(), period.startsAt.getTime());
  const to = Math.min(at.getTime(), period.endsAt.getTime());
  return to - from > (period.endsAt.getTime() - period.startsAt.getTime()) / 2;
}

/** "Now counting 6 Lists in Marketing, was 5": the Activity line when a Space source's set changes (C3). */
export function listCountChangeWords(spaceName: string | null, now: number, was: number): string {
  const lists = `${now} ${now === 1 ? "List" : "Lists"}`;
  return `Now counting ${lists}${spaceName ? ` in ${spaceName}` : ""}, was ${was}`;
}
