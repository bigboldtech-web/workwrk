"use client";

/* Files — generic drive primitive.
 *
 * Two-pane Notion/Drive-style layout:
 *   Left  rail: folder tree (root + nested) + "Starred" virtual folder.
 *   Right pane: file grid for the active folder, with drag-and-drop
 *               upload zone, search, breadcrumbs, and per-file actions
 *               (star / rename / move / delete / open in new tab).
 *
 * Upload flow:
 *   1. User drops files (or picks via input) into the active folder.
 *   2. We POST each to /api/upload (multipart) → get back url + size.
 *   3. We POST that to /api/files with the active folderId to persist
 *      the FileEntry. UI optimistically shows the row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HardDrive, Folder, FolderPlus, Upload, Search, Star, Trash2,
  ExternalLink, Image as ImageIcon, FileText, File as FileIcon,
  Film, Music, Archive, Code2, ChevronRight,
} from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiFolder = {
  id: string; name: string; parentId: string | null;
  createdAt: string; updatedAt: string;
  _count?: { files?: number; children?: number };
};
type ApiFile = {
  id: string; name: string; mimeType: string; size: number;
  url: string; folderId: string | null;
  starred: boolean; description?: string | null;
  createdAt: string; updatedAt: string;
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function fileIcon(mime: string): React.ComponentType<{ className?: string }> {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Film;
  if (mime.startsWith("audio/")) return Music;
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("document")) return FileText;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed")) return Archive;
  if (mime.includes("json") || mime.includes("javascript") || mime.includes("typescript")) return Code2;
  return FileIcon;
}
function fileHue(mime: string): string {
  if (mime.startsWith("image/")) return "var(--os-c-purple)";
  if (mime.startsWith("video/")) return "var(--os-c-pink)";
  if (mime.startsWith("audio/")) return "var(--os-c-orange)";
  if (mime.includes("pdf")) return "var(--os-c-red)";
  if (mime.startsWith("text/") || mime.includes("document")) return "var(--os-c-blue)";
  if (mime.includes("zip") || mime.includes("compressed")) return "var(--os-c-brown)";
  return "var(--os-c-darkgray)";
}

type View = { kind: "folder"; id: string | null } | { kind: "starred" } | { kind: "search"; q: string };

export default function FilesPage() {
  const [folders, setFolders] = useState<ApiFolder[] | null>(null);
  const [files, setFiles] = useState<ApiFile[] | null>(null);
  const [view, setView] = useState<View>({ kind: "folder", id: null });
  const [searchInput, setSearchInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/files/folders");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFolders(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      let url = "/api/files";
      if (view.kind === "folder") url += `?folderId=${view.id ?? "root"}`;
      else if (view.kind === "starred") url += "?starred=true";
      else url += `?q=${encodeURIComponent(view.q)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFiles(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [view]);

  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => { void loadFiles(); }, [loadFiles]);
  const v = rowVersion("files");
  useEffect(() => { if (v > 0) { void loadFolders(); void loadFiles(); } }, [v, loadFolders, loadFiles]);

  // Build a nested tree from the flat folder list.
  type Node = ApiFolder & { children: Node[] };
  const tree = useMemo<Node[]>(() => {
    const byId = new Map<string, Node>();
    for (const f of folders ?? []) byId.set(f.id, { ...f, children: [] });
    const roots: Node[] = [];
    for (const f of folders ?? []) {
      const n = byId.get(f.id)!;
      if (f.parentId && byId.has(f.parentId)) byId.get(f.parentId)!.children.push(n);
      else roots.push(n);
    }
    function sortRec(n: Node) { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); }
    roots.sort((a, b) => a.name.localeCompare(b.name));
    roots.forEach(sortRec);
    return roots;
  }, [folders]);

  const activeFolder = view.kind === "folder" && view.id ? (folders ?? []).find((f) => f.id === view.id) ?? null : null;

  // breadcrumbs from active folder
  const breadcrumbs = useMemo(() => {
    if (view.kind !== "folder" || !view.id) return [];
    const map = new Map((folders ?? []).map((f) => [f.id, f]));
    const trail: ApiFolder[] = [];
    let cur = map.get(view.id);
    while (cur) {
      trail.unshift(cur);
      cur = cur.parentId ? map.get(cur.parentId) : undefined;
    }
    return trail;
  }, [view, folders]);

  async function createFolder() {
    const name = window.prompt("Folder name?")?.trim();
    if (!name) return;
    const parentId = view.kind === "folder" ? view.id : null;
    try {
      const res = await fetch("/api/files/folders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void loadFolders();
    } catch { toast("Couldn't create folder"); }
  }

  async function uploadFiles(list: FileList) {
    if (!list.length) return;
    const folderId = view.kind === "folder" ? view.id : null;
    setUploading(list.length);
    let done = 0;
    for (const f of Array.from(list)) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) { done += 1; setUploading(list.length - done); continue; }
        const { url } = await up.json();
        await fetch("/api/files", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: f.name, mimeType: f.type || "application/octet-stream", size: f.size, url, folderId }),
        });
      } catch { /* skip */ }
      done += 1;
      setUploading(list.length - done);
    }
    void loadFiles(); void loadFolders();
    toast(`Uploaded ${list.length} file${list.length === 1 ? "" : "s"}`);
  }

  async function toggleStar(id: string, starred: boolean) {
    setFiles((prev) => prev?.map((f) => f.id === id ? { ...f, starred } : f) ?? prev);
    try {
      await fetch(`/api/files/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred }),
      });
    } catch { void loadFiles(); }
  }
  async function rename(file: ApiFile) {
    const name = window.prompt("New name?", file.name)?.trim();
    if (!name || name === file.name) return;
    setFiles((prev) => prev?.map((f) => f.id === file.id ? { ...f, name } : f) ?? prev);
    try {
      await fetch(`/api/files/${file.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch { toast("Couldn't rename"); void loadFiles(); }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this file? This cannot be undone.")) return;
    setFiles((prev) => prev?.filter((f) => f.id !== id) ?? prev);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch { toast("Couldn't delete"); void loadFiles(); }
  }

  function submitSearch() {
    const q = searchInput.trim();
    if (q) setView({ kind: "search", q });
    else setView({ kind: "folder", id: null });
  }

  function renderTree(nodes: Node[], depth: number): React.ReactNode {
    return nodes.map((n) => {
      const isActive = view.kind === "folder" && view.id === n.id;
      return (
        <div key={n.id}>
          <button
            type="button"
            className={`files-tree__row ${isActive ? "is-active" : ""}`}
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => { setView({ kind: "folder", id: n.id }); setSearchInput(""); }}
          >
            <Folder /> <span>{n.name}</span>
            <em>{n._count?.files ?? 0}</em>
          </button>
          {n.children.length > 0 && renderTree(n.children, depth + 1)}
        </div>
      );
    });
  }

  const headerTitle = view.kind === "starred" ? "Starred" : view.kind === "search" ? `Search · "${view.q}"` : activeFolder?.name ?? "All files";

  return (
    <div className="filesp">
      <header className="filesp__head">
        <div className="filesp__head-l">
          <div className="filesp__icon"><HardDrive /></div>
          <div>
            <h1 className="filesp__title">Files</h1>
            <div className="filesp__sub">
              {folders === null ? "Loading…" : `${(folders ?? []).length} folder${(folders ?? []).length === 1 ? "" : "s"} · upload, organise, and embed anywhere`}
            </div>
          </div>
        </div>
        <div className="filesp__actions">
          <form className="filesp__search" onSubmit={(e) => { e.preventDefault(); submitSearch(); }}>
            <Search />
            <input
              type="text"
              placeholder="Search all files…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </form>
          <button type="button" className="filesp__btn" onClick={createFolder}><FolderPlus /> Folder</button>
          <button type="button" className="filesp__btn filesp__btn--primary" onClick={() => inputRef.current?.click()}>
            <Upload /> Upload
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        </div>
      </header>

      {loadError && <div className="filesp__error">{loadError}</div>}

      <div className="filesp__grid">
        <aside className="filesp__rail">
          <button type="button" className={`files-tree__row ${view.kind === "folder" && view.id === null ? "is-active" : ""}`} onClick={() => setView({ kind: "folder", id: null })}>
            <HardDrive /> <span>All files</span>
          </button>
          <button type="button" className={`files-tree__row ${view.kind === "starred" ? "is-active" : ""}`} onClick={() => setView({ kind: "starred" })}>
            <Star /> <span>Starred</span>
          </button>
          <div className="files-tree__sep">Folders</div>
          {folders === null ? (
            <div style={{ padding: 16, color: "var(--os-ink-3)", fontSize: 12 }}>Loading…</div>
          ) : tree.length === 0 ? (
            <div className="files-tree__empty">No folders yet. Create one to organise files.</div>
          ) : renderTree(tree, 0)}
        </aside>

        <section
          className={`filesp__pane ${dragOver ? "is-drop" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files); }}
        >
          <header className="filesp__pane-head">
            <div className="filesp__crumbs">
              <button type="button" onClick={() => setView({ kind: "folder", id: null })}>All files</button>
              {breadcrumbs.map((b) => (
                <span key={b.id}>
                  <ChevronRight />
                  <button type="button" onClick={() => setView({ kind: "folder", id: b.id })}>{b.name}</button>
                </span>
              ))}
              {(view.kind === "starred" || view.kind === "search") && (
                <span><ChevronRight /><strong>{headerTitle}</strong></span>
              )}
            </div>
            {uploading > 0 && <span className="filesp__uploading">Uploading {uploading}…</span>}
          </header>

          {dragOver && (
            <div className="filesp__drop-overlay">
              <Upload />
              <span>Drop to upload to {activeFolder?.name ?? "All files"}</span>
            </div>
          )}

          {files === null ? (
            <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : files.length === 0 ? (
            <div className="filesp__empty">
              <Upload />
              <div>
                <h3>Nothing here yet</h3>
                <p>Drag files here, or click Upload. Files live in folders you create — and can be embedded into any doc / page later.</p>
              </div>
            </div>
          ) : (
            <div className="filesp__items">
              {files.map((f) => {
                const Icon = fileIcon(f.mimeType);
                const isImg = f.mimeType.startsWith("image/");
                return (
                  <article key={f.id} className="ftile">
                    <a href={f.url} target="_blank" rel="noopener" className="ftile__preview" style={{ background: fileHue(f.mimeType) }}>
                      {isImg ? <img src={f.url} alt={f.name} /> : <Icon />}
                    </a>
                    <div className="ftile__body">
                      <div className="ftile__name" title={f.name}>{f.name}</div>
                      <div className="ftile__meta">
                        <span>{fmtSize(f.size)}</span>
                        <span>· {new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                    </div>
                    <div className="ftile__actions">
                      <button type="button" className={`ftile__act ${f.starred ? "is-on" : ""}`} title={f.starred ? "Unstar" : "Star"} onClick={() => toggleStar(f.id, !f.starred)}>
                        <Star />
                      </button>
                      <a href={f.url} target="_blank" rel="noopener" className="ftile__act" title="Open"><ExternalLink /></a>
                      <button type="button" className="ftile__act" title="Rename" onClick={() => rename(f)}>✎</button>
                      <button type="button" className="ftile__act ftile__act--danger" title="Delete" onClick={() => remove(f.id)}>
                        <Trash2 />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
