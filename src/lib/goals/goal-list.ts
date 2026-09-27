// The goals list query (spec-goals /okrs Data): the pure half, so the
// filters, the sort and the Team goals grouping are one tested rule.
//
//   ?view=mine|team|company         one URL per view (the retired
//                                   ?mine=1, ?team=1, ?level=company map in)
//   ?verdict=on_track,at_risk        Filter > Verdict
//   ?level=COMPANY,DEPARTMENT        Filter > Level
//   ?owner=<id>,<id>                 Filter > Owner
//   ?dueFrom=YYYY-MM-DD&dueTo=       Filter > Due
//   ?nudge=1                         Filter > Needs a nudge (Team goals)
//   ?direct=1                        Filter > Direct reports only (Team goals)
//   ?q=                              title search
//   ?includeCompleted=1              Display > Show completed goals
//   ?sort=due|progress|name|checkin|verdict
//   ?page=1&pageSize=40              server pagination
//
// Pure: no Prisma.

import { verdictRank, type GoalVerdict } from "@/lib/goal-verdict";

export type GoalsListView = "mine" | "team" | "company" | "all";
export type GoalsSort = "due" | "progress" | "name" | "checkin" | "verdict";

export interface GoalsListQuery {
  view: GoalsListView;
  verdicts: GoalVerdict[];
  levels: Array<"COMPANY" | "DEPARTMENT" | "INDIVIDUAL">;
  owners: string[];
  dueFrom: string | null;
  dueTo: string | null;
  nudge: boolean;
  direct: boolean;
  q: string;
  includeCompleted: boolean;
  sort: GoalsSort;
  page: number | null;
  pageSize: number;
}

const VERDICTS = new Set(["on_track", "at_risk", "off_track", "completed", "not_measured"]);
const LEVELS = new Set(["COMPANY", "DEPARTMENT", "INDIVIDUAL"]);
const SORTS = new Set(["due", "progress", "name", "checkin", "verdict"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function parseGoalsListQuery(sp: URLSearchParams): GoalsListQuery {
  const viewParam = sp.get("view");
  const legacyLevel = sp.get("level");
  let view: GoalsListView = "all";
  if (viewParam === "mine" || sp.get("mine") === "1") view = "mine";
  if (viewParam === "team" || sp.get("team") === "1") view = "team";
  if (viewParam === "company" || legacyLevel?.toLowerCase() === "company") view = "company";
  const levels = list(legacyLevel?.toLowerCase() === "company" ? null : legacyLevel)
    .map((l) => (l.toUpperCase() === "TEAM" ? "DEPARTMENT" : l.toUpperCase()))
    .filter((l): l is GoalsListQuery["levels"][number] => LEVELS.has(l));
  const pageRaw = sp.get("page");
  const page = pageRaw != null && /^\d+$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : null;
  const sizeRaw = Number(sp.get("pageSize") ?? 40);
  const pageSize = Number.isInteger(sizeRaw) && sizeRaw >= 10 && sizeRaw <= 100 ? sizeRaw : 40;
  const sort = sp.get("sort");
  const dueFrom = sp.get("dueFrom");
  const dueTo = sp.get("dueTo");
  return {
    view,
    verdicts: list(sp.get("verdict")).filter((v): v is GoalVerdict => VERDICTS.has(v)),
    levels,
    owners: list(sp.get("owner")).slice(0, 50),
    dueFrom: dueFrom && DATE.test(dueFrom) ? dueFrom : null,
    dueTo: dueTo && DATE.test(dueTo) ? dueTo : null,
    nudge: sp.get("nudge") === "1",
    direct: sp.get("direct") === "1",
    q: (sp.get("q") ?? "").trim().slice(0, 200),
    // The legacy list (no ?page=) always carried completed goals.
    includeCompleted: sp.get("includeCompleted") === "1" || page == null,
    sort: sort && SORTS.has(sort) ? (sort as GoalsSort) : "due",
    page,
    pageSize,
  };
}

export interface GoalListRow {
  id: string;
  title: string;
  level: string;
  ownerId: string | null;
  endDate: Date | string | null;
  completedAt?: Date | string | null;
  createdAt: Date | string;
  progress: number;
  progressSource: string;
  verdict: GoalVerdict;
  isStale: boolean;
  lastCheckInAt: Date | string | null;
  /** For Team goals: the owner's display name (group order). */
  ownerName?: string;
}

const ms = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).getTime());

