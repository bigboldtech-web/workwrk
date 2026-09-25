// Dashboard widgets: the stored shape, the write shape and the redaction.
//
// Decision 1 reverses the 2026-08-28 removal. A dashboard is a list of cards
// over ANY set of Lists the viewer can read:
//   stat   a count, or a sum of a number field, over tasks matching a filter
//   chart  a distribution by status, assignee, priority or a field, as a bar
//          or a donut
//   list   an embedded List view: the first tasks matching a filter
//   notes  free text
// A Space Overview is the same set pinned to one Space (Dashboard.spaceId).
//
// READING OLD ROWS. Dashboards saved by the 2026-06 engine are still in
// Dashboard.widgets: { id, type: task-list | stat | notes | battery | chart,
// title, config: { source: all | board, statScope, chartBy, chartKind,
// noteText }, layout }. parseWidgets reads that shape into this one, so those
// cards come back as the cards they were.
//
// NO SAVED CARD IS EVER DROPPED. An entry this file does not recognise is
// carried as { kind: "passthrough", raw } and written back verbatim, a
// PATCH may only remove a card it names in removedWidgetIds, and a submitted
// passthrough is replaced by the STORED raw value, so no client can write
// arbitrary JSON through one either.
//
// A STORED LIST ID IS NEVER A GRANT. Every card is computed under the
// VIEWER's own access (widget-data.ts), and redactWidgetsForReader decides
// what a non-editor may even see of a card's configuration.
//
// Pure: zod and list-comfort's operator list.

import { z } from "zod";
import { FILTER_OPERATORS, type FilterOperatorName } from "@/lib/list-comfort";

export const WIDGET_LIMIT = 30;
export const GRID_COLS = 12;
export const MAX_WIDGET_LISTS = 50;
export const MAX_WIDGET_RULES = 20;
export const MAX_LIST_ROWS = 50;

/** The built-in fields a filter may name; anything else is a custom field key. */
export const BUILTIN_FILTER_FIELDS = ["status", "assignee", "priority", "due", "tags", "title", "type"] as const;
const BUILTIN_FIELDS: ReadonlySet<string> = new Set(BUILTIN_FILTER_FIELDS);

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WidgetSource =
  | { kind: "all" }
  | { kind: "space"; spaceId: string }
  | { kind: "lists"; listIds: string[] };

export interface WidgetRule {
  field: string;
  operator: FilterOperatorName;
  value: string;
}

export interface WidgetFilter {
  connector: "AND" | "OR";
  rules: WidgetRule[];
  hideDone: boolean;
}

export type StatMetric = { op: "count" } | { op: "sum"; fieldKey: string };
export type StatScope = "open" | "total" | "completed" | "overdue";
export type ChartGroupBy = "status" | "assignee" | "priority" | { field: string };
export type ChartDisplay = "bar" | "donut";
export type ListSort = "due" | "updated" | "created" | "priority" | "title";

interface Base {
  id: string;
  title: string;
  layout: WidgetLayout;
}

export type StatWidget = Base & { kind: "stat"; source: WidgetSource; filter: WidgetFilter; metric: StatMetric; scope: StatScope };
export type ChartWidget = Base & { kind: "chart"; source: WidgetSource; filter: WidgetFilter; groupBy: ChartGroupBy; display: ChartDisplay };
export type ListWidget = Base & { kind: "list"; source: WidgetSource; filter: WidgetFilter; sort: ListSort; limit: number };
export type NotesWidget = Base & { kind: "notes"; text: string };
export type PassthroughWidget = { id: string; kind: "passthrough"; raw: unknown; layout?: WidgetLayout };
export type DataWidget = StatWidget | ChartWidget | ListWidget;
export type Widget = DataWidget | NotesWidget | PassthroughWidget;
/** What a reader receives for a card they may not see. */
export type HiddenWidget = { id: string; kind: "hidden"; layout?: WidgetLayout };

