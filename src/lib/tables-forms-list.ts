// The pure half of GET /api/tables?view=… and GET /api/forms?view=…
// (spec-tables-forms section 2, /tables and /forms): query parsing, the view
// rules, the filters, sorting and cursor slicing, so vitest proves them
// without prisma. Each route loads its rows, gates them, enriches them and
// hands the gated set to these functions.
//
// "Shared with me", while the access engine stays inert (Phase 5 keeps
// src/lib/access untouched): a row the viewer did not make whose access comes
// from a Space membership. A standalone table or form is the org-wide
// "Everyone" row, and ownership is "Mine", so neither is "shared" (spec: "never
// from ownership or the Everyone row").

import { slicePage } from "@/lib/docs-list";

export { slicePage };

export type ObjectListView = "all" | "mine" | "shared" | "favorites";
export const OBJECT_LIST_VIEWS: ObjectListView[] = ["all", "mine", "shared", "favorites"];

export type TablesSort = "updated" | "name" | "rows" | "owner";
export type FormsSort = "updated" | "name" | "responses" | "owner";

export const LIST_DEFAULT_LIMIT = 40;
export const LIST_MAX_LIMIT = 100;

const TABLE_SORTS: TablesSort[] = ["updated", "name", "rows", "owner"];
const FORM_SORTS: FormsSort[] = ["updated", "name", "responses", "owner"];

/** Every param either list page sends; any one of them selects the paged envelope. */
const PAGED_KEYS = [
  "view", "q", "location", "owner", "updatedFrom", "updatedTo", "hasForm", "goesTo", "status", "public",
  "sort", "dir", "cursor", "limit", "paged",
];

export interface ObjectListQuery<S extends string> {
  view: ObjectListView;
  q: string;
  /** Tables: a Space id, or "none" for no Space. */
  location: string | null;
  owner: string | null;
  updatedFrom: string | null;
  updatedTo: string | null;
  /** Tables only: tables that are some form's destination. */
  hasForm: boolean;
  /** Forms only: "list:{id}", "table:{id}" or "none". */
  goesTo: string | null;
  /** Forms only. */
  status: FormStatus | null;
  /** Forms only: the public link is on ("on") or off ("off"). */
  publicLink: "on" | "off" | null;
  sort: S;
  dir: "asc" | "desc";
  cursor: string | null;
  limit: number;
  /** True when any list-page param was given: the response uses the paged envelope. */
  paged: boolean;
}

export type FormStatus = "open" | "closed" | "needs-destination";

function parseCommon(sp: URLSearchParams) {
  const viewRaw = sp.get("view");
  const view = (OBJECT_LIST_VIEWS as string[]).includes(viewRaw ?? "") ? (viewRaw as ObjectListView) : "all";
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(LIST_MAX_LIMIT, Math.floor(limitRaw)) : LIST_DEFAULT_LIMIT;
  const statusRaw = sp.get("status");
  const publicRaw = sp.get("public");
  return {
    view,
    q: (sp.get("q") ?? "").trim().toLowerCase(),
    location: sp.get("location")?.trim() || null,
    owner: sp.get("owner")?.trim() || null,
    updatedFrom: sp.get("updatedFrom")?.trim() || null,
    updatedTo: sp.get("updatedTo")?.trim() || null,
    hasForm: sp.get("hasForm") === "1",
    goesTo: sp.get("goesTo")?.trim() || null,
    status: statusRaw === "open" || statusRaw === "closed" || statusRaw === "needs-destination" ? statusRaw : null,
    publicLink: publicRaw === "on" || publicRaw === "off" ? publicRaw : null,
    cursor: sp.get("cursor")?.trim() || null,
    limit,
    paged: PAGED_KEYS.some((key) => sp.has(key)),
  } as const;
}

function parseDir(sp: URLSearchParams, sort: string): "asc" | "desc" {
  const dirRaw = sp.get("dir");
  if (dirRaw === "asc" || dirRaw === "desc") return dirRaw;
  return sort === "name" || sort === "owner" ? "asc" : "desc";
}

export function parseTablesListQuery(sp: URLSearchParams): ObjectListQuery<TablesSort> {
  const sortRaw = sp.get("sort");
  const sort = (TABLE_SORTS as string[]).includes(sortRaw ?? "") ? (sortRaw as TablesSort) : "updated";
  return { ...parseCommon(sp), sort, dir: parseDir(sp, sort) };
}

export function parseFormsListQuery(sp: URLSearchParams): ObjectListQuery<FormsSort> {
  const sortRaw = sp.get("sort");
  const sort = (FORM_SORTS as string[]).includes(sortRaw ?? "") ? (sortRaw as FormsSort) : "updated";
  return { ...parseCommon(sp), sort, dir: parseDir(sp, sort) };
}

