// planner-prefs.ts: the Planner hub's preference readers, defaulting PER FIELD.
//
// Spec: docs/plans/ui-refresh/spec-planner.md section 2 (`/planner` Data and
// `/timesheets` Data), which names every key and its default.
//
// WHY PER FIELD, AND NOT A DEFAULT OBJECT. `getEffectivePreferences`
// (src/lib/preferences.ts) merges each namespace with a SHALLOW spread:
// `{ ...DEFAULT_HOME, ...orgHome, ...userHome }`. Put
// `planner: { view, sources, ... }` into DEFAULT_HOME and the first user row
// that stores `home.planner = { view: "month" }` replaces the whole object,
// so `showWeekends` silently becomes undefined and the Display switch reads
// as off for somebody who never touched it. The defaults therefore live
// here, one per field, and a stored namespace carrying only some of its keys
// still reads correctly. This is the same rule and the same reason as
// src/lib/docs-prefs.ts.
//
// Nothing here writes: callers PATCH /api/preferences themselves.
//
// Pure: no prisma, no React, no imports. Every rule below is unit-tested.

// ── Calendar (/planner) ───────────────────────────────────────────

export type PlannerView = "week" | "month" | "people";

/** The five kinds the Calendar can show, in the filter panel's order. */
export type PlannerSource = "task" | "meeting" | "event" | "external" | "reminder";

export const PLANNER_SOURCES: readonly PlannerSource[] = [
  "task",
  "meeting",
  "event",
  "external",
  "reminder",
];

export interface PlannerDisplay {
  view: PlannerView;
  sources: PlannerSource[];
  showWeekends: boolean;
  showDeclined: boolean;
  showReminders: boolean;
  highlightWorkHours: boolean;
  showUnscheduled: boolean;
}

/** Exactly the defaults spec-planner section 2 `/planner` Data writes down. */
export const PLANNER_DEFAULTS: Readonly<PlannerDisplay> = {
  view: "week",
  sources: [...PLANNER_SOURCES],
  showWeekends: true,
  showDeclined: false,
  showReminders: true,
  highlightWorkHours: true,
  showUnscheduled: false,
};

type StoredPlanner = {
  view?: unknown;
  sources?: unknown;
  showWeekends?: unknown;
  showDeclined?: unknown;
  showReminders?: unknown;
  highlightWorkHours?: unknown;
  showUnscheduled?: unknown;
} | null | undefined;

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function isPlannerView(v: unknown): v is PlannerView {
  return v === "week" || v === "month" || v === "people";
}

/**
 * The Calendar's display options, every field defaulted on its own.
 *
 * `sources` is filtered to the known five rather than trusted: a key that
 * left the product, or one a future release adds and an old client stores,
 * must not turn into a filter nobody can clear. An empty stored list is
 * honoured (a person really did clear every source); an absent one is the
 * default of all five.
 */
export function plannerDisplay(stored: StoredPlanner): PlannerDisplay {
  const s = stored ?? {};
  const sources = Array.isArray(s.sources)
    ? (s.sources.filter((x): x is PlannerSource =>
        typeof x === "string" && (PLANNER_SOURCES as readonly string[]).includes(x)) as PlannerSource[])
    : [...PLANNER_DEFAULTS.sources];
  return {
    view: isPlannerView(s.view) ? s.view : PLANNER_DEFAULTS.view,
    sources,
    showWeekends: bool(s.showWeekends, PLANNER_DEFAULTS.showWeekends),
    showDeclined: bool(s.showDeclined, PLANNER_DEFAULTS.showDeclined),
    showReminders: bool(s.showReminders, PLANNER_DEFAULTS.showReminders),
    highlightWorkHours: bool(s.highlightWorkHours, PLANNER_DEFAULTS.highlightWorkHours),
    showUnscheduled: bool(s.showUnscheduled, PLANNER_DEFAULTS.showUnscheduled),
  };
}

// ── Timesheets (/timesheets) ──────────────────────────────────────

export interface TimesheetsDisplay {
  showNotes: boolean;
  showSource: boolean;
}

/** Both ON: spec-planner section 2 `/timesheets`, the Display menu. */
export const TIMESHEETS_DEFAULTS: Readonly<TimesheetsDisplay> = {
  showNotes: true,
  showSource: true,
};

export function timesheetsDisplay(
  stored: { showNotes?: unknown; showSource?: unknown } | null | undefined,
): TimesheetsDisplay {
  const s = stored ?? {};
  return {
    showNotes: bool(s.showNotes, TIMESHEETS_DEFAULTS.showNotes),
    showSource: bool(s.showSource, TIMESHEETS_DEFAULTS.showSource),
  };
}

// ── Week start ────────────────────────────────────────────────────
//
// THE ONE READER, so the Planner does not become the fourth.
//
// There were three spellings of this rule live at once when Phase 4 began:
// `resolveWeekStart` in src/lib/item-date.ts, `normaliseWeekStart` inside
// src/lib/work-buckets.ts, and a hard-coded Sunday-first day array in
// the Planner grid. `DateFormatPrefs` (src/lib/format/date.ts) deliberately
// carries timezone, dateFormat, timeFormat and language and NOT week start,
// because a week start is not a formatting rule, so a fourth copy in the
// Calendar was the default outcome. This is that reader.
//
// WHAT IT DOES NOT DO: it does not move the timesheet week. Every Timesheet
// row's `weekStartDate` is Monday 00:00 UTC and is the key of a unique
// constraint (src/lib/timesheet-week.ts says why). Changing the anchor is a
// data migration, not a preference read, and spec-planner section 2
// `/timesheets` open question 1 defers it: the preference moves the CALENDAR
// grid and the week LABEL, and nothing else.

/** 0 = Sunday .. 6 = Saturday. Monday when nothing valid is stored. */
export const DEFAULT_WEEK_START = 1;

export function resolvePlannerWeekStart(weekStart: unknown): number {
  if (typeof weekStart !== "number" || !Number.isFinite(weekStart)) return DEFAULT_WEEK_START;
  const n = Math.trunc(weekStart);
  return n >= 0 && n <= 6 ? n : DEFAULT_WEEK_START;
}

/**
 * The seven weekday indexes of a week that starts on `weekStart`, in order.
 * `weekdayOrder(1)` is Monday first: [1, 2, 3, 4, 5, 6, 0].
 */
export function weekdayOrder(weekStart: unknown): number[] {
  const start = resolvePlannerWeekStart(weekStart);
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

/**
 * How many days back from `date` the start of its week is, for a week
 * starting on `weekStart`. Local-day arithmetic: the caller decides whether
 * to apply it in the viewer's zone (the Calendar grid) or in UTC.
 */
export function daysBackToWeekStart(dayOfWeek: number, weekStart: unknown): number {
  const start = resolvePlannerWeekStart(weekStart);
  return (((dayOfWeek - start) % 7) + 7) % 7;
}
