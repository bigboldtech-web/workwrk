// The /team/reviews queue's query and row rules (spec-teams-performance
// /team/reviews). Pure, so the rules are tested without a database; the
// server side is weekly-queue.server.ts.
//
//   ?view=    waiting (default) · acted (decided in the last 30 days) · all
//   ?scope=   direct (default for anyone with reports) · chain
//   ?status=  waiting, approved, changes, notsubmitted (comma separated)
//   ?week=    YYYY-MM-DD, the Monday the review covers
//   ?person=  one subject (the Alignment board's Open weekly review)
//   ?q=       a subject's name or the highlights text
//   ?sort=    oldest (default) · newest · person
//   ?group=   none (default) · person · week
//   ?page=    1-based, 40 rows a page
//
// Worst cases decided here:
//   - A draft (not submitted) review is the employee's unfinished writing.
//     It is listed so a manager can see who has not written one, but its
//     body is never returned to anyone but its author.
//   - A malformed parameter falls back to its default; it never widens the
//     population (scope is clipped server side to what the viewer holds).

export type WeeklyView = "waiting" | "acted" | "all";
export type WeeklyScope = "direct" | "chain";
export type WeeklyStatusKey = "waiting" | "approved" | "changes" | "notsubmitted";
export type WeeklySort = "oldest" | "newest" | "person";
export type WeeklyGroup = "none" | "person" | "week";

export const WEEKLY_PAGE_SIZE = 40;
/** Acted lists decisions this recent. */
export const ACTED_DAYS = 30;
/** KRA progress at or above this counts as on track (the goal verdict's line). */
export const KRA_ON_TRACK_PCT = 70;

export interface WeeklyQuery {
  view: WeeklyView;
  scope: WeeklyScope | null;
  statuses: WeeklyStatusKey[];
  week: string | null;
  person: string | null;
  q: string;
  sort: WeeklySort;
  group: WeeklyGroup;
  page: number;
  ids: string[];
}

const STATUS_KEYS: readonly WeeklyStatusKey[] = ["waiting", "approved", "changes", "notsubmitted"];

function one(sp: URLSearchParams, k: string): string | null {
  const v = sp.get(k);
  return v && v.trim() ? v.trim() : null;
}

export function parseWeeklyQuery(sp: URLSearchParams): WeeklyQuery {
  const view = one(sp, "view");
  const scope = one(sp, "scope");
  const sort = one(sp, "sort");
  const group = one(sp, "group");
  const week = one(sp, "week");
  const page = Number(one(sp, "page") ?? "1");
  const statuses = (one(sp, "status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is WeeklyStatusKey => (STATUS_KEYS as readonly string[]).includes(s));
  const ids = (one(sp, "ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  return {
    view: view === "acted" || view === "all" ? view : "waiting",
    scope: scope === "direct" || scope === "chain" ? scope : null,
    statuses: [...new Set(statuses)],
    week: week && /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(`${week}T00:00:00Z`)) ? week : null,
    person: one(sp, "person"),
    q: (one(sp, "q") ?? "").slice(0, 200),
    sort: sort === "newest" || sort === "person" ? sort : "oldest",
    group: group === "person" || group === "week" ? group : "none",
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    ids,
  };
}

/** The status word and chip tone of one weekly review (the naming canon). */
export function weeklyStatusOf(r: { status: string; managerStatus: string | null }): {
  key: WeeklyStatusKey;
  label: string;
  tone: "warning" | "success" | "danger" | "neutral";
} {
  if (r.status === "SUBMITTED") return { key: "waiting", label: "Waiting on you", tone: "warning" };
  if (r.status === "ACKNOWLEDGED") {
    return r.managerStatus === "CHANGES_REQUESTED"
      ? { key: "changes", label: "Changes requested", tone: "danger" }
      : { key: "approved", label: "Approved", tone: "success" };
  }
  return { key: "notsubmitted", label: "Not submitted", tone: "neutral" };
}

/** The prisma status clause each status key maps to. */
export function statusClause(key: WeeklyStatusKey): { status: "SUBMITTED" | "ACKNOWLEDGED" | "DRAFT"; managerStatus?: "APPROVED" | "CHANGES_REQUESTED" } {
  switch (key) {
    case "waiting":
      return { status: "SUBMITTED" };
    case "approved":
      return { status: "ACKNOWLEDGED", managerStatus: "APPROVED" };
    case "changes":
      return { status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED" };
    case "notsubmitted":
      return { status: "DRAFT" };
  }
}

/** "4 of 5 on track" over a review's KRA progress rows. */
export function weeklyKraSummary(rows: ReadonlyArray<{ progressPct?: unknown }>): { onTrack: number; total: number } {
  const valid = rows.filter((r) => typeof r.progressPct === "number" && Number.isFinite(r.progressPct as number));
  return { onTrack: valid.filter((r) => (r.progressPct as number) >= KRA_ON_TRACK_PCT).length, total: valid.length };
}

/** The first non-empty line of a text field, trimmed to `max` characters. */
export function firstLine(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * How a KPI's weekly snapshot reads against its target, direction-aware.
 * No number, or no target to compare with, is neutral: never a guess.
 */
export function kpiSnapshotTone(
  value: number | null | undefined,
  target: number | null | undefined,
  direction: "HIGHER" | "LOWER" | "MAINTAIN" | null | undefined,
  lowerIsBetter = false,
): { tone: "success" | "warning" | "neutral"; label: string } {
  if (value == null || !Number.isFinite(value)) return { tone: "neutral", label: "No number" };
  if (target == null || !Number.isFinite(target)) return { tone: "neutral", label: "No target" };
  const dir = direction ?? (lowerIsBetter ? "LOWER" : "HIGHER");
  let ok: boolean;
  if (dir === "LOWER") ok = value <= target;
  else if (dir === "MAINTAIN") ok = target === 0 ? value === 0 : Math.abs(value - target) / Math.abs(target) <= 0.05;
  else ok = value >= target;
  return ok ? { tone: "success", label: "On target" } : { tone: "warning", label: "Off target" };
}

/** Monday of the ISO week, as YYYY-MM-DD (the key the week filter uses). */
export function weekKey(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** The Mondays of the last `n` weeks, newest first, from `now`. */
export function recentWeekKeys(now: Date, n = 12): string[] {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out;
}
