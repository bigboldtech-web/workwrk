// The pure half of GET /api/docs?view=… (spec-docs-knowledge section 2, /docs):
// query parsing, the view rules, sorting and cursor slicing, so vitest proves
// them without prisma. The route loads rows, gates them, and hands the gated
// set to these functions.

export type DocsView = "all" | "recent" | "my" | "shared" | "favorites";
export type DocsSort = "updated" | "viewed" | "name" | "location" | "owner";

export interface DocsListQuery {
  view: DocsView;
  q: string;
  /** "SPACE:id", "FOLDER:id", "BOARD:id", "BOARD_ITEM:id", or "none". */
  location: string | null;
  owner: string | null;
  updatedFrom: string | null;
  updatedTo: string | null;
  includeChildren: boolean;
  sort: DocsSort;
  dir: "asc" | "desc";
  cursor: string | null;
  limit: number;
  /** True when any list-page param was given: the response uses the paged envelope. */
  paged: boolean;
}

export const DOCS_DEFAULT_LIMIT = 40;
export const DOCS_MAX_LIMIT = 100;

const VIEWS: DocsView[] = ["all", "recent", "my", "shared", "favorites"];
const SORTS: DocsSort[] = ["updated", "viewed", "name", "location", "owner"];

export function parseDocsListQuery(sp: URLSearchParams): DocsListQuery {
  const viewRaw = sp.get("view");
  const view = (VIEWS as string[]).includes(viewRaw ?? "") ? (viewRaw as DocsView) : "all";
  const sortRaw = sp.get("sort");
  const sort = (SORTS as string[]).includes(sortRaw ?? "") ? (sortRaw as DocsSort) : view === "recent" ? "viewed" : "updated";
  const dirRaw = sp.get("dir");
  const dir: "asc" | "desc" = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === "name" || sort === "location" || sort === "owner" ? "asc" : "desc";
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(DOCS_MAX_LIMIT, Math.floor(limitRaw)) : DOCS_DEFAULT_LIMIT;
  const paged = ["view", "q", "location", "owner", "updatedFrom", "updatedTo", "includeChildren", "sort", "dir", "cursor", "limit", "paged"].some((key) => sp.has(key));
  return {
    view,
    q: (sp.get("q") ?? "").trim().toLowerCase(),
    location: sp.get("location")?.trim() || null,
    owner: sp.get("owner")?.trim() || null,
    updatedFrom: sp.get("updatedFrom")?.trim() || null,
    updatedTo: sp.get("updatedTo")?.trim() || null,
    includeChildren: sp.get("includeChildren") === "1",
    sort,
    dir,
    cursor: sp.get("cursor")?.trim() || null,
    limit,
    paged,
  };
}

/** The row shape the view rules and sort read. Everything else is enrichment. */
export interface DocsCandidate {
  id: string;
  title: string;
  parentId: string | null;
  entityType: string | null;
  entityId: string | null;
  createdById: string | null;
  updatedAt: Date | string;
  /** Resolved before sorting; "" when unanchored. */
  locationName?: string;
  ownerName?: string;
  /** True when the viewer's access on this doc comes from a share row (docSharing members). */
  sharedWithMe?: boolean;
}

export interface DocsViewerFacts {
  userId: string;
  favoriteIds: ReadonlySet<string>;
  /** docId -> ISO viewed-at, from home.recentDocViews. */
  viewedAt: ReadonlyMap<string, string>;
  now?: Date;
}

const THIRTY_DAYS = 30 * 86_400_000;

/**
 * The five views as one predicate.
 *   all        every readable doc
 *   recent     opened by the viewer in the last 30 days
 *   my         owned (created) by the viewer
 *   shared     access via a share, never ownership or Everyone: today a
 *              docSharing member row, or an anchored doc the viewer does not own
 *   favorites  starred
 */
export function matchesView(row: DocsCandidate, view: DocsView, facts: DocsViewerFacts): boolean {
  switch (view) {
    case "recent": {
      const at = facts.viewedAt.get(row.id);
      if (!at) return false;
      const ms = new Date(at).getTime();
      return Number.isFinite(ms) && (facts.now ?? new Date()).getTime() - ms <= THIRTY_DAYS;
    }
    case "my":
      return !!row.createdById && row.createdById === facts.userId;
    case "shared":
      if (row.createdById === facts.userId) return false;
      return !!row.sharedWithMe || (!!row.entityType && row.entityType !== "NOTEPAD");
    case "favorites":
      return facts.favoriteIds.has(row.id);
    default:
      return true;
  }
}

export function matchesFilters(row: DocsCandidate, q: DocsListQuery): boolean {
  if (!q.includeChildren && row.parentId) return false;
  if (q.q && !row.title.toLowerCase().includes(q.q)) return false;
  if (q.owner && row.createdById !== q.owner) return false;
  if (q.location) {
    if (q.location === "none") {
      if (row.entityType || row.entityId) return false;
    } else {
      const i = q.location.indexOf(":");
      const type = i > 0 ? q.location.slice(0, i) : q.location;
      const id = i > 0 ? q.location.slice(i + 1) : "";
      if (row.entityType !== type || (id && row.entityId !== id)) return false;
    }
  }
  const updated = new Date(row.updatedAt).getTime();
  if (q.updatedFrom) {
    const from = new Date(q.updatedFrom).getTime();
    if (Number.isFinite(from) && updated < from) return false;
  }
  if (q.updatedTo) {
    const to = new Date(q.updatedTo).getTime();
    if (Number.isFinite(to) && updated > to) return false;
  }
  return true;
}

export function sortDocs<T extends DocsCandidate>(rows: T[], sort: DocsSort, dir: "asc" | "desc", facts: DocsViewerFacts): T[] {
  const sgn = dir === "asc" ? 1 : -1;
  const byId = (a: T, b: T) => a.id.localeCompare(b.id);
  const cmp = (a: T, b: T): number => {
    switch (sort) {
      case "name":
        return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }) || byId(a, b);
      case "location":
        return (a.locationName ?? "").localeCompare(b.locationName ?? "", undefined, { sensitivity: "base" }) || byId(a, b);
      case "owner":
        return (a.ownerName ?? "").localeCompare(b.ownerName ?? "", undefined, { sensitivity: "base" }) || byId(a, b);
      case "viewed": {
        const va = facts.viewedAt.get(a.id) ?? "";
        const vb = facts.viewedAt.get(b.id) ?? "";
        return va.localeCompare(vb) || byId(a, b);
      }
      default:
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime() || byId(a, b);
    }
  };
  return [...rows].sort((a, b) => sgn * cmp(a, b));
}

/** Cursor = the id of the last row of the previous page; unknown cursors restart at 0. */
export function slicePage<T extends { id: string }>(rows: T[], cursor: string | null, limit: number): { page: T[]; nextCursor: string | null; from: number } {
  let start = 0;
  if (cursor) {
    const i = rows.findIndex((r) => r.id === cursor);
    start = i >= 0 ? i + 1 : 0;
  }
  const page = rows.slice(start, start + limit);
  const nextCursor = start + limit < rows.length && page.length > 0 ? page[page.length - 1].id : null;
  return { page, nextCursor, from: start };
}