export const EMPTY_FILTER: WidgetFilter = { connector: "AND", rules: [], hideDone: false };

// ── Reading ──────────────────────────────────────────────────────────

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

function parseLayout(raw: unknown): WidgetLayout {
  const l = asObject(raw) ?? {};
  return {
    x: clampInt(l.x, 0, GRID_COLS - 1, 0),
    y: clampInt(l.y, 0, 10000, 0),
    w: clampInt(l.w, 1, GRID_COLS, 4),
    h: clampInt(l.h, 1, 60, 4),
  };
}

function parseTitle(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 120) : fallback;
}

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 64;
}

function parseSource(raw: unknown): WidgetSource | null {
  const s = asObject(raw);
  if (!s) return null;
  if (s.kind === "all") return { kind: "all" };
  if (s.kind === "space" && isId(s.spaceId)) return { kind: "space", spaceId: s.spaceId };
  if (s.kind === "lists" && Array.isArray(s.listIds)) {
    const ids = Array.from(new Set(s.listIds.filter(isId))).slice(0, MAX_WIDGET_LISTS);
    return ids.length ? { kind: "lists", listIds: ids } : null;
  }
  // The 2026-06 shape: one List, by id.
  if (s.kind === "board" && isId(s.boardId)) return { kind: "lists", listIds: [s.boardId] };
  return null;
}

function parseFilter(raw: unknown): WidgetFilter {
  const f = asObject(raw);
  if (!f) return { ...EMPTY_FILTER, rules: [] };
  const rules: WidgetRule[] = [];
  for (const r of Array.isArray(f.rules) ? f.rules : []) {
    const o = asObject(r);
    if (!o || typeof o.field !== "string" || !o.field || o.field.length > 64) continue;
    if (typeof o.operator !== "string" || !(FILTER_OPERATORS as readonly string[]).includes(o.operator)) continue;
    rules.push({ field: o.field, operator: o.operator as FilterOperatorName, value: typeof o.value === "string" ? o.value.slice(0, 200) : "" });
    if (rules.length >= MAX_WIDGET_RULES) break;
  }
  return { connector: f.connector === "OR" ? "OR" : "AND", rules, hideDone: f.hideDone === true };
}

function parseGroupBy(raw: unknown): ChartGroupBy | null {
  if (raw === "status" || raw === "assignee" || raw === "priority") return raw;
  const o = asObject(raw);
  if (o && typeof o.field === "string" && o.field && o.field.length <= 64) return { field: o.field };
  return null;
}

const SCOPES: ReadonlySet<string> = new Set(["open", "total", "completed", "overdue"]);
const SORTS: ReadonlySet<string> = new Set(["due", "updated", "created", "priority", "title"]);

/** The current shape; null means "not recognisable", which becomes a passthrough. */
function parseCurrent(o: Record<string, unknown>, id: string): Widget | null {
  const layout = parseLayout(o.layout);
  if (o.kind === "notes") {
    return { id, kind: "notes", title: parseTitle(o.title, "Notes"), text: typeof o.text === "string" ? o.text.slice(0, 20000) : "", layout };
  }
  const source = parseSource(o.source);
  if (!source) return null;
  const filter = parseFilter(o.filter);
  if (o.kind === "stat") {
    const m = asObject(o.metric);
    let metric: StatMetric = { op: "count" };
    if (m?.op === "sum") {
      if (typeof m.fieldKey !== "string" || !m.fieldKey) return null;
      metric = { op: "sum", fieldKey: m.fieldKey };
    }
    const scope = typeof o.scope === "string" && SCOPES.has(o.scope) ? (o.scope as StatScope) : "total";
    return { id, kind: "stat", title: parseTitle(o.title, "Calculation"), source, filter, metric, scope, layout };
  }
  if (o.kind === "chart") {
    const groupBy = parseGroupBy(o.groupBy);
    if (!groupBy) return null;
    return { id, kind: "chart", title: parseTitle(o.title, "Chart"), source, filter, groupBy, display: o.display === "donut" ? "donut" : "bar", layout };
  }
  if (o.kind === "list") {
    const sort = typeof o.sort === "string" && SORTS.has(o.sort) ? (o.sort as ListSort) : "updated";
    return { id, kind: "list", title: parseTitle(o.title, "Tasks"), source, filter, sort, limit: clampInt(o.limit, 1, MAX_LIST_ROWS, 10), layout };
  }
  return null;
}