/** What the view rules, filters and sorts read from one table or form. */
export interface ListCandidate {
  id: string;
  name: string;
  createdById: string | null;
  updatedAt: Date | string;
  /** The Space the object sits in (a table's `spaceId`, a form's destination's). */
  spaceId: string | null;
  isPublic: boolean;
  ownerName?: string;
  locationName?: string;
  /** Tables: filled rows. Forms: responses. */
  count?: number;
  /** Tables only. */
  hasForm?: boolean;
  /** Forms only: "list:{id}" | "table:{id}" | null. */
  goesTo?: string | null;
  /** Forms only. */
  status?: FormStatus;
}

export interface ListViewerFacts {
  userId: string;
  favoriteIds: ReadonlySet<string>;
}

export function matchesListView(row: ListCandidate, view: ObjectListView, facts: ListViewerFacts): boolean {
  switch (view) {
    case "mine":
      return !!row.createdById && row.createdById === facts.userId;
    case "shared":
      return row.createdById !== facts.userId && !!row.spaceId;
    case "favorites":
      return facts.favoriteIds.has(row.id);
    default:
      return true;
  }
}

function dayStart(s: string): number {
  const t = new Date(s.length <= 10 ? `${s}T00:00:00` : s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function matchesListFilters<S extends string>(row: ListCandidate, q: ObjectListQuery<S>): boolean {
  if (q.q && !(row.name || "").toLowerCase().includes(q.q)) return false;
  if (q.location) {
    if (q.location === "none" ? !!row.spaceId : row.spaceId !== q.location) return false;
  }
  if (q.owner && row.createdById !== q.owner) return false;
  const updated = new Date(row.updatedAt).getTime();
  if (q.updatedFrom) {
    const from = dayStart(q.updatedFrom);
    if (Number.isFinite(from) && updated < from) return false;
  }
  if (q.updatedTo) {
    const toRaw = q.updatedTo.length <= 10 ? `${q.updatedTo}T23:59:59.999` : q.updatedTo;
    const to = new Date(toRaw).getTime();
    if (Number.isFinite(to) && updated > to) return false;
  }
  if (q.hasForm && !row.hasForm) return false;
  if (q.goesTo) {
    if (q.goesTo === "none" ? !!row.goesTo : row.goesTo !== q.goesTo) return false;
  }
  if (q.status && row.status !== q.status) return false;
  if (q.publicLink && (q.publicLink === "on") !== row.isPublic) return false;
  return true;
}

export function sortListRows<T extends ListCandidate>(rows: T[], sort: TablesSort | FormsSort, dir: "asc" | "desc"): T[] {
  const sgn = dir === "asc" ? 1 : -1;
  const byId = (a: T, b: T) => a.id.localeCompare(b.id);
  const cmp = (a: T, b: T): number => {
    switch (sort) {
      case "name":
        return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }) || byId(a, b);
      case "owner":
        return (a.ownerName ?? "").localeCompare(b.ownerName ?? "", undefined, { sensitivity: "base" }) || byId(a, b);
      case "rows":
      case "responses":
        return (a.count ?? 0) - (b.count ?? 0) || byId(a, b);
      default:
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime() || byId(a, b);
    }
  };
  return [...rows].sort((a, b) => sgn * cmp(a, b));
}

/** The four view counts, from the same gated set the rows come from. */
export function countListViews(rows: ListCandidate[], facts: ListViewerFacts): Record<ObjectListView, number> {
  const counts: Record<ObjectListView, number> = { all: 0, mine: 0, shared: 0, favorites: 0 };
  for (const r of rows) {
    for (const v of OBJECT_LIST_VIEWS) if (matchesListView(r, v, facts)) counts[v] += 1;
  }
  return counts;
}

/**
 * A form's Status chip (spec /forms: Open, Closed, Needs a destination).
 * `settings` is the additive FormDefinition.settings bucket, which may be
 * absent for one release (every reader tolerates a missing column): absent
 * reads as accepting responses with no close date.
 */
export function formStatus(
  f: { targetBoardId: string | null; targetTableId: string | null; settings?: unknown },
  now: Date = new Date(),
): FormStatus {
  const s = f.settings && typeof f.settings === "object" ? (f.settings as { acceptingResponses?: unknown; closesAt?: unknown }) : {};
  if (s.acceptingResponses === false) return "closed";
  if (typeof s.closesAt === "string") {
    const t = new Date(s.closesAt).getTime();
    if (Number.isFinite(t) && t <= now.getTime()) return "closed";
  }
  if (!f.targetBoardId && !f.targetTableId) return "needs-destination";
  return "open";
}

/** A form's destination key for the Goes to filter: the List wins when both are set. */
export function formGoesTo(f: { targetBoardId: string | null; targetTableId: string | null }): string | null {
  if (f.targetBoardId) return `list:${f.targetBoardId}`;
  if (f.targetTableId) return `table:${f.targetTableId}`;
  return null;
}

/** The copy's name ("Budget" becomes "Copy of Budget"), capped like every name. */
export function copyName(name: string, fallback: string): string {
  const base = (name || "").trim() || fallback;
  return `Copy of ${base}`.slice(0, 200);
}