/** Filter the rows (visibility has already been applied). */
export function filterGoals<T extends GoalListRow>(rows: readonly T[], q: GoalsListQuery, ctx: { quarterStart: Date; directIds?: ReadonlySet<string> | null }): T[] {
  const needle = q.q.toLowerCase();
  const from = q.dueFrom ? Date.parse(`${q.dueFrom}T00:00:00Z`) : null;
  const to = q.dueTo ? Date.parse(`${q.dueTo}T23:59:59Z`) : null;
  return rows.filter((r) => {
    if (!q.includeCompleted && r.verdict === "completed") {
      // Hidden only when it ended before the current quarter began.
      const end = ms(r.completedAt ?? null) ?? ms(r.endDate) ?? ms(r.createdAt);
      if (end != null && end < ctx.quarterStart.getTime()) return false;
    }
    if (q.verdicts.length && !q.verdicts.includes(r.verdict)) return false;
    if (q.levels.length && !q.levels.includes(r.level as GoalsListQuery["levels"][number])) return false;
    if (q.owners.length && !(r.ownerId && q.owners.includes(r.ownerId))) return false;
    const due = ms(r.endDate);
    if (from != null && (due == null || due < from)) return false;
    if (to != null && (due == null || due > to)) return false;
    if (q.nudge && !(r.verdict === "at_risk" || r.verdict === "off_track" || r.isStale)) return false;
    if (q.direct && ctx.directIds && !(r.ownerId && ctx.directIds.has(r.ownerId))) return false;
    if (needle && !r.title.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const LEVEL_ORDER: Record<string, number> = { COMPANY: 0, DEPARTMENT: 1, INDIVIDUAL: 2 };

function compare(a: GoalListRow, b: GoalListRow, sort: GoalsSort): number {
  switch (sort) {
    case "progress": return b.progress - a.progress || a.title.localeCompare(b.title);
    case "name": return a.title.localeCompare(b.title);
    case "checkin": return (ms(b.lastCheckInAt) ?? -Infinity) - (ms(a.lastCheckInAt) ?? -Infinity) || a.title.localeCompare(b.title);
    case "verdict": return verdictRank(a.verdict) - verdictRank(b.verdict) || a.title.localeCompare(b.title);
    default: {
      const da = ms(a.endDate), db = ms(b.endDate);
      if (da == null && db == null) return a.title.localeCompare(b.title);
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db || a.title.localeCompare(b.title);
    }
  }
}

/**
 * Order the rows for a view: Team goals groups by owner (people whose
 * rolled-up verdict is At risk or Off track first, then by name, the
 * unowned group last); My and Company goals group by level. Inside a group
 * the chosen sort applies. The page slices this order, so a group's rows
 * stay together across pages.
 */
export function orderGoals<T extends GoalListRow>(rows: readonly T[], view: GoalsListView, sort: GoalsSort, groupVerdict?: ReadonlyMap<string, GoalVerdict | null>): T[] {
  const out = [...rows];
  if (view === "team") {
    const rank = (r: T) => {
      if (!r.ownerId) return 9;
      const v = groupVerdict?.get(r.ownerId) ?? null;
      return v === "off_track" || v === "at_risk" ? 0 : 1;
    };
    out.sort((a, b) => rank(a) - rank(b)
      || (a.ownerName ?? "").localeCompare(b.ownerName ?? "")
      || (a.ownerId ?? "").localeCompare(b.ownerId ?? "")
      || compare(a, b, sort));
    return out;
  }
  out.sort((a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3) || compare(a, b, sort));
  return out;
}

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): { rows: T[]; page: number; total: number } {
  const total = rows.length;
  const last = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), last);
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), page: p, total };
}