const LEGACY_TYPES: ReadonlySet<string> = new Set(["task-list", "stat", "notes", "battery", "chart"]);

/** The 2026-06 shape, read into the current one. */
function parseLegacy(o: Record<string, unknown>, id: string): Widget | null {
  const cfg = asObject(o.config) ?? {};
  const layout = parseLayout(o.layout);
  const source: WidgetSource = parseSource(cfg.source) ?? { kind: "all" };
  const filter: WidgetFilter = { ...EMPTY_FILTER, rules: [] };
  switch (o.type) {
    case "notes":
      return { id, kind: "notes", title: parseTitle(o.title, "Notes"), text: typeof cfg.noteText === "string" ? cfg.noteText.slice(0, 20000) : "", layout };
    case "task-list":
      return { id, kind: "list", title: parseTitle(o.title, "Task List"), source, filter, sort: "updated", limit: 10, layout };
    case "stat": {
      const scope = typeof cfg.statScope === "string" && SCOPES.has(cfg.statScope) ? (cfg.statScope as StatScope) : "open";
      return { id, kind: "stat", title: parseTitle(o.title, "Calculation"), source, filter, metric: { op: "count" }, scope, layout };
    }
    case "battery":
      return { id, kind: "chart", title: parseTitle(o.title, "Workload by Status"), source, filter, groupBy: "status", display: "bar", layout };
    case "chart": {
      const groupBy = cfg.chartBy === "assignee" || cfg.chartBy === "priority" ? cfg.chartBy : "status";
      return { id, kind: "chart", title: parseTitle(o.title, "Chart"), source, filter, groupBy, display: cfg.chartKind === "pie" ? "donut" : "bar", layout };
    }
  }
  return null;
}

/**
 * Dashboard.widgets, as stored, into the current list. Never throws and
 * never drops an entry: an unrecognised one is a passthrough, a duplicate id
 * is given a unique one so both survive, and an entry with no id gets a
 * stable one from its position.
 */
export function parseWidgets(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const o = asObject(entry);
    let id = o && isId(o.id) ? o.id : `legacy-${index}`;
    const duplicate = seen.has(id);
    if (duplicate) id = `dup-${index}-${id}`.slice(0, 64);
    seen.add(id);
    let parsed: Widget | null = null;
    if (o && !duplicate) {
      if (typeof o.kind === "string" && ["stat", "chart", "list", "notes"].includes(o.kind)) parsed = parseCurrent(o, id);
      else if (typeof o.type === "string" && LEGACY_TYPES.has(o.type)) parsed = parseLegacy(o, id);
    }
    out.push(parsed ?? { id, kind: "passthrough", raw: entry, ...(o?.layout ? { layout: parseLayout(o.layout) } : {}) });
  });
  return out;
}

/** The JSON to persist. A passthrough is written back exactly as it was read. */
export function serializeWidgets(widgets: readonly Widget[]): unknown[] {
  return widgets.map((w) => {
    if (w.kind === "passthrough") return w.raw;
    if (w.kind === "notes") return { id: w.id, kind: w.kind, title: w.title, text: w.text, layout: w.layout };
    const common = { id: w.id, kind: w.kind, title: w.title, source: w.source, filter: w.filter, layout: w.layout };
    if (w.kind === "stat") return { ...common, metric: w.metric, scope: w.scope };
    if (w.kind === "chart") return { ...common, groupBy: w.groupBy, display: w.display };
    return { ...common, sort: w.sort, limit: w.limit };
  });
}

