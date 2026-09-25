// The views a List is born with, and the ones a template brings along.
//
// Every task List ships with the same four views over the SAME tasks: Board,
// List, Calendar, Gantt. Board is first and is the default (decision 8), and
// it is the default by RULE (default-view.ts, rule b), not by a flag: no row
// is written isDefault for it, so a new List never shows a Pin glyph nobody
// set. A List created with another default type (a template that carries a
// real preference) gets that view marked as a pin by its creator, which the
// resolver renders first.
//
// Pure: no database, no framework. board.ts, template-center.ts and the tests
// all read the same rows from here.

import { withoutPinnedDefault, withPinnedDefault, type PinnedDefaultMark } from "./default-view";

export type CoreListViewType = "KANBAN" | "TABLE" | "CALENDAR" | "GANTT";
export type TaskListViewType = CoreListViewType | "TIMELINE";

/** The four views every task List ships with, Board first. */
export const CORE_LIST_VIEWS: ReadonlyArray<{ type: CoreListViewType; name: string }> = [
  { type: "KANBAN", name: "Board" },
  { type: "TABLE", name: "List" },
  { type: "CALENDAR", name: "Calendar" },
  { type: "GANTT", name: "Gantt" },
];

/** The view types that make a List a task List (the rest are single-view Lists: Doc, Form, Canvas...). */
export const TASK_LIST_VIEW_TYPES: ReadonlySet<string> = new Set<TaskListViewType>([
  "TABLE",
  "KANBAN",
  "CALENDAR",
  "GANTT",
  "TIMELINE",
]);

const TASK_VIEW_LABEL: Record<TaskListViewType, string> = {
  KANBAN: "Board",
  TABLE: "List",
  CALENDAR: "Calendar",
  GANTT: "Gantt",
  TIMELINE: "Timeline",
};

/** The List view opens grouped by status (ClickUp parity); the others start empty. */
function seedConfig(type: string): Record<string, unknown> {
  return type === "TABLE" ? { groupBy: "status" } : {};
}

function isCoreType(t: string): t is CoreListViewType {
  return CORE_LIST_VIEWS.some((v) => v.type === t);
}

export interface CoreListViewRow {
  name: string;
  type: TaskListViewType;
  isDefault: boolean;
  config: Record<string, unknown>;
  displayOrder: number;
}

/**
 * The rows a new task List is created with, at displayOrder 0..3 in CORE
 * order. No default type (or KANBAN) writes no isDefault at all: Board is
 * the default by rule. Another core type becomes the pinned default, marked
 * with `mark`. A task type outside the core set (TIMELINE) is appended as a
 * fifth view and pinned the same way.
 */
export function coreListViewRows(
  defaultType: string | null | undefined,
  mark: PinnedDefaultMark | null,
): CoreListViewRow[] {
  const pinned = (type: string, config: Record<string, unknown>) =>
    mark ? withPinnedDefault(config, mark) : config;
  const rows: CoreListViewRow[] = CORE_LIST_VIEWS.map((v, i) => ({
    name: v.name,
    type: v.type,
    isDefault: false,
    config: seedConfig(v.type),
    displayOrder: i,
  }));
  if (!defaultType || defaultType === "KANBAN") return rows;
  if (isCoreType(defaultType)) {
    return rows.map((r) =>
      r.type === defaultType ? { ...r, isDefault: true, config: pinned(r.type, r.config) } : r,
    );
  }
  if (TASK_LIST_VIEW_TYPES.has(defaultType)) {
    const type = defaultType as TaskListViewType;
    rows.push({
      name: TASK_VIEW_LABEL[type],
      type,
      isDefault: true,
      config: pinned(type, seedConfig(type)),
      displayOrder: rows.length,
    });
  }
  return rows;
}

/**
 * Does this List need the self-heal? Only a task List (it has a TABLE view)
 * that lacks at least one core type. The same condition ensureCoreListViews
 * has always used, so a Doc or Form List is never given a Board.
 */
export function needsCoreListViews(views: ReadonlyArray<{ type: string }>): boolean {
  if (!views.some((v) => v.type === "TABLE")) return false;
  const present = new Set(views.map((v) => v.type));
  return CORE_LIST_VIEWS.some((v) => !present.has(v.type));
}

