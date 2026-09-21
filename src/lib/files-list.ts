// The pure half of GET /api/files?view=… (spec-docs-knowledge section 2,
// /files): query parsing, the four views, the type buckets, filters and sort.

import { parseDir, parseLimit, pick, textCompare, timeOf, wantsPaged } from "./list-query";

export type FilesView = "all" | "starred" | "recent" | "spaces";
export type FilesSort = "name" | "uploaded" | "size" | "type";
export type FileTypeBucket = "images" | "documents" | "pdfs" | "video" | "audio" | "archives" | "other";

export const FILE_TYPE_BUCKETS: { key: FileTypeBucket; label: string }[] = [
  { key: "images", label: "Images" },
  { key: "documents", label: "Documents" },
  { key: "pdfs", label: "PDFs" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "archives", label: "Archives" },
  { key: "other", label: "Other" },
];

export interface FilesListQuery {
  view: FilesView;
  /** The drive folder ("root" when absent) for the All view. */
  folderId: string | null;
  q: string;
  type: FileTypeBucket | null;
  uploadedBy: string | null;
  from: string | null;
  to: string | null;
  sort: FilesSort;
  dir: "asc" | "desc";
  cursor: string | null;
  limit: number;
  paged: boolean;
}

const VIEWS: FilesView[] = ["all", "starred", "recent", "spaces"];
const SORTS: FilesSort[] = ["name", "uploaded", "size", "type"];
const TYPES = FILE_TYPE_BUCKETS.map((t) => t.key);
const PAGED_KEYS = ["view", "type", "uploadedBy", "from", "to", "sort", "dir", "cursor", "limit", "paged"] as const;

export function parseFilesListQuery(sp: URLSearchParams): FilesListQuery {
  const sort = pick(sp.get("sort"), SORTS, "uploaded");
  const folderRaw = sp.get("folderId");
  const typeRaw = sp.get("type");
  return {
    view: pick(sp.get("view"), VIEWS, sp.get("starred") === "true" ? "starred" : "all"),
    folderId: folderRaw === null || folderRaw === "root" || folderRaw === "" ? null : folderRaw,
    q: (sp.get("q") ?? "").trim().toLowerCase(),
    type: (TYPES as string[]).includes(typeRaw ?? "") ? (typeRaw as FileTypeBucket) : null,
    uploadedBy: sp.get("uploadedBy")?.trim() || null,
    from: sp.get("from")?.trim() || null,
    to: sp.get("to")?.trim() || null,
    sort,
    dir: parseDir(sp.get("dir"), sort === "name" || sort === "type"),
    cursor: sp.get("cursor")?.trim() || null,
    limit: parseLimit(sp.get("limit")),
    paged: wantsPaged(sp, PAGED_KEYS),
  };
}

/** The Type filter's buckets, from the mime type. */
export function fileTypeBucket(mime: string): FileTypeBucket {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "images";
  if (m === "application/pdf" || m.includes("pdf")) return "pdfs";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("zip") || m.includes("tar") || m.includes("compressed") || m.includes("rar") || m.includes("7z")) return "archives";
  if (m.startsWith("text/") || m.includes("document") || m.includes("sheet") || m.includes("presentation") || m.includes("json") || m.includes("csv") || m.includes("msword") || m.includes("officedocument")) return "documents";
  return "other";
}

/** One word for the Type column: "Image", "PDF", "Document", ... */
export function fileTypeLabel(mime: string): string {
  switch (fileTypeBucket(mime)) {
    case "images": return "Image";
    case "pdfs": return "PDF";
    case "video": return "Video";
    case "audio": return "Audio";
    case "archives": return "Archive";
    case "documents": return "Document";
    default: return "File";
  }
}

export interface FileCandidate {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  folderId: string | null;
  spaceId: string | null;
  spaceFolderId: string | null;
  uploadedById: string;
  starred: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const THIRTY_DAYS = 30 * 86_400_000;

export function lastTouched(row: FileCandidate): number {
  return Math.max(timeOf(row.createdAt), timeOf(row.updatedAt));
}

/**
 * The four views.
 *   all       the drive folder in the URL (root when none); Space files excluded
 *   starred   the viewer's favorites, plus rows carrying the org-wide starred flag
 *             (the column that existed before favorites were per person)
 *   recent    added or changed in the last 30 days, anywhere
 *   spaces    files anchored inside a Space (folder or root), which the drive tree does not hold
 */
export function matchesFilesView(row: FileCandidate, q: FilesListQuery, facts: { favoriteIds: ReadonlySet<string>; now?: Date }): boolean {
  switch (q.view) {
    case "starred":
      return facts.favoriteIds.has(row.id) || row.starred;
    case "recent":
      return (facts.now ?? new Date()).getTime() - lastTouched(row) <= THIRTY_DAYS;
    case "spaces":
      return !!row.spaceId;
    default:
      if (row.spaceId) return false;
      // A search spans the whole drive; otherwise the view is one folder.
      if (q.q) return true;
      return (row.folderId ?? null) === q.folderId;
  }
}

export function matchesFilesFilters(row: FileCandidate, q: FilesListQuery): boolean {
  if (q.q && !row.name.toLowerCase().includes(q.q)) return false;
  if (q.type && fileTypeBucket(row.mimeType) !== q.type) return false;
  if (q.uploadedBy && row.uploadedById !== q.uploadedBy) return false;
  const t = lastTouched(row);
  if (q.from) { const f = timeOf(q.from); if (f && t < f) return false; }
  if (q.to) { const to = timeOf(q.to); if (to && t > to) return false; }
  return true;
}

export function sortFiles<T extends FileCandidate>(rows: T[], sort: FilesSort, dir: "asc" | "desc"): T[] {
  const sgn = dir === "asc" ? 1 : -1;
  const byId = (a: T, b: T) => a.id.localeCompare(b.id);
  const cmp = (a: T, b: T): number => {
    switch (sort) {
      case "name": return textCompare(a.name, b.name) || byId(a, b);
      case "size": return a.size - b.size || byId(a, b);
      case "type": return textCompare(fileTypeLabel(a.mimeType), fileTypeLabel(b.mimeType)) || textCompare(a.name, b.name) || byId(a, b);
      default: return lastTouched(a) - lastTouched(b) || byId(a, b);
    }
  };
  return [...rows].sort((a, b) => sgn * cmp(a, b));
}
