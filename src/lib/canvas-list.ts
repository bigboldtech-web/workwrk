// The pure half of GET /api/whiteboards?view=… (spec-docs-knowledge section
// 2, /canvas): query parsing, the four views, filters and sort.

import { parseDir, parseLimit, pick, textCompare, timeOf, wantsPaged } from "./list-query";

export type CanvasView = "all" | "recent" | "my" | "favorites";
export type CanvasSort = "edited" | "name" | "owner" | "created";

export interface CanvasListQuery {
  view: CanvasView;
  q: string;
  /** "SPACE:id" or "none". */
  location: string | null;
  owner: string | null;
  editedFrom: string | null;
  editedTo: string | null;
  sort: CanvasSort;
  dir: "asc" | "desc";
  cursor: string | null;
  limit: number;
  paged: boolean;
}

const VIEWS: CanvasView[] = ["all", "recent", "my", "favorites"];
const SORTS: CanvasSort[] = ["edited", "name", "owner", "created"];
const PAGED_KEYS = ["view", "q", "location", "owner", "editedFrom", "editedTo", "sort", "dir", "cursor", "limit", "paged"] as const;

export function parseCanvasListQuery(sp: URLSearchParams): CanvasListQuery {
  const sort = pick(sp.get("sort"), SORTS, "edited");
  return {
    view: pick(sp.get("view"), VIEWS, "all"),
    q: (sp.get("q") ?? "").trim().toLowerCase(),
    location: sp.get("location")?.trim() || null,
    owner: sp.get("owner")?.trim() || null,
    editedFrom: sp.get("editedFrom")?.trim() || null,
    editedTo: sp.get("editedTo")?.trim() || null,
    sort,
    dir: parseDir(sp.get("dir"), sort === "name" || sort === "owner"),
    cursor: sp.get("cursor")?.trim() || null,
    limit: parseLimit(sp.get("limit")),
    paged: wantsPaged(sp, PAGED_KEYS),
  };
}

export interface CanvasCandidate {
  id: string;
  name: string;
  description?: string | null;
  ownerId: string | null;
  spaceId: string | null;
  lastEditedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  ownerName?: string;
}

const THIRTY_DAYS = 30 * 86_400_000;

export function matchesCanvasView(row: CanvasCandidate, view: CanvasView, facts: { userId: string; favoriteIds: ReadonlySet<string>; now?: Date }): boolean {
  switch (view) {
    case "recent": {
      const t = timeOf(row.lastEditedAt ?? row.updatedAt);
      return t > 0 && (facts.now ?? new Date()).getTime() - t <= THIRTY_DAYS;
    }
    case "my":
      return !!row.ownerId && row.ownerId === facts.userId;
    case "favorites":
      return facts.favoriteIds.has(row.id);
    default:
      return true;
  }
}

export function matchesCanvasFilters(row: CanvasCandidate, q: CanvasListQuery): boolean {
  if (q.q && !row.name.toLowerCase().includes(q.q) && !(row.description ?? "").toLowerCase().includes(q.q)) return false;
  if (q.owner && row.ownerId !== q.owner) return false;
  if (q.location) {
    if (q.location === "none") { if (row.spaceId) return false; }
    else {
      const id = q.location.startsWith("SPACE:") ? q.location.slice(6) : q.location;
      if (row.spaceId !== id) return false;
    }
  }
  const edited = timeOf(row.lastEditedAt ?? row.updatedAt);
  if (q.editedFrom) { const f = timeOf(q.editedFrom); if (f && edited < f) return false; }
  if (q.editedTo) { const t = timeOf(q.editedTo); if (t && edited > t) return false; }
  return true;
}

export function sortCanvases<T extends CanvasCandidate>(rows: T[], sort: CanvasSort, dir: "asc" | "desc"): T[] {
  const sgn = dir === "asc" ? 1 : -1;
  const byId = (a: T, b: T) => a.id.localeCompare(b.id);
  const cmp = (a: T, b: T): number => {
    switch (sort) {
      case "name": return textCompare(a.name, b.name) || byId(a, b);
      case "owner": return textCompare(a.ownerName, b.ownerName) || byId(a, b);
      case "created": return timeOf(a.createdAt) - timeOf(b.createdAt) || byId(a, b);
      default: return timeOf(a.lastEditedAt ?? a.updatedAt) - timeOf(b.lastEditedAt ?? b.updatedAt) || byId(a, b);
    }
  };
  return [...rows].sort((a, b) => sgn * cmp(a, b));
}
