// The Analytics vocabulary: the two scopes, the four periods, the five tiles,
// and the week maths the chart is drawn from.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics).
//
// WHY THIS FILE EXISTS, separate from analytics.ts. The builder imports prisma
// and the access engine, so nothing can unit-test it without a database. Every
// rule a person can actually read off the screen (which pill they get, what
// "Last 30 days" means in days, which tile turns red when it rises, which
// Monday a completion lands on) lives here instead, pure and tested, exactly
// the way trash-view.ts sits under trash-server.ts.
//
// Pure: one type-only import, no prisma, no React.

import type { Viewer } from "./access/types";

// ── Scope: whose numbers these are ────────────────────────────────

/**
 * Two scopes, not three. /activity has "Just me" because a person's own feed
 * is a thing they want; a one-person analytics page is not, so the narrowest
 * scope here is the viewer's chain (which includes the viewer).
 */
export type AnalyticsScope = "team" | "org";

export const ANALYTICS_SCOPES: ReadonlyArray<{ key: AnalyticsScope; label: string }> = [
  { key: "team", label: "My team" },
  { key: "org", label: "Everyone" },
];

/** `?view=` accepts either word; anything else is the viewer's own chain. */
export function parseAnalyticsScope(raw: string | null | undefined): AnalyticsScope {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "org" || v === "all" || v === "everyone" ? "org" : "team";
}

/**
 * The pure rule, matching access section 5.2.1's `analytics` audience
 * ("reports-people-team-admin"). The facts arrive as arguments so the server
 * and the page answer from one function rather than two ladders that drift.
 */
export function analyticsScopeAllowed(
  scope: AnalyticsScope,
  facts: { isOrgAdmin: boolean; onPeopleTeam: boolean; hasReports: boolean },
): boolean {
  if (facts.isOrgAdmin || facts.onPeopleTeam) return true;
  // A manager gets their chain and nothing wider.
  return scope === "team" && facts.hasReports;
}

/** The pills to render. A pill is never drawn for a scope that would 403. */
export function allowedAnalyticsScopes(facts: {
  isOrgAdmin: boolean;
  onPeopleTeam: boolean;
  hasReports: boolean;
}): AnalyticsScope[] {
  return ANALYTICS_SCOPES.map((s) => s.key).filter((s) => analyticsScopeAllowed(s, facts));
}

/** The viewer-side facts, read off the Viewer the gate already built. */
export function viewerAnalyticsFacts(
  viewer: Viewer,
  peopleTeamIds: readonly string[],
): { isOrgAdmin: boolean; onPeopleTeam: boolean; hasReports: boolean } {
  return {
    isOrgAdmin: viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN",
    onPeopleTeam: peopleTeamIds.includes(viewer.userId),
    // `reportTree` excludes the viewer themselves, so any member at all means
    // this person manages somebody.
    hasReports: (viewer.reportTree?.size ?? 0) > 0,
  };
}

// ── Period ────────────────────────────────────────────────────────

export const ANALYTICS_PERIODS = [
  { key: "week", label: "This week", days: 7 },
  { key: "month", label: "This month", days: 30 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "quarter", label: "This quarter", days: 90 },
] as const;

export type AnalyticsPeriodKey = (typeof ANALYTICS_PERIODS)[number]["key"];

/** Unknown and missing both mean the spec's default, Last 30 days. */
export function periodDays(key: string | null | undefined): number {
  return ANALYTICS_PERIODS.find((p) => p.key === key)?.days ?? 30;
}

export function periodLabel(key: string | null | undefined): string {
  return ANALYTICS_PERIODS.find((p) => p.key === key)?.label ?? "Last 30 days";
}

// ── The five tiles ────────────────────────────────────────────────

export interface AnalyticsTotals {
  openTasks: number;
  completed: number;
  overdue: number;
  hoursLogged: number;
  sopAcks: number;
}

