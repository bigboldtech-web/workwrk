"use client";

/* /files (spec-docs-knowledge section 2): the company's files in folders,
 * with upload, preview and a place to find what I starred.
 *
 *   URL      /files · ?folder= · ?file= (the preview drawer) · ?view=starred|
 *            recent|spaces · ?q= · ?type= · ?uploadedBy= · ?from= · ?to= ·
 *            ?sort= · ?dir= · ?cursor= · ?upload=1 (opens the picker once)
 *   header   "Files" (or the folder name with a folder tile) · views All ·
 *            Favorites · Recent · In Spaces · toolbar Filter, Sort, list / grid,
 *            search, Display, the one blue "Upload" split (chevron: New
 *            folder), "..." (Trash)
 *   body     a full-area drop zone; an upload strip with per-file Retry;
 *            TableCard (folders first, then files) or the grid of tiles;
 *            FileRowMenu / FolderRowMenu; bulk bar; footer with the real
 *            total and the size sum
 *
 *   GET  /api/files?view=&folderId=&q=&type=&uploadedBy=&from=&to=&sort=&dir=
 *        &cursor=&limit=      server views, filters, sort and pages
 *   POST /api/upload then POST /api/files { folderId }
 *
 * Starring is per person (home.favoriteFileIds, /api/me/favorites/files); the
 * The Favorites view also lists rows carrying the old org-wide flag so
 * nothing a person saw as starred disappears.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive, Clock, Code2, File as FileIcon, FileText, Film, Folder, FolderPlus, HardDrive, Image as ImageIcon, Layers, LayoutGrid, Music, Rows3, Search, SlidersHorizontal, Sparkles, Star, Trash2, Upload, X, FolderInput,
} from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useBoot } from "@/components/layout/os/boot-context";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem } from "@/components/ui/menu";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { SplitPrimary } from "@/components/ui/split-primary";
import { EntityTile } from "@/components/ui/entity-tile";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { FileRowMenuHost, useFileRowMenu, dispatchFilesChanged, isSummarizable, type FileMenuTarget } from "@/components/files/file-row-menu";
import { FilePreviewDrawer, type PreviewFile } from "@/components/files/file-preview-drawer";
import { MoveFileDialog } from "@/components/files/move-file-dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { FILES_COLUMNS, readFilesColumns, readFilesViewType, type FilesColumnKey } from "@/lib/docs-prefs";
import { FILE_TYPE_BUCKETS, fileTypeBucket, fileTypeLabel, type FilesSort, type FilesView } from "@/lib/files-list";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { formatBytes } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/* ───────────────────────────── types ───────────────────────────── */

type FolderRow = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt?: string; canManage?: boolean; _count?: { files?: number; children?: number } };
type FileRow = PreviewFile;
type ListResponse = { data: FileRow[]; total: number; totalBytes: number; nextCursor: string | null };
type RowItem = { kind: "folder"; folder: FolderRow } | { kind: "file"; file: FileRow };
type UploadJob = { key: string; name: string; size: number; file: File; status: "queued" | "uploading" | "done" | "failed"; error?: string };

// "Favorites" is the one word for a starred object across the product
// (naming-canon 2.14; "Starred" is a retired term). The ?view=starred URL
// value is unchanged so every existing link keeps resolving.
const VIEW_LABEL: Record<FilesView, string> = { all: "All", starred: "Favorites", recent: "Recent", spaces: "In Spaces" };
const VIEWS: Array<{ key: FilesView; Icon: typeof Folder }> = [
  { key: "all", Icon: HardDrive }, { key: "starred", Icon: Star }, { key: "recent", Icon: Clock }, { key: "spaces", Icon: Layers },
];
const SORTS: Array<{ key: FilesSort; label: string }> = [
  { key: "name", label: "Name" }, { key: "uploaded", label: "Date uploaded" }, { key: "size", label: "Size" }, { key: "type", label: "Type" },
];
const COLUMN_LABEL: Record<FilesColumnKey, string> = { type: "Type", size: "Size", uploaded: "Uploaded", owner: "Uploaded by", location: "Location", summary: "Show AI summaries" };
const PAGE_SIZES = [40, 100];
const isView = (v: string | null): v is FilesView => !!v && v in VIEW_LABEL;
const isSort = (v: string | null): v is FilesSort => !!v && SORTS.some((s) => s.key === v);
const personName = (p: PersonRef | null | undefined) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "" : "");

function glyphFor(mime: string) {
  switch (fileTypeBucket(mime)) {
    case "images": return ImageIcon;
    case "video": return Film;
    case "audio": return Music;
    case "archives": return Archive;
    case "documents": return mime.includes("json") ? Code2 : FileText;
    case "pdfs": return FileText;
    default: return FileIcon;
  }
}

