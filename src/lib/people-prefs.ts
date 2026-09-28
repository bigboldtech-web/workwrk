// people-prefs.ts: the Phase 6 people surfaces' preference readers, one
// default per field.
//
// Specs: spec-teams-people section 2 `/team/workload` Data
// (home.work.workload), spec-goals section 4 (home.goals, home.kraKpi,
// home.alignment, home.kpiReviews, sidebar.groups.goals) and
// spec-teams-performance section 1 (home.teams.surface.{key}.viewOptions).
//
// WHY PER FIELD. getEffectivePreferences merges each namespace with a
// SHALLOW spread, so a stored `home.goals = { showEffort: false }` replaces
// the whole object and a default kept in DEFAULT_HOME would vanish. The
// defaults therefore live here beside each field, exactly as
// src/lib/planner-prefs.ts does it.
//
// Pure: no prisma, no React, no imports. Nothing here writes.

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// ── /team/workload (home.work.workload) ───────────────────────────

export type WorkloadMode = "tasks" | "hours";
export type WorkloadWindow = 7 | 14 | 28;

export interface WorkloadPrefs {
  mode: WorkloadMode;
  windowDays: WorkloadWindow;
  countWeekends: boolean;
  showAllPeople: boolean;
  dailyTasks: number;
}

/** The grid's shipped defaults (workload-grid.tsx WorkloadSettings). */
export const WORKLOAD_DEFAULTS: Readonly<WorkloadPrefs> = {
  mode: "tasks",
  windowDays: 14,
  countWeekends: false,
  showAllPeople: false,
  dailyTasks: 3,
};

export function workloadPrefs(home: unknown): WorkloadPrefs {
  const w = obj(obj(obj(home).work).workload);
  const mode: WorkloadMode = w.mode === "hours" || w.mode === "tasks" ? w.mode : WORKLOAD_DEFAULTS.mode;
  const windowDays: WorkloadWindow =
    w.windowDays === 7 || w.windowDays === 14 || w.windowDays === 28 ? w.windowDays : WORKLOAD_DEFAULTS.windowDays;
  const daily = typeof w.dailyTasks === "number" && Number.isInteger(w.dailyTasks) && w.dailyTasks >= 1 && w.dailyTasks <= 99
    ? w.dailyTasks
    : WORKLOAD_DEFAULTS.dailyTasks;
  return {
    mode,
    windowDays,
    countWeekends: bool(w.countWeekends, WORKLOAD_DEFAULTS.countWeekends),
    showAllPeople: bool(w.showAllPeople, WORKLOAD_DEFAULTS.showAllPeople),
    dailyTasks: daily,
  };
}

// ── Goals, KRAs & KPIs, Alignment, KPI reviews ────────────────────

export interface GoalsSurfacePrefs {
  showCompleted: boolean;
  showEffort: boolean;
}
export const GOALS_SURFACE_DEFAULTS: Readonly<GoalsSurfacePrefs> = { showCompleted: false, showEffort: true };

export function goalsSurfacePrefs(home: unknown): GoalsSurfacePrefs {
  const g = obj(obj(home).goals);
  return {
    showCompleted: bool(g.showCompleted, GOALS_SURFACE_DEFAULTS.showCompleted),
    showEffort: bool(g.showEffort, GOALS_SURFACE_DEFAULTS.showEffort),
  };
}

export interface KraKpiSurfacePrefs {
  showEmptyTitles: boolean;
}
export const KRA_KPI_SURFACE_DEFAULTS: Readonly<KraKpiSurfacePrefs> = { showEmptyTitles: true };

export function kraKpiSurfacePrefs(home: unknown): KraKpiSurfacePrefs {
  const k = obj(obj(home).kraKpi);
  return { showEmptyTitles: bool(k.showEmptyTitles, KRA_KPI_SURFACE_DEFAULTS.showEmptyTitles) };
}

export interface AlignmentSurfacePrefs {
  showKraNames: boolean;
  showDirectIcs: boolean;
}
export const ALIGNMENT_SURFACE_DEFAULTS: Readonly<AlignmentSurfacePrefs> = { showKraNames: false, showDirectIcs: true };

export function alignmentSurfacePrefs(home: unknown): AlignmentSurfacePrefs {
  const a = obj(obj(home).alignment);
  return {
    showKraNames: bool(a.showKraNames, ALIGNMENT_SURFACE_DEFAULTS.showKraNames),
    showDirectIcs: bool(a.showDirectIcs, ALIGNMENT_SURFACE_DEFAULTS.showDirectIcs),
  };
}

export interface KpiReviewsSurfacePrefs {
  showDescriptions: boolean;
}
export const KPI_REVIEWS_SURFACE_DEFAULTS: Readonly<KpiReviewsSurfacePrefs> = { showDescriptions: false };

export function kpiReviewsSurfacePrefs(home: unknown): KpiReviewsSurfacePrefs {
  const k = obj(obj(home).kpiReviews);
  return { showDescriptions: bool(k.showDescriptions, KPI_REVIEWS_SURFACE_DEFAULTS.showDescriptions) };
}

// ── sidebar.groups ────────────────────────────────────────────────

/** Is this pathname one that holds the Goals group open (/okrs and its goal pages)? */
export function goalsGroupHeld(pathname: string): boolean {
  return pathname === "/okrs" || pathname.startsWith("/okrs/");
}

/**
 * Is the Work sidebar's Goals group expanded? spec-goals section 1: expanded
 * while the pathname starts with /okrs; otherwise the remembered
 * `sidebar.groups.goals`; collapsed when never set.
 *
 * The /okrs hold is a default, not a lock: `heldClosed` is the chevron's
 * choice for this visit, so "Collapse Goals" on a Goals page really collapses
 * the group. It lives in the component (never in the pref), so collapsing on
 * /okrs does not overwrite what the person chose for every other page.
 */
export function goalsGroupExpanded(sidebar: unknown, pathname: string, heldClosed = false): boolean {
  if (goalsGroupHeld(pathname)) return !heldClosed;
  return bool(obj(obj(sidebar).groups).goals, false);
}

// ── Teams performance surfaces (home.teams.surface.{key}.viewOptions) ─

export type WeeklyReviewScope = "direct" | "chain";

/**
 * The weekly queue's scope: the URL wins, then the remembered choice, then
 * "direct" (spec-teams-performance section 1: `?scope=direct|chain`,
 * default `direct`).
 */
export function weeklyReviewScope(home: unknown, urlScope: string | null | undefined): WeeklyReviewScope {
  if (urlScope === "direct" || urlScope === "chain") return urlScope;
  const v = obj(obj(obj(obj(obj(home).teams).surface)["weekly-reviews"]).viewOptions);
  return v.scope === "chain" ? "chain" : "direct";
}
