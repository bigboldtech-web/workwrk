// The Teams hub sidebar: its 20 rows, their gates and their counts, as one
// pure table (spec-teams-people section 1 "Hub sidebar contents",
// sidebar-map.md section 5). The component (TeamsSidebar in
// src/components/layout/os/apps-catalog.tsx) renders exactly what this file
// says; a node test proves who sees which row.
//
// GATES ARE THE APP_RULES AUDIENCES, over the facts the boot payload carries
// (orgRole, isAgent, hasReports, peopleTeam), so a row renders exactly when
// gatePage("view", { type: "app", key }) would let the viewer in. No
// accessLevel reads, no tier Sets. Two rows widen their key on purpose, both
// settled in sidebar-map section 5: Candor also renders for a Member invited
// to a session (they respond), and Surveys renders for every TARGETED Member
// (they respond), because both pages have a respondent face.
//
// Pure: imports only the audience mirror over the access tables (pure) and
// the active-row resolver.

import type { AppKey } from "@/lib/access/types";
import { appAudienceAllows } from "./app-audience";
import { resolveActiveRow } from "./route-hub";

export type TeamsSection = "personal" | "people" | "alignment" | "performance" | "culture" | "resourcing";

/** Keys of the boot counts a Teams row can carry. */
export type TeamsCountKey = "myTeam" | "kpiReviews" | "weeklyReviews" | "reviewForms" | "candorOpen" | "surveysOpen";

export interface TeamsRow {
  key: string;
  section: TeamsSection;
  label: string;
  /** A Lucide icon name; the component maps it (no React here). */
  icon:
    | "CircleUser" | "Users" | "Scale" | "BookUser" | "Network" | "Building2" | "Briefcase" | "Zap"
    | "Gauge" | "Target" | "ClipboardCheck" | "CalendarCheck" | "ClipboardList" | "Grid3x3"
    | "BarChart3" | "Heart" | "MessageSquare" | "ListChecks" | "Wrench" | "Boxes";
  href: string;
  match?: "exact" | "prefix";
  /** The APP_RULES row that gates it; undefined = every Member (a Teams hub page). */
  app?: AppKey;
  count?: TeamsCountKey;
}

export const TEAMS_SECTION_LABELS: Record<Exclude<TeamsSection, "personal">, string> = {
  people: "People",
  alignment: "Alignment",
  performance: "Performance",
  culture: "Culture",
  resourcing: "Resourcing",
};

/** The 20 rows, in order (spec-teams-people section 1, rows 1 to 20). */
export const TEAMS_ROWS: readonly TeamsRow[] = [
  { key: "profile", section: "personal", label: "My profile", icon: "CircleUser", href: "/people/me", match: "exact" },
  { key: "team", section: "personal", label: "My team", icon: "Users", href: "/team", match: "exact", app: "team", count: "myTeam" },
  { key: "workload", section: "personal", label: "Workload", icon: "Scale", href: "/team/workload", match: "exact", app: "workload" },
  { key: "directory", section: "people", label: "Directory", icon: "BookUser", href: "/people", match: "exact" },
  { key: "org", section: "people", label: "Org chart", icon: "Network", href: "/organization" },
  { key: "departments", section: "people", label: "Departments", icon: "Building2", href: "/people/departments" },
  { key: "titles", section: "people", label: "Job titles", icon: "Briefcase", href: "/people/roles" },
  { key: "skills", section: "people", label: "Skills", icon: "Zap", href: "/people/skills" },
  { key: "kra-kpi", section: "alignment", label: "KRAs & KPIs", icon: "Gauge", href: "/kra-kpi", app: "kra-kpi" },
  { key: "alignment", section: "alignment", label: "Alignment", icon: "Target", href: "/team/alignment", match: "exact", app: "alignment" },
  { key: "kpi-reviews", section: "alignment", label: "KPI reviews", icon: "ClipboardCheck", href: "/team/kpi-reviews", match: "exact", app: "kpi-reviews", count: "kpiReviews" },
  { key: "weekly-reviews", section: "performance", label: "Weekly reviews", icon: "CalendarCheck", href: "/team/reviews", match: "exact", app: "weekly-reviews", count: "weeklyReviews" },
  { key: "reviews", section: "performance", label: "Review cycles", icon: "ClipboardList", href: "/reviews", app: "reviews", count: "reviewForms" },
  { key: "talent", section: "performance", label: "Talent (9-box)", icon: "Grid3x3", href: "/talent", app: "talent" },
  { key: "analytics", section: "performance", label: "Analytics", icon: "BarChart3", href: "/analytics", match: "exact", app: "analytics" },
  { key: "kudos", section: "culture", label: "Kudos", icon: "Heart", href: "/kudos", app: "kudos" },
  { key: "candor", section: "culture", label: "Candor", icon: "MessageSquare", href: "/candor", app: "candor", count: "candorOpen" },
  { key: "surveys", section: "culture", label: "Surveys", icon: "ListChecks", href: "/surveys", app: "surveys", count: "surveysOpen" },
  { key: "tools", section: "resourcing", label: "Tools", icon: "Wrench", href: "/tools", app: "tools" },
  { key: "assets", section: "resourcing", label: "Assets", icon: "Boxes", href: "/assets", app: "assets" },
];

