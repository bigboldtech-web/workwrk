// The Directory's query, one parser for both ends: the page reads it from
// its URL (?view=&q=&dept=&title=&office=&reportsTo=&tags=&seniority=
// &deactivated=&sort=&group=&page=&size=) and GET /api/users reads the same
// names from the API URL, so a shared link, Back and the server all agree.
//
// Pure: no imports. Client safe.

export type DirectoryView = "all" | "new" | "nomanager" | "removed";
export type DirectorySort = "name" | "recent" | "tenure" | "reports";
export type DirectoryGroup = "none" | "department" | "office" | "title";

export interface DirectoryQuery {
  view: DirectoryView;
  q: string;
  departmentId: string | null;
  roleId: string | null;
  officeId: string | null;
  managerId: string | null;
  tagIds: string[];
  seniority: string[];
  deactivated: boolean;
  sort: DirectorySort;
  group: DirectoryGroup;
  page: number;
  size: number;
}

export const DIRECTORY_PAGE_SIZES = [40, 100] as const;
export const NEW_JOINER_DAYS = 90;

const VIEWS: ReadonlySet<string> = new Set(["all", "new", "nomanager", "removed"]);
const SORTS: ReadonlySet<string> = new Set(["name", "recent", "tenure", "reports"]);
const GROUPS: ReadonlySet<string> = new Set(["none", "department", "office", "title"]);

type ParamsLike = { get(name: string): string | null };

function list(v: string | null): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** The AccessLevel enum values a job title's seniority can hold. */
const SENIORITY_VALUES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR",
]);

/**
 * Parse the query. Values a viewer may not use (the Removed and No manager
 * views, the Deactivated filter) are dropped here when `privileged` is
 * false, which is rule 4 of the denial shapes: the default view, never a
 * 404. The page strips the dropped parameter from its URL.
 */
export function parseDirectoryQuery(sp: ParamsLike, opts: { privileged: boolean }): DirectoryQuery {
  const rawView = sp.get("view") ?? "all";
  let view: DirectoryView = VIEWS.has(rawView) ? (rawView as DirectoryView) : "all";
  if (!opts.privileged && (view === "removed" || view === "nomanager")) view = "all";
  const rawSort = sp.get("sort") ?? "name";
  const rawGroup = sp.get("group") ?? "none";
  const page = Math.max(1, Math.floor(Number(sp.get("page") ?? "1")) || 1);
  const rawSize = Number(sp.get("size") ?? sp.get("limit") ?? "40");
  const size = Math.min(100, Math.max(1, Math.floor(rawSize) || 40));
  return {
    view,
    q: (sp.get("q") ?? sp.get("search") ?? "").trim().slice(0, 120),
    departmentId: sp.get("dept") ?? sp.get("departmentId"),
    roleId: sp.get("title") ?? sp.get("roleId"),
    officeId: sp.get("office") ?? sp.get("officeId"),
    managerId: sp.get("reportsTo") ?? sp.get("managerId"),
    tagIds: list(sp.get("tags") ?? sp.get("tagIds")),
    // Only real seniority values reach the database; anything else is
    // dropped (the filter reads as off), never a 500.
    seniority: list(sp.get("seniority")).filter((v) => SENIORITY_VALUES.has(v)),
    deactivated: opts.privileged && sp.get("deactivated") === "1",
    sort: SORTS.has(rawSort) ? (rawSort as DirectorySort) : "name",
    group: GROUPS.has(rawGroup) ? (rawGroup as DirectoryGroup) : "none",
    page,
    size,
  };
}

/** How many filters are on (the "Filter · 2" count). Views, sort and group are not filters. */
export function activeDirectoryFilters(q: DirectoryQuery): number {
  return (
    (q.q ? 1 : 0) +
    (q.departmentId ? 1 : 0) +
    (q.roleId ? 1 : 0) +
    (q.officeId ? 1 : 0) +
    (q.managerId ? 1 : 0) +
    (q.tagIds.length ? 1 : 0) +
    (q.seniority.length ? 1 : 0) +
    (q.deactivated ? 1 : 0)
  );
}

/** The API query string for a Directory query (the page calls GET /api/users with it). */
export function directoryApiParams(q: DirectoryQuery): URLSearchParams {
  const p = new URLSearchParams();
  p.set("scope", "directory");
  if (q.view !== "all") p.set("view", q.view);
  if (q.q) p.set("q", q.q);
  if (q.departmentId) p.set("dept", q.departmentId);
  if (q.roleId) p.set("title", q.roleId);
  if (q.officeId) p.set("office", q.officeId);
  if (q.managerId) p.set("reportsTo", q.managerId);
  if (q.tagIds.length) p.set("tags", q.tagIds.join(","));
  if (q.seniority.length) p.set("seniority", q.seniority.join(","));
  if (q.deactivated) p.set("deactivated", "1");
  if (q.sort !== "name") p.set("sort", q.sort);
  // Grouped rendering needs the rows in group order first.
  if (q.group !== "none") p.set("group", q.group);
  p.set("page", String(q.page));
  p.set("limit", String(q.size));
  return p;
}

/** A plain where-description the route turns into Prisma (kept pure for tests). */
export interface DirectoryWhere {
  deleted: "exclude" | "only";
  status: "not-inactive" | "inactive" | "any";
  departmentId?: string;
  roleId?: string;
  officeId?: string;
  managerId?: string;
  noManager?: boolean;
  joinedAfter?: Date;
  seniority?: string[];
  q?: string;
}

export function directoryWhere(q: DirectoryQuery, now: Date = new Date()): DirectoryWhere {
  const w: DirectoryWhere = {
    deleted: q.view === "removed" ? "only" : "exclude",
    // Deactivated people are a filter, not part of All (spec: the Active
    // tab merged into All); the Removed view shows every removed person.
    status: q.view === "removed" ? "any" : q.deactivated ? "inactive" : "not-inactive",
  };
  if (q.departmentId) w.departmentId = q.departmentId;
  if (q.roleId) w.roleId = q.roleId;
  if (q.officeId) w.officeId = q.officeId;
  if (q.managerId) w.managerId = q.managerId;
  if (q.view === "nomanager") w.noManager = true;
  if (q.view === "new") w.joinedAfter = new Date(now.getTime() - NEW_JOINER_DAYS * 86_400_000);
  if (q.seniority.length) w.seniority = q.seniority;
  if (q.q) w.q = q.q;
  return w;
}