// ── Writing ──────────────────────────────────────────────────────────

const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_~.-]+$/);
const layoutSchema = z.object({
  x: z.number().int().min(0).max(GRID_COLS - 1),
  y: z.number().int().min(0).max(10000),
  w: z.number().int().min(1).max(GRID_COLS),
  h: z.number().int().min(1).max(60),
});
const ruleSchema = z.object({ field: z.string().min(1).max(64), operator: z.enum(FILTER_OPERATORS), value: z.string().max(200) });
const filterSchema = z.object({
  connector: z.enum(["AND", "OR"]).optional(),
  rules: z.array(ruleSchema).max(MAX_WIDGET_RULES).optional(),
  hideDone: z.boolean().optional(),
});
const sourceSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("space"), spaceId: idSchema }),
  z.object({ kind: z.literal("lists"), listIds: z.array(idSchema).min(1).max(MAX_WIDGET_LISTS) }),
]);
const titleSchema = z.string().trim().min(1).max(120);

export const widgetInputSchema = z.discriminatedUnion("kind", [
  z.object({
    id: idSchema,
    kind: z.literal("stat"),
    title: titleSchema,
    source: sourceSchema,
    filter: filterSchema.optional(),
    metric: z.union([z.object({ op: z.literal("count") }), z.object({ op: z.literal("sum"), fieldKey: z.string().min(1).max(64) })]).optional(),
    scope: z.enum(["open", "total", "completed", "overdue"]).optional(),
    layout: layoutSchema,
  }),
  z.object({
    id: idSchema,
    kind: z.literal("chart"),
    title: titleSchema,
    source: sourceSchema,
    filter: filterSchema.optional(),
    groupBy: z.union([z.enum(["status", "assignee", "priority"]), z.object({ field: z.string().min(1).max(64) })]),
    display: z.enum(["bar", "donut"]).optional(),
    layout: layoutSchema,
  }),
  z.object({
    id: idSchema,
    kind: z.literal("list"),
    title: titleSchema,
    source: sourceSchema,
    filter: filterSchema.optional(),
    sort: z.enum(["due", "updated", "created", "priority", "title"]).optional(),
    limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional(),
    layout: layoutSchema,
  }),
  z.object({ id: idSchema, kind: z.literal("notes"), title: titleSchema, text: z.string().max(20000), layout: layoutSchema }),
  // A passthrough names a stored card and carries nothing: its value is the
  // stored one (resolvePassthrough).
  z.object({ id: idSchema, kind: z.literal("passthrough") }),
]);

export type WidgetInput = z.infer<typeof widgetInputSchema>;

function normalizeFilter(f: z.infer<typeof filterSchema> | undefined): WidgetFilter {
  return { connector: f?.connector ?? "AND", rules: (f?.rules ?? []).map((r) => ({ ...r })), hideDone: f?.hideDone ?? false };
}

function normalizeSource(s: z.infer<typeof sourceSchema>): WidgetSource {
  return s.kind === "lists" ? { kind: "lists", listIds: Array.from(new Set(s.listIds)) } : s;
}

/**
 * Submitted cards, as stored cards. A passthrough is resolved against the
 * STORED list: it must name a stored passthrough, and it becomes that stored
 * value, so no client can write arbitrary JSON through one.
 */