export interface TeamsViewer {
  userId: string;
  orgRole: string;
  isAgent: boolean;
  hasReports: boolean;
  peopleTeam: boolean;
  candorInvited?: boolean;
  surveyTargeted?: boolean;
  // No legacyManagerTier here any more: the Assets bridge that read it ended
  // when /assets moved onto the app-key gate (AppKeyGate, Phase 7), so the
  // Assets row is its APP_RULES audience like every other row.
}

/**
 * The APP_RULES audience over the boot facts. It is the one client mirror of
 * resolve.ts appAudienceAllows (src/lib/nav/app-audience.ts, which the AI
 * sidebar and the palette read too), so a Teams row and its page gate can
 * never drift apart. Guests are refused one level up, in teamsRowVisible.
 */
export function teamsAudienceAllows(app: AppKey, v: TeamsViewer): boolean {
  return appAudienceAllows(app, v);
}

/** Does this viewer get this row? */
export function teamsRowVisible(row: TeamsRow, v: TeamsViewer): boolean {
  // Guests never see the Teams hub (access 2.3).
  if (v.orgRole === "GUEST") return false;
  if (!row.app) return true;
  if (teamsAudienceAllows(row.app, v)) return true;
  // The two respondent doors (sidebar-map section 5 rows 17 and 18).
  if (row.key === "candor") return v.candorInvited === true;
  if (row.key === "surveys") return v.surveyTargeted === true;
  return false;
}

export function visibleTeamsRows(v: TeamsViewer): TeamsRow[] {
  return TEAMS_ROWS.filter((r) => teamsRowVisible(r, v));
}

/**
 * The URL the active-row resolver should see for the Teams sidebar:
 * /people/{self} lights My profile and /people/{someone else} lights the
 * Directory (spec-teams-people section 1 "Hub + sidebar"; PO-25, the
 * literal /people/me row that never matched after the redirect), and
 * /team/rollup lights Alignment (its Sub-teams view, spec-goals section 1).
 */
const PEOPLE_STATIC = new Set(["me", "departments", "roles", "skills"]);

/**
 * Where a person record was opened from, when that is not the Directory. The
 * person opens as a drawer over the page they were on, so that page stays
 * lit and the breadcrumbs name it: `?from=team` (a My team row, its "+N" and
 * its row menu), `?from=org` (an Org chart row) and `?from=skills` (a
 * Skills holder). Anything else, or no `from`, is the Directory.
 */
export const PERSON_ORIGINS = {
  team: { label: "My team", href: "/team" },
  org: { label: "Org chart", href: "/organization" },
  skills: { label: "Skills", href: "/people/skills" },
} as const;
export type PersonOrigin = { label: string; href: string };
const DIRECTORY_ORIGIN: PersonOrigin = { label: "Directory", href: "/people" };
export function personOrigin(search: string | URLSearchParams | null | undefined): PersonOrigin {
  const sp = typeof search === "string" || search == null ? new URLSearchParams(search ?? "") : search;
  const from = sp.get("from");
  // Own keys only, so `?from=constructor` or `?from=__proto__` is the Directory.
  return from && Object.hasOwn(PERSON_ORIGINS, from) ? PERSON_ORIGINS[from as keyof typeof PERSON_ORIGINS] : DIRECTORY_ORIGIN;
}

export function teamsActivePath(pathname: string, selfId: string | null | undefined, search = ""): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/team/rollup" || path.startsWith("/team/rollup/")) return "/team/alignment";
  const m = /^\/people\/([^/]+)(\/.*)?$/.exec(path);
  if (m && !PEOPLE_STATIC.has(m[1])) {
    if (selfId && m[1] === selfId) return "/people/me";
    return personOrigin(search).href;
  }
  return path;
}

/** The href of the one active Teams row for this URL, or undefined. */
export function teamsActiveHref(
  pathname: string,
  search: string,
  selfId: string | null | undefined,
  rows: readonly TeamsRow[] = TEAMS_ROWS,
): string | undefined {
  return resolveActiveRow(rows, teamsActivePath(pathname, selfId, search), search)?.href;
}

/** Row counts from the boot counts; My team = weekly reviews + KPI sign-offs. */
export function teamsRowCount(
  row: TeamsRow,
  counts: Partial<Record<"weeklyReviews" | "weeklyReviewsChain" | "reviewForms" | "candorOpen" | "surveysOpen" | "kpiReviews", number>>,
): number {
  if (!row.count) return 0;
  // My team counts the weekly reviews the viewer decides (the same number
  // the Weekly reviews row and /team/reviews show, and its attention card:
  // GET /api/team/attention reads the same two helpers) plus KPI sign-offs.
  if (row.count === "myTeam") return (counts.weeklyReviews ?? 0) + (counts.kpiReviews ?? 0);
  return counts[row.count] ?? 0;
}

/** spec-teams-people section 1: the hub search field shows above 12 rows. */
export const TEAMS_SEARCH_THRESHOLD = 12;