let jobSeq = 0;

/* ───────────────────────────── page ───────────────────────────── */

export default function FilesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, prefs, patchPrefs, railApps } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const fmt = useFormat();
  const aiOn = railApps.some((a) => a.key === "ai");

  /* ── URL state ── */
  const folderId = params.get("folder");
  const fileParam = params.get("file");
  const view: FilesView = isView(params.get("view")) ? (params.get("view") as FilesView) : params.get("starred") === "1" ? "starred" : "all";
  const q = params.get("q") ?? "";
  const type = params.get("type");
  const uploadedBy = params.get("uploadedBy");
  const from = params.get("from");
  const to = params.get("to");
  const sort: FilesSort = isSort(params.get("sort")) ? (params.get("sort") as FilesSort) : "uploaded";
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : (sort === "name" || sort === "type" ? "asc" : "desc");
  const cursor = params.get("cursor");
  const limitRaw = Number(params.get("limit"));
  const limit = PAGE_SIZES.includes(limitRaw) ? limitRaw : PAGE_SIZES[0];
  const viewType = readFilesViewType(prefs.home);
  const cols = readFilesColumns(prefs.home);

  // The cursors of the pages before this one (state, so the footer can read
  // its length in render); a filter or sort change resets it in setParams.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const pageIndex = cursorStack.length;
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepCursor?: boolean; replace?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepCursor) { next.delete("cursor"); setCursorStack([]); }
    next.delete("upload");
    next.delete("starred");
    const s = next.toString();
    const href = s ? `/files?${s}` : "/files";
    if (opts?.replace) router.replace(href); else router.push(href);
  }, [params, router]);
  const activeFilters = [type, uploadedBy, from || to ? "range" : null].filter(Boolean).length;

  /* ── folders (the tree is small; one load) ── */
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [foldersError, setFoldersError] = useState(false);
  const loadFolders = useCallback(async () => {
    const r = await apiFetch<FolderRow[] | { data: FolderRow[] }>("/api/files/folders", { cache: "no-store" });
    if (!r.ok) { setFoldersError(true); return; }
    setFoldersError(false);
    setFolders(Array.isArray(r.data) ? r.data : r.data.data ?? []);
  }, []);
  const folderById = useMemo(() => new Map((folders ?? []).map((f) => [f.id, f])), [folders]);
  const activeFolder = folderId ? folderById.get(folderId) ?? null : null;
  const childFolders = useMemo(() => (folders ?? []).filter((f) => (f.parentId ?? null) === (folderId ?? null)).sort((a, b) => a.name.localeCompare(b.name)), [folders, folderId]);
  const trail = useMemo(() => {
    const out: FolderRow[] = [];
    let cur = activeFolder;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { out.unshift(cur); seen.add(cur.id); cur = cur.parentId ? folderById.get(cur.parentId) ?? null : null; }
    return out;
  }, [activeFolder, folderById]);

  /* ── files ── */
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ view, sort, dir, limit: String(limit) });
    if (folderId) qs.set("folderId", folderId);
    if (q) qs.set("q", q);
    if (type) qs.set("type", type);
    if (uploadedBy) qs.set("uploadedBy", uploadedBy);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [view, sort, dir, limit, folderId, q, type, uploadedBy, from, to, cursor]);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/files?${queryString}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setRows(r.data.data); setTotal(r.data.total); setTotalBytes(r.data.totalBytes); setNextCursor(r.data.nextCursor); setSelected(new Set());
  }, [queryString]);
  // A tick after the effect, so the loader's own setState never runs inside
  // an effect body (the same shape src/components/access/who-has-access.tsx uses).
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const t = setTimeout(() => void loadFolders(), 0); return () => clearTimeout(t); }, [loadFolders]);
  const rv = rowVersion("files");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => { void load(); void loadFolders(); }, 0); return () => clearTimeout(t); }, [rv, load, loadFolders]);
  useEffect(() => {
    const on = () => { void load(); void loadFolders(); };
    window.addEventListener("workwrk:files-changed", on);
    window.addEventListener("workwrk:favs-changed", on);
    window.addEventListener("focus", on);
    return () => { window.removeEventListener("workwrk:files-changed", on); window.removeEventListener("workwrk:favs-changed", on); window.removeEventListener("focus", on); };
  }, [load, loadFolders]);
  const fromN = total === 0 ? 0 : pageIndex * limit + 1;
  const toN = Math.min(total, pageIndex * limit + (rows?.length ?? 0));
  const goNext = nextCursor ? () => { setCursorStack((st) => [...st, cursor ?? ""]); setParams({ cursor: nextCursor }, { keepCursor: true }); } : undefined;
  const goPrev = cursor ? () => { const prev = cursorStack[cursorStack.length - 1] ?? ""; setCursorStack((st) => st.slice(0, -1)); setParams({ cursor: prev || null }, { keepCursor: true }); } : undefined;

  /* ── ?file= resolves the drawer; a bare ?file= link opens the file's own folder ── */
  const previewRow = useMemo(() => (fileParam ? rows?.find((f) => f.id === fileParam) ?? null : null), [fileParam, rows]);
  useEffect(() => {
    if (!fileParam || folderId || rows === null || previewRow) return;
    // The file is not on this page: ask for it and land in its folder.
    let live = true;
    void (async () => {
      const r = await apiFetch<{ data?: FileRow } | FileRow>(`/api/files/${fileParam}`, { cache: "no-store" });
      if (!live || !r.ok) return;
      const row = ("data" in r.data && r.data.data ? r.data.data : r.data) as FileRow;
      if (row.folderId && row.folderId !== folderId && !q && view === "all") setParams({ folder: row.folderId, file: fileParam }, { replace: true });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileParam, rows, previewRow]);

  /* ── upload ── */
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const runJob = useCallback(async (job: UploadJob) => {
    setJobs((prev) => prev.map((j) => (j.key === job.key ? { ...j, status: "uploading", error: undefined } : j)));
    try {
      if (job.file.size > MAX_UPLOAD_BYTES) throw new Error(`Larger than ${formatBytes(MAX_UPLOAD_BYTES)}`);
      const fd = new FormData();
      fd.append("file", job.file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) { const e = await up.json().catch(() => ({})); throw new Error(e?.error || `Upload failed (${up.status})`); }
      const { url, s3Key } = await up.json();
      const r = await apiFetch("/api/files", { method: "POST", json: { name: job.file.name, mimeType: job.file.type || "application/octet-stream", size: job.file.size, url, folderId: folderId ?? null, ...(typeof s3Key === "string" && s3Key ? { s3Key } : {}) } });
      if (!r.ok) throw new Error(r.error || "Couldn't save the file");
      setJobs((prev) => prev.map((j) => (j.key === job.key ? { ...j, status: "done" } : j)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setJobs((prev) => prev.map((j) => (j.key === job.key ? { ...j, status: "failed", error: msg } : j)));
      toast(`${job.name}: ${msg}`, { tone: "danger", action: { label: "Retry", onClick: () => void runJob(job) } });
    }
  }, [folderId, toast]);
  const uploadFiles = useCallback(async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length === 0) return;
    const next: UploadJob[] = files.map((f) => ({ key: `u${Date.now()}${(jobSeq += 1)}`, name: f.name, size: f.size, file: f, status: "queued" }));
    setJobs((prev) => [...prev.filter((j) => j.status !== "done"), ...next]);
    for (const job of next) await runJob(job);
    dispatchFilesChanged();
    void load(); void loadFolders();
  }, [runJob, load, loadFolders]);
  const uploadArmed = useRef(false);
  useEffect(() => {
    if (uploadArmed.current || params.get("upload") !== "1") return;
    uploadArmed.current = true;
    inputRef.current?.click();
    setParams({}, { replace: true, keepCursor: true });
  }, [params, setParams]);
  useEffect(() => {
    if (jobs.length === 0 || jobs.some((j) => j.status !== "done")) return;
    const t = setTimeout(() => setJobs([]), 2500);
    return () => clearTimeout(t);
  }, [jobs]);

  /* ── folders ── */
  async function createFolder() {
    const name = (await prompt({ title: "New folder", description: activeFolder ? `Inside ${activeFolder.name}` : "At the top of Files", placeholder: "Folder name" }))?.trim();
    if (!name) return;
    const r = await apiFetch("/api/files/folders", { method: "POST", json: { name, parentId: folderId ?? null } });
    if (!r.ok) { toast(r.error || "Couldn't create folder", { tone: "danger" }); return; }
    toast("Folder created");
    dispatchFilesChanged();
    void loadFolders();
  }

  /* ── favorites, menu, bulk ── */
  const toggleFav = useCallback(async (f: FileRow) => {
    const next = !f.favorite;
    setRows((prev) => prev?.map((r) => (r.id === f.id ? { ...r, favorite: next } : r)) ?? prev);
    const r = await apiFetch("/api/me/favorites/files", { method: "POST", json: { fileId: f.id, on: next } });
    if (!r.ok) { setRows((prev) => prev?.map((x) => (x.id === f.id ? { ...x, favorite: !next } : x)) ?? prev); toast("Couldn't update favorite", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }, [toast]);
  const menu = useFileRowMenu();
  const toTarget = (f: FileRow): FileMenuTarget => ({ id: f.id, name: f.name, mimeType: f.mimeType, folderId: f.folderId, favorite: f.favorite, summary: f.summary });
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  const [bulkMove, setBulkMove] = useState<FileRow | null>(null);
  async function bulkFavorite() {
    const ids = [...selected];
    await Promise.allSettled(ids.map((id) => apiFetch("/api/me/favorites/files", { method: "POST", json: { fileId: id, on: true } })));
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    toast(`Added ${ids.length} file${ids.length === 1 ? "" : "s"} to favorites`);
    setSelected(new Set()); void load();
  }
  async function bulkSummarize() {
    const ids = selectedRows.filter((f) => isSummarizable(f.mimeType)).map((f) => f.id);
    if (ids.length === 0) { toast("Nothing in the selection can be summarized"); return; }
    toast(`Summarizing ${ids.length} file${ids.length === 1 ? "" : "s"}`);
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/files/${id}/summarize`, { method: "POST" })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `${ids.length - failed} summarized, ${failed} failed` : "Summaries ready", failed ? { tone: "danger" } : undefined);
    setSelected(new Set()); void load();
  }
  async function bulkTrash() {
    const ids = [...selected];
    const ok = await confirm({ title: `Move ${ids.length} file${ids.length === 1 ? "" : "s"} to Trash?`, description: `You can restore them for ${boot.org.trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/files/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : "Moved to Trash", failed ? { tone: "danger" } : { action: { label: "View Trash", onClick: () => router.push("/trash?type=file") } });
    setSelected(new Set()); dispatchFilesChanged(); void load();
  }
  async function bulkMoveTo(target: { folderId?: string | null; spaceFolderId?: string | null; spaceId?: string | null }) {
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/files/${id}`, { method: "PATCH", json: target })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : `Moved ${ids.length} file${ids.length === 1 ? "" : "s"}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set()); dispatchFilesChanged(); void load();
  }

  /* ── keyboard: u upload, shift+N new folder, Delete trash selection, Esc ── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "u") { e.preventDefault(); inputRef.current?.click(); }
      else if (e.key === "N" && e.shiftKey) { e.preventDefault(); void createFolder(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) { e.preventDefault(); void bulkTrash(); }
      else if (e.key === "Escape" && !fileParam && selected.size > 0) setSelected(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fileParam]);

  /* ── filters ── */
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [people, setPeople] = useState<PersonRef[]>([]);
  useEffect(() => {
    if (!filterOpen || people.length > 0) return;
    let live = true;
    void (async () => { const p = await apiFetch<{ data: PersonRef[] }>("/api/users?scope=all&limit=200", { cache: "no-store" }); if (live && p.ok && Array.isArray(p.data?.data)) setPeople(p.data.data); })();
    return () => { live = false; };
  }, [filterOpen, people.length]);

  /* ── rows: folders first (root and folder views), then files ── */
  const items = useMemo<RowItem[] | null>(() => {
    if (rows === null) return null;
    const folderRows: RowItem[] = view === "all" && !q && !activeFilters ? childFolders.map((f) => ({ kind: "folder" as const, folder: f })) : [];
    return [...folderRows, ...rows.map((f) => ({ kind: "file" as const, file: f }))];
  }, [rows, view, q, activeFilters, childFolders]);

  const columns = useMemo<TableColumn<RowItem>[]>(() => {
    const out: TableColumn<RowItem>[] = [{
      key: "name", label: "Name", title: true, sortable: true, width: "minmax(240px,2fr)",
      render: (it) => it.kind === "folder" ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Folder className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{it.folder.name}</span>
          {it.folder._count?.files ? <span className="shrink-0 text-xs font-medium text-ink-2">· {it.folder._count.files}</span> : null}
        </span>
      ) : (() => {
        const Glyph = glyphFor(it.file.mimeType);
        const f = it.file;
        return (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Glyph className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {cols.summary && f.summary ? <span className="shrink-0 text-ink-3" title={f.summary}><Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></span> : null}
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(f); }} aria-label={f.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={f.favorite} title={f.favorite ? "Remove from favorites" : "Star"}
              className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-active", f.favorite ? "text-ink" : "text-ink-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}>
              <Star className="h-4 w-4" strokeWidth={1.5} style={f.favorite ? { fill: "currentColor" } : undefined} aria-hidden />
            </button>
          </span>
        );
      })(),
    }];
    if (cols.type) out.push({ key: "type", label: "Type", sortable: true, width: "110px", render: (it) => <span className="text-sm text-ink-2">{it.kind === "folder" ? "Folder" : fileTypeLabel(it.file.mimeType)}</span> });
    if (cols.size) out.push({ key: "size", label: "Size", sortable: true, numeric: true, width: "100px", render: (it) => it.kind === "file" ? <span className="text-ink-2">{fmt.bytes(it.file.size)}</span> : null });
    if (cols.location) out.push({ key: "location", label: "Location", width: "minmax(140px,1fr)", className: view === "spaces" ? "" : "max-lg:hidden", render: (it) => {
      if (it.kind === "folder") return <span className="text-ink-3">{activeFolder ? activeFolder.name : "Files"}</span>;
      const f = it.file;
      if (f.spaceFolder) return <Link href={`/folders/${f.spaceFolder.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-w-0 items-center gap-1.5 hover:underline"><EntityTile size="xs" name={f.space?.name ?? "Space"} icon={f.space && "icon" in f.space ? (f.space as { icon?: string | null }).icon ?? null : null} color={f.space && "color" in f.space ? (f.space as { color?: string | null }).color ?? null : null} fallback="folder" /><span className="truncate">{f.space?.name ?? "Space"} › {f.spaceFolder.name}</span></Link>;
      if (f.space) return <Link href={`/spaces/${f.space.slug}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-w-0 items-center gap-1.5 hover:underline"><EntityTile size="xs" name={f.space.name} fallback="folder" /><span className="truncate">{f.space.name}</span></Link>;
      return <span className="truncate text-ink-2">{f.folder ? `Files › ${f.folder.name}` : "Files"}</span>;
    } });
    if (cols.uploaded) out.push({ key: "uploaded", label: "Uploaded", sortable: true, width: "120px", render: (it) => <span className="tabular-nums text-ink-2" title={fmt.title(it.kind === "folder" ? it.folder.createdAt : it.file.createdAt)}>{fmt.date(it.kind === "folder" ? it.folder.createdAt : it.file.createdAt)}</span> });
    if (cols.owner) out.push({ key: "owner", label: "Uploaded by", width: "minmax(140px,1fr)", className: "max-lg:hidden", render: (it) => it.kind === "file" && it.file.uploadedBy ? <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={it.file.uploadedBy} size={24} /><span className="truncate">{it.file.uploadedBy.name ?? personName(it.file.uploadedBy)}</span></span> : it.kind === "file" ? <span className="text-ink-3">Nobody</span> : null });
    return out;
  }, [cols, view, activeFolder, fmt, toggleFav]);

  const openPreview = (id: string) => setParams({ file: id }, { keepCursor: true });
  const closePreview = () => setParams({ file: null }, { keepCursor: true, replace: true });

  const filteredEmpty = !!(q || activeFilters);
  const emptyNode = filteredEmpty ? (
    <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, type: null, uploadedBy: null, from: null, to: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
  ) : view === "starred" ? "Files you add to favorites show up here"
    : view === "spaces" ? "Files attached inside Spaces show up here"
    : view === "recent" ? "Nothing added or changed in the last 30 days"
    : activeFolder ? <span className="inline-flex items-center gap-2">This folder is empty · <button type="button" onClick={() => inputRef.current?.click()} className="font-medium text-brand-deep hover:underline">Upload</button></span>
    : null;
  const showQuietEmpty = items !== null && items.length === 0 && view === "all" && !filteredEmpty && !activeFolder;
  const title = activeFolder ? activeFolder.name : "Files";
  const activeJobs = jobs.filter((j) => j.status !== "done");
  const doneJobs = jobs.filter((j) => j.status === "done").length;

  return (
    <>
      <Breadcrumb items={[{ label: "Files", href: trail.length ? "/files" : undefined }, ...trail.map((f, i) => ({ label: f.name, href: i < trail.length - 1 ? `/files?folder=${f.id}` : undefined }))]} />
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); e.target.value = ""; }} />
      <OsPageHeader
        title={title}
        tile={activeFolder ? { name: activeFolder.name, fallback: "folder" } : undefined}
        views={VIEWS.map((v) => <ViewTab key={v.key} icon={v.Icon} label={VIEW_LABEL[v.key]} active={view === v.key} href={v.key === "all" ? (folderId ? `/files?folder=${folderId}` : "/files") : `/files?view=${v.key}`} />)}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORTS.find((s) => s.key === sort)?.label, active: true },
          switcher: { value: viewType, options: [{ key: "list", label: "List", icon: Rows3 }, { key: "grid", label: "Grid", icon: LayoutGrid }], onChange: (k) => void patchPrefs({ home: { files: { viewType: k as "grid" | "list" } } }) },
          left: (
            <div className="relative">
              <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort files" selected={sort} width={240}
                onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label, hint: s.key === sort ? (dir === "asc" ? "Ascending" : "Descending") : undefined })) }]} />
            </div>
          ),
          right: (
            <>
              <SearchField value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search files" />
              <span className="relative">
                <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Display" multi align="end" width={240} selected={FILES_COLUMNS.filter((k) => cols[k])} onSelect={(k) => void patchPrefs({ home: { files: { columns: { ...cols, [k]: !cols[k as FilesColumnKey] } } } })}
                  sections={[{ label: "Columns shown", options: FILES_COLUMNS.filter((k) => k !== "summary").map((k) => ({ value: k, label: COLUMN_LABEL[k] })) }, { label: "Rows", options: [{ value: "summary", label: COLUMN_LABEL.summary }] }]} />
              </span>
              <SplitPrimary label="Upload" icon={Upload} onClick={() => inputRef.current?.click()}>
                <MenuItem icon={Upload} label="Upload files" onClick={() => inputRef.current?.click()} />
                <MenuItem icon={FolderPlus} label="New folder" onClick={() => void createFolder()} />
              </SplitPrimary>
            </>
          ),
          menu: [
            { label: "Display", icon: SlidersHorizontal, onClick: () => setDisplayOpen(true) },
            { label: "Trash", icon: Trash2, href: "/trash?type=file" },
          ],
        }}
      />

      <div
        className="os-chrome relative flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2"
        onDragEnter={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); dragDepth.current += 1; setDragOver(true); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragOver(false); if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files); }}
      >
        {dragOver ? (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-brand bg-[color-mix(in_srgb,var(--os-brand)_6%,transparent)] text-base font-medium text-brand-deep">
            Drop to upload into {activeFolder?.name ?? "Files"}
          </div>
        ) : null}

        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="files" activeCount={activeFilters} onClearAll={() => setParams({ type: null, uploadedBy: null, from: null, to: null })}>
          <FilterGroup label="Type">
            {FILE_TYPE_BUCKETS.map((t) => <FilterRow key={t.key} label={t.label} checked={type === t.key} onCheckedChange={(on) => setParams({ type: on ? t.key : null })} />)}
          </FilterGroup>
          <FilterGroup label="Uploaded by">
            <FilterRow label="Filter by person" checked={!!uploadedBy} onCheckedChange={(on) => { if (!on) setParams({ uploadedBy: null }); else setUploaderOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setUploaderOpen((o) => !o)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
                  {uploadedBy && people.find((p) => p.id === uploadedBy) ? personName(people.find((p) => p.id === uploadedBy)) : <span className="text-ink-3">Choose a person</span>}
                </button>
                <Picker open={uploaderOpen} onClose={() => setUploaderOpen(false)} ariaLabel="Uploaded by" searchPlaceholder="Find a person" selected={uploadedBy} onSelect={(v) => { setParams({ uploadedBy: v }); setUploaderOpen(false); }} sections={[{ options: people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Uploaded">
            <FilterRow label="Date range" checked={!!(from || to)} onCheckedChange={(on) => { if (!on) setParams({ from: null, to: null }); else setParams({ from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) }); }}>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={(from ?? "").slice(0, 10)} onChange={(e) => setParams({ from: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={(to ?? "").slice(0, 10)} onChange={(e) => setParams({ to: e.target.value ? `${e.target.value}T23:59:59` : null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
              </div>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {activeJobs.length > 0 || doneJobs > 0 ? (
            <div className="flex flex-col rounded-lg border border-line bg-raised" role="status">
              <div className="flex h-11 items-center gap-3 px-4 text-base text-ink">
                <Upload className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {activeJobs.length > 0 ? `Uploading ${doneJobs + 1} of ${jobs.length} · ${activeJobs[0]?.name ?? ""}` : `Uploaded ${doneJobs} file${doneJobs === 1 ? "" : "s"}`}
                </span>
                {activeJobs.some((j) => j.status === "failed") ? <button type="button" onClick={() => { for (const j of activeJobs) if (j.status === "failed") void runJob(j); }} className="text-sm font-medium text-brand-deep hover:underline">Retry failed</button> : null}
                <button type="button" onClick={() => setJobs((prev) => prev.filter((j) => j.status === "uploading"))} aria-label="Dismiss" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
              </div>
              <div className="h-1 w-full bg-active"><div className="h-1 bg-brand transition-[width]" style={{ width: `${jobs.length ? Math.round((doneJobs / jobs.length) * 100) : 0}%` }} /></div>
              {activeJobs.filter((j) => j.status === "failed").map((j) => (
                <div key={j.key} className="flex h-9 items-center gap-3 border-t border-line-soft px-4 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{j.name}</span>
                  <span className="text-danger-text">Failed · {j.error}</span>
                  <button type="button" onClick={() => void runJob(j)} className="font-medium text-brand-deep hover:underline">Retry</button>
                  <button type="button" onClick={() => setJobs((prev) => prev.filter((x) => x.key !== j.key))} className="text-ink-2 hover:text-ink">Dismiss</button>
                </div>
              ))}
            </div>
          ) : null}

          {loadError || foldersError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load files" action={{ label: "Retry", onClick: () => { void load(); void loadFolders(); } }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No files yet" hint={`Drag files here, or upload up to ${formatBytes(MAX_UPLOAD_BYTES)} each.`} action={{ label: "Upload a file", onClick: () => inputRef.current?.click() }} />
          ) : viewType === "grid" ? (
            <GridView items={items} highlight={fileParam} onOpenFolder={(id) => setParams({ folder: id })} onOpenFile={openPreview} onFav={toggleFav} menu={menu} toTarget={toTarget} emptyNode={emptyNode} showSummary={cols.summary} fmt={fmt} total={total} totalBytes={totalBytes} from={fromN} to={toN} onPrev={goPrev} onNext={goNext} />
          ) : (
            <TableCard<RowItem>
              ariaLabel={title}
              columns={columns}
              rows={items}
              rowKey={(it) => (it.kind === "folder" ? `folder:${it.folder.id}` : it.file.id)}
              rowHref={(it) => (it.kind === "folder" ? `/files?folder=${it.folder.id}` : null)}
              onRowClick={(it, e) => { if (it.kind === "file") { e.preventDefault(); openPreview(it.file.id); } }}
              selectable selected={selected}
              onSelectedChange={(s) => setSelected(new Set([...s].filter((k) => !k.startsWith("folder:"))))}
              sort={{ key: sort, dir }}
              onSort={(key) => setParams(key === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: key, dir: null })}
              highlightKey={fileParam}
              onRowContextMenu={(it, e) => (it.kind === "folder" ? menu.openFolderAt(e, it.folder) : menu.openFileAt(e, toTarget(it.file)))}
              rowMenu={(it) => <RowMenuTrigger onOpen={(ref) => (it.kind === "folder" ? menu.openFolderFrom(ref, it.folder) : menu.openFileFrom(ref, toTarget(it.file)))} open={menu.state?.kind === "file" ? menu.state.file.id === (it.kind === "file" ? it.file.id : "") : menu.state?.kind === "folder" ? menu.state.folder.id === (it.kind === "folder" ? it.folder.id : "") : false} label={it.kind === "folder" ? "Folder actions" : "File actions"} />}
              empty={emptyNode}
              footer={{ total, noun: "files", from: fromN, to: toN, onPrev: goPrev, onNext: goNext, pageSize: limit, pageSizes: PAGE_SIZES, onPageSize: (n) => setParams({ limit: n === PAGE_SIZES[0] ? null : String(n) }), extra: totalBytes > 0 ? `· ${fmt.bytes(totalBytes)}` : undefined }}
              bulkActions={
                <>
                  <BulkAction icon={FolderInput} label="Move to…" onClick={() => { const first = selectedRows[0]; if (first) setBulkMove(first); }} />
                  <BulkAction icon={Star} label="Add to favorites" onClick={() => void bulkFavorite()} />
                  {aiOn ? <BulkAction icon={Sparkles} label="Summarize" onClick={() => void bulkSummarize()} /> : null}
                  <BulkAction icon={Trash2} label="Move to Trash" destructive onClick={() => void bulkTrash()} />
                </>
              }
            />
          )}
        </div>
      </div>

      <FileRowMenuHost menu={menu} onChanged={() => { void load(); void loadFolders(); }} onPreview={(f) => openPreview(f.id)} />
      {fileParam ? <FilePreviewDrawer key={fileParam} fileId={fileParam} initial={previewRow} onClose={closePreview} onChanged={() => void load()} /> : null}
      {bulkMove ? (
        <BulkMoveDialog file={bulkMove} count={selected.size} onClose={() => setBulkMove(null)} onMove={(t) => { setBulkMove(null); void bulkMoveTo(t); }} />
      ) : null}
    </>
  );
}

/* ───────────────────────────── grid view ───────────────────────────── */

function GridView({ items, highlight, onOpenFolder, onOpenFile, onFav, menu, toTarget, emptyNode, showSummary, fmt, total, totalBytes, from, to, onPrev, onNext }: {
  items: RowItem[] | null;
  highlight: string | null;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onFav: (f: FileRow) => void;
  menu: ReturnType<typeof useFileRowMenu>;
  toTarget: (f: FileRow) => FileMenuTarget;
  emptyNode: React.ReactNode;
  showSummary: boolean;
  fmt: ReturnType<typeof useFormat>;
  total: number; totalBytes: number; from: number; to: number; onPrev?: () => void; onNext?: () => void;
}) {
  if (items === null) {
    return <div className="grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]" aria-busy="true" aria-label="Loading">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-48 rounded-lg bg-skeleton os-skeleton-pulse" />)}</div>;
  }
  if (items.length === 0) return <div className="flex h-11 items-center text-row text-ink-2">{emptyNode ?? "Nothing here yet"}</div>;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {items.map((it) => {
          if (it.kind === "folder") {
            return (
              <button key={`folder:${it.folder.id}`} type="button" onClick={() => onOpenFolder(it.folder.id)} onContextMenu={(e) => menu.openFolderAt(e, it.folder)} className="os-row group/tile flex flex-col rounded-lg border border-line bg-raised p-4 text-start hover:bg-hover">
                <span className="flex aspect-[16/10] w-full items-center justify-center rounded-md bg-subtle"><Folder className="h-10 w-10 text-ink-2" strokeWidth={1.5} aria-hidden /></span>
                <span className="mt-3 line-clamp-2 text-base font-medium text-ink">{it.folder.name}</span>
                <span className="mt-1 text-xs text-ink-2">{it.folder._count?.files ?? 0} file{it.folder._count?.files === 1 ? "" : "s"}</span>
              </button>
            );
          }
          const f = it.file;
          const Glyph = glyphFor(f.mimeType);
          const isImg = fileTypeBucket(f.mimeType) === "images";
          return (
            <div key={f.id} className={cn("group/tile relative", highlight === f.id ? "[&>button]:ring-2 [&>button]:ring-brand" : "")}>
              <button type="button" onClick={() => onOpenFile(f.id)} onContextMenu={(e) => menu.openFileAt(e, toTarget(f))} className="os-row flex w-full flex-col rounded-lg border border-line bg-raised p-4 text-start hover:bg-hover">
                <span className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-md bg-subtle">
                  {isImg ? <img src={f.url} alt={f.name} className="h-full w-full object-cover" /> : <Glyph className="h-10 w-10 text-ink-2" strokeWidth={1.5} aria-hidden />}
                </span>
                <span className="mt-3 line-clamp-2 text-base font-medium text-ink">{f.name}</span>
                <span className="mt-1 text-xs text-ink-2">{fmt.bytes(f.size)} · <span title={fmt.title(f.createdAt)}>{fmt.date(f.createdAt)}</span></span>
                {showSummary && f.summary ? <span className="mt-1 line-clamp-2 text-xs text-ink-2">{f.summary}</span> : null}
              </button>
              <span className="absolute end-2 top-2 flex items-center gap-0.5 rounded-md bg-raised opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(pointer:coarse)]:opacity-100">
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(f); }} aria-label={f.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={f.favorite} className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-active", f.favorite ? "text-ink" : "text-ink-2")}>
                  <Star className="h-4 w-4" strokeWidth={1.5} style={f.favorite ? { fill: "currentColor" } : undefined} aria-hidden />
                </button>
                <RowMenuTrigger onOpen={(ref) => menu.openFileFrom(ref, toTarget(f))} open={menu.state?.kind === "file" && menu.state.file.id === f.id} label="File actions" />
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex h-11 items-center gap-3 rounded-lg border border-line bg-raised px-4 text-sm">
        <span className="font-medium text-ink">Total files <span className="tabular-nums">{fmt.count(total)}</span></span>
        {totalBytes > 0 ? <span className="text-ink-2">· {fmt.bytes(totalBytes)}</span> : null}
        <span className="flex-1" />
        <span className="tabular-nums text-ink-2">{from} to {to}</span>
        <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40">‹</button>
        <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40">›</button>
      </div>
    </>
  );
}

/** The bulk Move to… reuses MoveFileDialog for the destination and applies it to the selection. */
function BulkMoveDialog({ file, count, onClose, onMove }: { file: FileRow; count: number; onClose: () => void; onMove: (t: { folderId?: string | null; spaceFolderId?: string | null; spaceId?: string | null }) => void }) {
  // MoveFileDialog moves one file itself; for the selection the first file's
  // move is observed and the same destination is replayed on the rest.
  const [applied, setApplied] = useState(false);
  return (
    <MoveFileDialog
      fileId={file.id}
      fileName={count > 1 ? `${count} files` : file.name}
      currentFolderId={file.folderId}
      onClose={onClose}
      onMoved={() => {
        if (applied) return;
        setApplied(true);
        void (async () => {
          const r = await apiFetch<{ data?: FileRow } | FileRow>(`/api/files/${file.id}`, { cache: "no-store" });
          if (!r.ok) return;
          const row = ("data" in r.data && r.data.data ? r.data.data : r.data) as FileRow;
          onMove(row.spaceFolderId ? { spaceFolderId: row.spaceFolderId, folderId: null } : row.spaceId ? { spaceId: row.spaceId, spaceFolderId: null, folderId: null } : { folderId: row.folderId ?? null, spaceId: null, spaceFolderId: null });
        })();
      }}
    />
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  // Adopt a new URL value during render (the Picker pattern), never in an effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
      <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 w-[200px] max-md:w-36 rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
    </label>
  );
}

function RowMenuTrigger({ onOpen, open, label }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label={label} />;
}