export function resolvePassthrough(
  submitted: readonly WidgetInput[],
  stored: readonly Widget[],
): { ok: true; widgets: Widget[] } | { ok: false; error: "unknown_widget" | "duplicate_widget"; id: string } {
  const storedById = new Map(stored.map((w) => [w.id, w] as const));
  const out: Widget[] = [];
  const seen = new Set<string>();
  for (const w of submitted) {
    if (seen.has(w.id)) return { ok: false, error: "duplicate_widget", id: w.id };
    seen.add(w.id);
    if (w.kind === "passthrough") {
      const s = storedById.get(w.id);
      if (!s || s.kind !== "passthrough") return { ok: false, error: "unknown_widget", id: w.id };
      out.push(s);
      continue;
    }
    if (w.kind === "notes") {
      out.push({ id: w.id, kind: "notes", title: w.title, text: w.text, layout: { ...w.layout } });
      continue;
    }
    const common = { id: w.id, title: w.title, source: normalizeSource(w.source), filter: normalizeFilter(w.filter), layout: { ...w.layout } };
    if (w.kind === "stat") out.push({ ...common, kind: "stat", metric: w.metric ?? { op: "count" }, scope: w.scope ?? "total" });
    else if (w.kind === "chart") out.push({ ...common, kind: "chart", groupBy: w.groupBy, display: w.display ?? "bar" });
    else out.push({ ...common, kind: "list", sort: w.sort ?? "updated", limit: w.limit ?? 10 });
  }
  return { ok: true, widgets: out };
}

/**
 * The stored cards a submitted list leaves out without naming them in
 * `removedWidgetIds`. A stale tab, or a client that predates a card kind,
 * would otherwise delete a card simply by not sending it.
 */
export function checkWidgetRemovals(
  stored: readonly Widget[],
  submittedIds: readonly string[],
  removedIds: readonly string[],
): string[] {
  const kept = new Set(submittedIds);
  const removed = new Set(removedIds);
  return stored.map((w) => w.id).filter((id) => !kept.has(id) && !removed.has(id));
}

// ── Redaction ────────────────────────────────────────────────────────

export interface RedactContext {
  /**
   * The Lists a card's source resolves to that THIS viewer can read, or null
   * when the source itself is unreadable (a Space the viewer cannot read).
   */
  readableListsFor: (source: WidgetSource) => readonly string[] | null;
  /** The custom field keys each List defines. */
  fieldKeysByList: ReadonlyMap<string, ReadonlySet<string>>;
}

function hidden(w: Widget): HiddenWidget {
  return { id: w.id, kind: "hidden", ...(w.layout ? { layout: w.layout } : {}) };
}

/**
 * One card as a NON-editor may see it.
 *
 * A notes card holds no List data and is shown. A passthrough, which this
 * release cannot interpret, is hidden. A data card none of whose Lists (or
 * whose Space) the viewer can read is hidden with no title and no config. A
 * partly readable one keeps its title, its List set is reduced to what the
 * viewer can read, and any filter rule on a custom field no readable List in
 * the card defines is removed; a group-by or a sum on such a field would
 * describe the unreadable Lists by itself, so it hides the card instead.
 */
export function redactWidgetForReader(w: Widget, ctx: RedactContext): Widget | HiddenWidget {
  if (w.kind === "notes") return w;
  if (w.kind === "passthrough") return hidden(w);
  const lists = ctx.readableListsFor(w.source);
  if (lists === null) return hidden(w);
  if (w.source.kind === "lists" && lists.length === 0) return hidden(w);
  const keys = new Set<string>();
  for (const id of lists) for (const k of ctx.fieldKeysByList.get(id) ?? []) keys.add(k);
  const known = (field: string) => BUILTIN_FIELDS.has(field) || keys.has(field);
  const source: WidgetSource = w.source.kind === "lists" ? { kind: "lists", listIds: w.source.listIds.filter((id) => lists.includes(id)) } : w.source;
  const filter: WidgetFilter = { ...w.filter, rules: w.filter.rules.filter((r) => known(r.field)) };
  if (w.kind === "chart" && typeof w.groupBy === "object" && !keys.has(w.groupBy.field)) return hidden(w);
  if (w.kind === "stat" && w.metric.op === "sum" && !keys.has(w.metric.fieldKey)) return hidden(w);
  return { ...w, source, filter };
}

export function redactWidgetsForReader(widgets: readonly Widget[], ctx: RedactContext): Array<Widget | HiddenWidget> {
  return widgets.map((w) => redactWidgetForReader(w, ctx));
}