/** The core views to append to `views`, in CORE order, never as the default. */
export function missingCoreListViews(
  views: ReadonlyArray<{ type: string }>,
): Array<{ name: string; type: CoreListViewType; config: Record<string, unknown> }> {
  const present = new Set(views.map((v) => v.type));
  return CORE_LIST_VIEWS.filter((v) => !present.has(v.type)).map((v) => ({
    name: v.name,
    type: v.type,
    config: seedConfig(v.type),
  }));
}

/**
 * The defaultViewType a List template creates its List with (review #33).
 * Every snapshot so far recorded the raw isDefault TYPE, which for almost
 * every List was the auto List view, and the seed templates say TABLE: TABLE
 * was the old system default, not anybody's choice, so it reads as no
 * preference and the List opens on Board. A payload view carrying `pinned`
 * is the new, explicit form: the List is created on Board and
 * planTemplateViews applies the pin to that view.
 *
 * One exception comes first. A List with no task view at all (a Doc, Form or
 * Canvas List, which createBoard makes as that single view) is made again as
 * that single view, as it always was. Its one view resolves as a choice, so a
 * snapshot marks it `pinned`, and reading that pin as "open on Board" would
 * hand a Doc List back as a task List with four task views beside its Doc.
 */
export function templateDefaultViewType(payload: {
  defaultView?: string;
  views?: ReadonlyArray<{ pinned?: boolean; type?: string }>;
}): string {
  const d = payload.defaultView;
  const views = payload.views ?? [];
  const hasTaskView = views.some((v) => typeof v?.type === "string" && TASK_LIST_VIEW_TYPES.has(v.type));
  if (d !== undefined && !TASK_LIST_VIEW_TYPES.has(d) && !hasTaskView) return d;
  if (views.some((v) => v?.pinned === true)) return "KANBAN";
  if (d === undefined || d === "TABLE" || d === "KANBAN") return "KANBAN";
  return d;
}

/** Deep JSON equality with key order ignored: is an update a no-op? */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, norm((v as Record<string, unknown>)[k])]);
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * How a List template's views land on the List createBoard just made.
 *
 * A payload view whose type AND name (trimmed, any case) match a created view
 * not matched yet is that view: its config is the template's merged over the
 * created one, and it becomes an update only when that changes something or
 * it carries the pin. Every other payload view is a new tab after the created
 * ones. This is what stops a template doubling the Board, Calendar and Gantt
 * tabs createBoard already made (with colliding displayOrders), which the old
 * "extra views" loop did. No config ever carries a stored mark in: the pin is
 * `pin`, true on the FIRST payload view marked pinned only, and the caller
 * writes a fresh mark for it.
 */
export function planTemplateViews(
  created: ReadonlyArray<{ id: string; name: string; type: string; displayOrder: number; config: unknown }>,
  payloadViews: ReadonlyArray<{ type: string; name?: string; config?: Record<string, unknown>; pinned?: boolean }>,
  labelFor: (type: string) => string,
): {
  updates: Array<{ id: string; config: Record<string, unknown>; pin: boolean }>;
  creates: Array<{ name: string; type: string; config: Record<string, unknown>; displayOrder: number; pin: boolean }>;
} {
  const updates: Array<{ id: string; config: Record<string, unknown>; pin: boolean }> = [];
  const creates: Array<{ name: string; type: string; config: Record<string, unknown>; displayOrder: number; pin: boolean }> = [];
  const matched = new Set<string>();
  let nextOrder = created.reduce((max, v) => Math.max(max, v.displayOrder), -1) + 1;
  let pinTaken = false;

  for (const pv of payloadViews) {
    const name = (pv.name ?? "").trim() || labelFor(pv.type);
    const pin = pv.pinned === true && !pinTaken;
    if (pin) pinTaken = true;
    const incoming = withoutPinnedDefault(pv.config);
    const key = name.toLowerCase();
    const match = created.find(
      (c) => !matched.has(c.id) && c.type === pv.type && c.name.trim().toLowerCase() === key,
    );
    if (match) {
      matched.add(match.id);
      // The created config is kept whole, mark included: a List created on a
      // template's preferred Calendar keeps the "pinned by" createBoard wrote.
      const base = { ...asObject(match.config) };
      const config = Object.keys(incoming).length > 0 ? { ...base, ...incoming } : base;
      if (pin || !sameJson(config, base)) updates.push({ id: match.id, config, pin });
      continue;
    }
    creates.push({ name, type: pv.type, config: incoming, displayOrder: nextOrder++, pin });
  }
  return { updates, creates };
}
