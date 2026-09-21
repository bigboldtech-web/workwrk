// The /sops list contract (spec-process section 2 `/sops`): the five views,
// the sorts, the group-by values and the parsers for every URL parameter, so
// the page and GET /api/sops read the same words. Pure: no Prisma, no React.

import { isSopKind, type SopKind, type SopStatus } from "./sop-kind";

export type SopsView = "all" | "published" | "drafts" | "review" | "archived";
export type SopsSort = "updated" | "name" | "kind" | "status" | "owner";
export type SopsGroup = "folder" | "kind" | "status" | "none";
export type SopsViewType = "list" | "cards";

export const SOPS_VIEWS: readonly SopsView[] = ["all", "published", "drafts", "review", "archived"];
export const SOPS_VIEW_LABEL: Record<SopsView, string> = {
  all: "All",
  published: "Published",
  drafts: "Drafts",
  review: "In review",
  archived: "Archived",
};
export const SOPS_SORTS: ReadonlyArray<{ key: SopsSort; label: string }> = [
  { key: "updated", label: "Updated" },
  { key: "name", label: "Name" },
  { key: "kind", label: "Kind" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
];
export const SOPS_GROUPS: ReadonlyArray<{ key: SopsGroup; label: string }> = [
  { key: "folder", label: "Folder" },
  { key: "kind", label: "Kind" },
  { key: "status", label: "Status" },
  { key: "none", label: "None" },
];
export const SOPS_PAGE_SIZES = [40, 100] as const;

export function parseSopsView(raw: string | null | undefined): SopsView {
  return (SOPS_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as SopsView) : "all";
}
export function parseSopsSort(raw: string | null | undefined): SopsSort {
  return SOPS_SORTS.some((s) => s.key === raw) ? (raw as SopsSort) : "updated";
}
export function parseSopsGroup(raw: string | null | undefined): SopsGroup {
  return SOPS_GROUPS.some((g) => g.key === raw) ? (raw as SopsGroup) : "folder";
}
export function parseSopsDir(raw: string | null | undefined, sort: SopsSort): "asc" | "desc" {
  if (raw === "asc" || raw === "desc") return raw;
  return sort === "updated" ? "desc" : "asc";
}
export function parseSopsKind(raw: string | null | undefined): SopKind | null {
  return isSopKind(raw) ? raw : null;
}
export function parseSopsPage(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
export function parseSopsPageSize(raw: string | null | undefined): number {
  const n = Number(raw);
  return (SOPS_PAGE_SIZES as readonly number[]).includes(n) ? n : SOPS_PAGE_SIZES[0];
}

/**
 * The status filter each view implies. `drafts` is the viewer's own drafts
 * plus drafts in folders they can edit, which the visibility clause already
 * scopes, so here it is only a status filter. Returns null for "no status
 * narrowing" (All excludes Archived, the API's default).
 */
export function viewStatusWhere(view: SopsView): Record<string, unknown> {
  switch (view) {
    case "published":
      return { status: "PUBLISHED" };
    case "drafts":
      return { status: "DRAFT" };
    case "review":
      return { status: { in: ["IN_REVIEW", "APPROVED"] } };
    case "archived":
      return { status: "ARCHIVED" };
    default:
      return { status: { not: "ARCHIVED" } };
  }
}

/** Prisma orderBy for a sort key. Kind sorts by sopType (the DB axis of the kind). */
export function sopsOrderBy(sort: SopsSort, dir: "asc" | "desc"): Array<Record<string, unknown>> {
  switch (sort) {
    case "name":
      return [{ title: dir }, { updatedAt: "desc" }];
    case "kind":
      return [{ sopType: dir }, { title: "asc" }];
    case "status":
      return [{ status: dir }, { updatedAt: "desc" }];
    case "owner":
      return [{ createdBy: { firstName: dir } }, { title: "asc" }];
    default:
      return [{ updatedAt: dir }];
  }
}

/**
 * The search clause: title, description and tag names. A tag matches when
 * the term equals a tag (Prisma has no substring filter on a string array),
 * which is what a person typing a tag name expects.
 */
export function sopsSearchWhere(q: string): Record<string, unknown> | null {
  const term = q.trim();
  if (!term) return null;
  return {
    OR: [
      { title: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
      { tags: { has: term } },
    ],
  };
}

export interface SopsQuery {
  view: SopsView;
  q: string;
  kind: SopKind | null;
  folderId: string | null;
  status: SopStatus | null;
  tags: string[];
  ownerId: string | null;
  kraId: string | null;
  assignedToMe: boolean;
  updatedFrom: string | null;
  updatedTo: string | null;
  sort: SopsSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Every parameter the list reads, from one URLSearchParams. */
export function parseSopsQuery(sp: URLSearchParams): SopsQuery {
  const sort = parseSopsSort(sp.get("sort"));
  const rawStatus = sp.get("status");
  const tags = (sp.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return {
    view: parseSopsView(sp.get("view")),
    q: (sp.get("q") ?? "").trim(),
    kind: parseSopsKind(sp.get("kind")),
    folderId: sp.get("folderId") || null,
    status: rawStatus && ["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"].includes(rawStatus) ? (rawStatus as SopStatus) : null,
    tags,
    ownerId: sp.get("ownerId") || null,
    kraId: sp.get("kraId") || null,
    assignedToMe: sp.get("assignedToMe") === "1",
    updatedFrom: sp.get("updatedFrom") || null,
    updatedTo: sp.get("updatedTo") || null,
    sort,
    dir: parseSopsDir(sp.get("dir"), sort),
    page: parseSopsPage(sp.get("page")),
    pageSize: parseSopsPageSize(sp.get("pageSize")),
  };
}

/** How many filter chips are active (the toolbar's "Filter · N"; the search term counts as one). */
export function activeSopsFilterCount(q: SopsQuery): number {
  let n = 0;
  if (q.q) n += 1;
  if (q.kind) n += 1;
  if (q.folderId) n += 1;
  if (q.status) n += 1;
  if (q.tags.length) n += 1;
  if (q.ownerId) n += 1;
  if (q.kraId) n += 1;
  if (q.assignedToMe) n += 1;
  if (q.updatedFrom || q.updatedTo) n += 1;
  return n;
}