/**
 * One table for the tile row and the CSV, so the export can never carry a
 * different five numbers than the screen.
 *
 * `deltaMeaning` is "danger" on exactly one row: overdue work going up is the
 * only one of the five where a rise is bad. Everything else stays ink, because
 * a green number beside a red number teaches people to read the colour instead
 * of the word, and a good share of them cannot tell those two apart.
 */
export interface AnalyticsTileDef {
  key: keyof AnalyticsTotals;
  label: string;
  deltaMeaning: "neutral" | "danger";
  /** Hours are one decimal; counts are whole. */
  decimals: 0 | 1;
  /** Point-in-time counts have no previous window to compare against. */
  comparable: boolean;
}

export const ANALYTICS_TILES: readonly AnalyticsTileDef[] = [
  { key: "openTasks", label: "Open tasks", deltaMeaning: "neutral", decimals: 0, comparable: false },
  { key: "completed", label: "Completed", deltaMeaning: "neutral", decimals: 0, comparable: true },
  { key: "overdue", label: "Overdue", deltaMeaning: "danger", decimals: 0, comparable: true },
  { key: "hoursLogged", label: "Hours logged", deltaMeaning: "neutral", decimals: 1, comparable: true },
  { key: "sopAcks", label: "SOPs acknowledged", deltaMeaning: "neutral", decimals: 0, comparable: true },
] as const;

export function formatTileValue(def: AnalyticsTileDef, value: number): string {
  if (!Number.isFinite(value)) return "0";
  return def.decimals === 1 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * The percentage change between two periods, or null when there is no base.
 *
 * Null rather than "+100%" on a zero base: going from nothing to three is not
 * an infinite improvement, it is three, and the tile already prints three.
 */
export function deltaOf(now: number, before: number): { pct: number; direction: "up" | "down" } | null {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return null;
  return { pct, direction: pct > 0 ? "up" : "down" };
}

// ── Weeks (the chart's x axis) ────────────────────────────────────

/**
 * The Monday of a date, as "2026-09-14".
 *
 * Local parts throughout, never toISOString: a completion at 23:00 on Sunday
 * in a zone behind UTC belongs to the week the person was working, not to the
 * next one.
 */
export function weekKeyOf(d: Date): string {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = day.getDay();
  const back = dow === 0 ? 6 : dow - 1;
  const mon = new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
  return `${mon.getFullYear()}-${`${mon.getMonth() + 1}`.padStart(2, "0")}-${`${mon.getDate()}`.padStart(2, "0")}`;
}

/**
 * Every week in the window, including the empty ones, oldest first.
 *
 * The empty weeks matter: a chart that draws only the weeks with work makes a
 * quiet fortnight look like two busy ones side by side.
 */
export function weekSeries(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 60; i += 1) {
    const key = weekKeyOf(cursor);
    if (!out.includes(key)) out.push(key);
    cursor.setDate(cursor.getDate() + 7);
    if (cursor > to) break;
  }
  const last = weekKeyOf(to);
  if (!out.includes(last)) out.push(last);
  return out;
}

/** "14 Sep" for an axis tick. */
export function weekLabel(key: string): string {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ── Result shapes (shared by the builder, the route and the page) ──

export interface AnalyticsPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  open: number;
  done: number;
  overdue: number;
  hours: number;
  sopAcks: number;
}

export interface AnalyticsList {
  id: string;
  slug: string;
  name: string;
  spaceName: string | null;
  open: number;
  done: number;
  overdue: number;
}

export interface AnalyticsResult {
  scope: AnalyticsScope;
  from: string;
  to: string;
  totals: AnalyticsTotals;
  /** The same five numbers over the period before this one, for the deltas. */
  previous: AnalyticsTotals;
  /** Completed per week over the period, oldest first. */
  weekly: Array<{ weekStart: string; completed: number }>;
  people: AnalyticsPerson[];
  lists: AnalyticsList[];
  /** How many people the numbers cover; the empty state says so. */
  peopleCount: number;
}

export function personName(p: { firstName: string | null; lastName: string | null }): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unnamed";
}
