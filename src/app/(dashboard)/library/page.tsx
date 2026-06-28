"use client";

// /library — unified destination for Notes, Whiteboards, and Files.
//
// Replaces the standalone /whiteboards entry as a sidebar destination.
// Notes live in Doc table; Whiteboards in Whiteboard table; Files is
// a placeholder until the upload surface lands.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Library as LibraryIcon, FileText, Frame, Folder, Plus, Search, Loader2, Clock,
  Upload, Star, Trash2, Download, ImageIcon, FileVideo, FileAudio, FileType,
  Database,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { DocFavoriteButton } from "@/components/docs/doc-favorite-button";
import { TableFavoriteButton } from "@/components/board-view/table-favorite-button";
import { WhiteboardFavoriteButton } from "@/components/board-view/whiteboard-favorite-button";
import { FileFavoriteButton } from "@/components/board-view/file-favorite-button";

type Tab = "notes" | "whiteboards" | "files" | "tables";

interface ApiDoc {
  id: string;
  title: string;
  excerpt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiWhiteboard {
  id: string;
  name: string;
  description?: string | null;
  thumbnail?: string | null;
  productSlug?: string | null;
  lastEditedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function LibraryPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const initialTab: Tab =
    tabParam === "whiteboards" ? "whiteboards"
    : tabParam === "files" ? "files"
    : tabParam === "tables" ? "tables"
    : "notes";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [spaces, setSpaces] = useState<SpaceChip[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/spaces")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const list: SpaceChip[] = Array.isArray(data?.spaces)
          ? data.spaces.map((s: { id: string; name: string; color: string | null; icon: string | null }) => ({
              id: s.id, name: s.name, color: s.color, icon: s.icon,
            }))
          : [];
        setSpaces(list);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <>
      <OsTitleBar
        title="Library"
        Icon={LibraryIcon}
        iconGradient={GRAD.tealGreen}
        description="Notes, whiteboards, and files — connectable everywhere"
        people={[PEOPLE.bb, PEOPLE.sc]}
        morePeople={6}
      />

      <div className="px-6 pt-2 pb-3 border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <TabPill active={tab === "notes"} onClick={() => setTab("notes")} icon={<FileText className="h-3.5 w-3.5" />}>
            Notes
          </TabPill>
          <TabPill active={tab === "whiteboards"} onClick={() => setTab("whiteboards")} icon={<Frame className="h-3.5 w-3.5" />}>
            Whiteboards
          </TabPill>
          <TabPill active={tab === "files"} onClick={() => setTab("files")} icon={<Folder className="h-3.5 w-3.5" />}>
            Files
          </TabPill>
          <TabPill active={tab === "tables"} onClick={() => setTab("tables")} icon={<Database className="h-3.5 w-3.5" />}>
            Tables
          </TabPill>

          <div className="ml-auto relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${tab}…`}
              className="w-full h-8 pl-8 pr-2 rounded-md border border-zinc-200 bg-white text-[12.5px] focus:outline-none focus:border-zinc-400"
            />
          </div>
        </div>
      </div>

      <div className="p-6">
        {tab === "notes" ? <NotesTab query={query} spaces={spaces} /> : null}
        {tab === "whiteboards" ? <WhiteboardsTab query={query} spaces={spaces} /> : null}
        {tab === "files" ? <FilesTab query={query} spaces={spaces} /> : null}
        {tab === "tables" ? <TablesTab query={query} spaces={spaces} /> : null}
      </div>
    </>
  );
}

function TabPill({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:bg-zinc-100"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Notes tab
// ────────────────────────────────────────────────────────────────────

function NotesTab({ query, spaces }: { query: string; spaces: SpaceChip[] }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [rows, setRows] = useState<ApiDoc[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | "all" | "unscoped">("all");

  const load = useCallback(() => {
    let url = "/api/docs";
    if (activeSpaceId === "unscoped") url += "?standaloneOnly=1";
    else if (activeSpaceId !== "all") url += `?entityType=SPACE&entityId=${activeSpaceId}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setRows(data.docs ?? []);
      })
      .catch(() => setRows([]));
  }, [activeSpaceId]);
  useEffect(() => { load(); }, [load]);

  const newNote = async () => {
    setCreating(true);
    try {
      const body: Record<string, unknown> = { title: "New doc" };
      // Notes created from a specific Space chip get tagged to that
      // Space so the chip count stays consistent on next refresh.
      if (activeSpaceId !== "all" && activeSpaceId !== "unscoped") {
        body.entityType = "SPACE";
        body.entityId = activeSpaceId;
      }
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const id = data?.doc?.id;
      if (id) router.push(`/docs/${id}`);
      else throw new Error();
    } catch {
      toast("Couldn't create note");
    } finally {
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) =>
      d.title.toLowerCase().includes(q) || (d.excerpt ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div>
      {spaces.length > 0 ? (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <FileSpaceChip label="All" active={activeSpaceId === "all"} onClick={() => setActiveSpaceId("all")} />
          <FileSpaceChip label="Unscoped" active={activeSpaceId === "unscoped"} onClick={() => setActiveSpaceId("unscoped")} />
          {spaces.map((s) => (
            <FileSpaceChip key={s.id} label={s.name} color={s.color} active={activeSpaceId === s.id} onClick={() => setActiveSpaceId(s.id)} />
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-4">
        <div className="text-[12.5px] text-zinc-500">
          {rows === null ? "Loading…" : `${filtered.length} note${filtered.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={newNote}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium hover:bg-zinc-800 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          New note
        </button>
      </div>

      {rows === null ? (
        <div className="text-zinc-400 text-[13px]">Loading notes…</div>
      ) : filtered.length === 0 ? (
        <EmptyTab
          icon={<FileText className="h-8 w-8 text-zinc-300" />}
          title={query ? `No notes match "${query}"` : "No notes yet"}
          subtitle="Notes can stand alone or be embedded inside any task, board, KRA, or SOP."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((d) => (
            <div key={d.id} className="relative group/note">
              <button
                type="button"
                onClick={() => router.push(`/docs/${d.id}`)}
                className="w-full text-left rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-2 mb-2 pr-7">
                  <FileText className="h-3.5 w-3.5 text-zinc-400" />
                  {d.entityType ? (
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100">
                      {d.entityType.toLowerCase()}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-zinc-400">Standalone</span>
                  )}
                </div>
                <div className="text-[13px] font-medium text-zinc-900 line-clamp-1">{d.title || "Untitled"}</div>
                {d.excerpt ? (
                  <div className="mt-1 text-[12px] text-zinc-500 line-clamp-2">{d.excerpt}</div>
                ) : null}
                <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
                  <Clock className="h-3 w-3" />
                  {relTime(d.updatedAt)}
                </div>
              </button>
              <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/note:opacity-100 transition-opacity">
                <DocFavoriteButton docId={d.id} initiallyStarred={false} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Whiteboards tab
// ────────────────────────────────────────────────────────────────────

function WhiteboardsTab({ query, spaces }: { query: string; spaces: SpaceChip[] }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();
  const [rows, setRows] = useState<ApiWhiteboard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | "all" | "unscoped">("all");

  const load = useCallback(() => {
    let url = "/api/whiteboards";
    if (activeSpaceId === "unscoped") url += "?spaceId=unscoped";
    else if (activeSpaceId !== "all") url += `?spaceId=${activeSpaceId}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setRows(data.whiteboards ?? []);
      })
      .catch(() => setRows([]));
  }, [activeSpaceId]);
  useEffect(() => { load(); }, [load]);

  const newBoard = async () => {
    const name = (await promptDialog({ title: "Whiteboard name?", defaultValue: "Untitled whiteboard" }))?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name };
      // Whiteboards created from a specific Space chip get tagged so
      // the chip count stays consistent on next refresh.
      if (activeSpaceId !== "all" && activeSpaceId !== "unscoped") {
        body.spaceId = activeSpaceId;
      }
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const id = data?.whiteboard?.id;
      if (id) router.push(`/whiteboards/${id}`);
      else throw new Error();
    } catch {
      toast("Couldn't create whiteboard");
    } finally {
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((b) =>
      b.name.toLowerCase().includes(q) || (b.description ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div>
      {spaces.length > 0 ? (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <FileSpaceChip label="All" active={activeSpaceId === "all"} onClick={() => setActiveSpaceId("all")} />
          <FileSpaceChip label="Unscoped" active={activeSpaceId === "unscoped"} onClick={() => setActiveSpaceId("unscoped")} />
          {spaces.map((s) => (
            <FileSpaceChip key={s.id} label={s.name} color={s.color} active={activeSpaceId === s.id} onClick={() => setActiveSpaceId(s.id)} />
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-4">
        <div className="text-[12.5px] text-zinc-500">
          {rows === null ? "Loading…" : `${filtered.length} whiteboard${filtered.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={newBoard}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium hover:bg-zinc-800 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          New whiteboard
        </button>
      </div>

      {rows === null ? (
        <div className="text-zinc-400 text-[13px]">Loading whiteboards…</div>
      ) : filtered.length === 0 ? (
        <EmptyTab
          icon={<Frame className="h-8 w-8 text-zinc-300" />}
          title={query ? `No whiteboards match "${query}"` : "No whiteboards yet"}
          subtitle="Sketch flows, map architectures, brainstorm anything. Drop them into tasks, KRAs, or SOPs."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((b) => (
            <div key={b.id} className="relative group/wb">
            <button
              type="button"
              onClick={() => router.push(`/whiteboards/${b.id}`)}
              className="w-full text-left rounded-lg border border-zinc-200 bg-white overflow-hidden hover:border-zinc-300 hover:shadow-sm transition"
            >
              <div className="aspect-video bg-zinc-50 border-b border-zinc-100 relative overflow-hidden">
                {b.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Frame className="h-8 w-8 text-zinc-200" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="text-[13px] font-medium text-zinc-900 line-clamp-1">{b.name}</div>
                {b.description ? (
                  <div className="mt-1 text-[12px] text-zinc-500 line-clamp-1">{b.description}</div>
                ) : null}
                <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
                  <Clock className="h-3 w-3" />
                  {relTime(b.lastEditedAt ?? b.updatedAt)}
                </div>
              </div>
            </button>
            <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/wb:opacity-100 transition-opacity">
              <WhiteboardFavoriteButton whiteboardId={b.id} />
            </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Files tab — placeholder
// ────────────────────────────────────────────────────────────────────

interface ApiFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  starred: boolean;
  description?: string | null;
  uploadedById: string;
  spaceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SpaceChip {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function MimeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon className={className} />;
  if (mimeType.startsWith("video/")) return <FileVideo className={className} />;
  if (mimeType.startsWith("audio/")) return <FileAudio className={className} />;
  if (mimeType === "application/pdf" || mimeType.includes("document")) return <FileType className={className} />;
  return <FileText className={className} />;
}

function FilesTab({ query, spaces }: { query: string; spaces: SpaceChip[] }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ApiFile[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | "all" | "unscoped">("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const url =
      activeSpaceId === "all" || activeSpaceId === "unscoped"
        ? "/api/files"
        : `/api/files?spaceId=${activeSpaceId}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list: ApiFile[] = Array.isArray(data) ? data : (data?.data ?? []);
        setRows(list);
      })
      .catch(() => setRows([]));
  }, [activeSpaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) {
        const err = await upRes.json().catch(() => ({}));
        toast(err?.error ?? "Upload failed");
        return;
      }
      const upData = await upRes.json();
      const entryRes = await fetch("/api/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: upData.name ?? file.name,
          mimeType: file.type || "application/octet-stream",
          size: upData.size ?? file.size,
          url: upData.url,
        }),
      });
      if (!entryRes.ok) {
        const err = await entryRes.json().catch(() => ({}));
        toast(err?.error ?? "Could not index file");
        return;
      }
      load();
    } finally {
      setUploading(false);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) await upload(f);
    e.target.value = "";
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) await upload(f);
  };

  const toggleStar = async (file: ApiFile) => {
    const next = !file.starred;
    setRows((prev) => (prev ?? []).map((f) => (f.id === file.id ? { ...f, starred: next } : f)));
    try {
      await fetch(`/api/files/${file.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
    } catch {
      setRows((prev) => (prev ?? []).map((f) => (f.id === file.id ? { ...f, starred: file.starred } : f)));
    }
  };

  const remove = async (file: ApiFile) => {
    if (!(await confirm({ title: "Delete file", description: `Delete ${file.name}? This cannot be undone.`, destructive: true, confirmLabel: "Delete" }))) return;
    setRows((prev) => (prev ?? []).filter((f) => f.id !== file.id));
    try {
      await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    } catch {
      load();
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    let base = rows;
    if (activeSpaceId === "unscoped") {
      base = base.filter((f) => !f.spaceId);
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((f) =>
      f.name.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q),
    );
  }, [rows, query, activeSpaceId]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={dragOver ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-zinc-50 rounded-xl" : ""}
    >
      {spaces.length > 0 ? (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <FileSpaceChip
            label="All"
            active={activeSpaceId === "all"}
            onClick={() => setActiveSpaceId("all")}
          />
          <FileSpaceChip
            label="Unscoped"
            active={activeSpaceId === "unscoped"}
            onClick={() => setActiveSpaceId("unscoped")}
          />
          {spaces.map((s) => (
            <FileSpaceChip
              key={s.id}
              label={s.name}
              color={s.color}
              active={activeSpaceId === s.id}
              onClick={() => setActiveSpaceId(s.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-4">
        <div className="text-[12.5px] text-zinc-500">
          {rows === null ? "Loading…" : `${filtered.length} file${filtered.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPick}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium hover:bg-zinc-800 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </button>
        </div>
      </div>

      {rows === null ? (
        <div className="text-zinc-400 text-[13px]">Loading files…</div>
      ) : filtered.length === 0 ? (
        <EmptyTab
          icon={<Folder className="h-8 w-8 text-zinc-300" />}
          title={query ? `No files match "${query}"` : "No files yet"}
          subtitle="Drag a file anywhere on this page, or click Upload. Max 10MB."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((f) => {
            const isImage = f.mimeType.startsWith("image/");
            return (
              <div
                key={f.id}
                className="group rounded-lg border border-zinc-200 bg-white overflow-hidden hover:border-zinc-300 hover:shadow-sm transition"
              >
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-video bg-zinc-50 border-b border-zinc-100 relative overflow-hidden"
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MimeIcon mimeType={f.mimeType} className="h-8 w-8 text-zinc-300" />
                    </div>
                  )}
                </a>
                <div className="p-3">
                  <div className="flex items-start gap-1.5">
                    <div className="flex-1 min-w-0">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[13px] font-medium text-zinc-900 truncate hover:text-zinc-700"
                        title={f.name}
                      >
                        {f.name}
                      </a>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400">
                        <Clock className="h-3 w-3" />
                        {relTime(f.updatedAt)}
                        <span className="text-zinc-300">·</span>
                        {formatBytes(f.size)}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleStar(f)}
                        className={`p-1 rounded hover:bg-zinc-100 ${f.starred ? "text-amber-500" : "text-zinc-400"}`}
                        title={f.starred ? "Unstar" : "Star"}
                      >
                        <Star className={`h-3 w-3 ${f.starred ? "fill-current" : ""}`} />
                      </button>
                      <a
                        href={f.url}
                        download
                        className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700"
                        title="Download"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => remove(f)}
                        className="p-1 rounded hover:bg-red-50 text-zinc-400 hover:text-red-500"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tables tab — Stackby/Airtable-style data tables. Lego primitive
// (Phase 32). Each row is a DataTable with column count + row count.
// ────────────────────────────────────────────────────────────────────

interface ApiTable {
  id: string;
  name: string;
  description?: string | null;
  columns: { id: string; type: string; label: string }[];
  rowCount: number;
  spaceId?: string | null;
  updatedAt: string;
}

function TablesTab({ query, spaces }: { query: string; spaces: SpaceChip[] }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [rows, setRows] = useState<ApiTable[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | "all" | "unscoped">("all");

  const load = useCallback(() => {
    let url = "/api/tables";
    if (activeSpaceId === "unscoped") url += "?spaceId=unscoped";
    else if (activeSpaceId !== "all") url += `?spaceId=${activeSpaceId}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list: ApiTable[] = Array.isArray(data) ? data : (data?.data ?? []);
        setRows(list);
      })
      .catch(() => setRows([]));
  }, [activeSpaceId]);
  useEffect(() => { load(); }, [load]);

  const newTable = async () => {
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: "Untitled table" };
      if (activeSpaceId !== "all" && activeSpaceId !== "unscoped") {
        body.spaceId = activeSpaceId;
      }
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const id = data?.id ?? data?.data?.id;
      if (id) router.push(`/tables/${id}`);
      else throw new Error();
    } catch {
      toast("Couldn't create table");
    } finally {
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) =>
      t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div>
      {spaces.length > 0 ? (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <FileSpaceChip label="All" active={activeSpaceId === "all"} onClick={() => setActiveSpaceId("all")} />
          <FileSpaceChip label="Unscoped" active={activeSpaceId === "unscoped"} onClick={() => setActiveSpaceId("unscoped")} />
          {spaces.map((s) => (
            <FileSpaceChip key={s.id} label={s.name} color={s.color} active={activeSpaceId === s.id} onClick={() => setActiveSpaceId(s.id)} />
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-4">
        <div className="text-[12.5px] text-zinc-500">
          {rows === null ? "Loading…" : `${filtered.length} table${filtered.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={newTable}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium hover:bg-zinc-800 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          New table
        </button>
      </div>

      {rows === null ? (
        <div className="text-zinc-400 text-[13px]">Loading tables…</div>
      ) : filtered.length === 0 ? (
        <EmptyTab
          icon={<Database className="h-8 w-8 text-zinc-300" />}
          title={query ? `No tables match "${query}"` : "No tables yet"}
          subtitle="Stackby-style flexible data tables. Build a CRM, a vendor list, or any spreadsheet — drop them into tasks and Spaces."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((t) => (
            <div key={t.id} className="relative group/table">
              <button
                type="button"
                onClick={() => router.push(`/tables/${t.id}`)}
                className="w-full text-left rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-2 mb-2 pr-7">
                  <Database className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                    {t.columns.length} column{t.columns.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="text-[13px] font-medium text-zinc-900 line-clamp-1">{t.name}</div>
                {t.description ? (
                  <div className="mt-1 text-[12px] text-zinc-500 line-clamp-2">{t.description}</div>
                ) : null}
                <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
                  <Clock className="h-3 w-3" />
                  {relTime(t.updatedAt)}
                  <span className="text-zinc-300">·</span>
                  {t.rowCount} {t.rowCount === 1 ? "row" : "rows"}
                </div>
              </button>
              <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/table:opacity-100 transition-opacity">
                <TableFavoriteButton tableId={t.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyTab({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-12 text-center">
      <div className="inline-flex items-center justify-center mb-3">{icon}</div>
      <div className="text-[14px] font-medium text-zinc-900 mb-1">{title}</div>
      <div className="text-[12.5px] text-zinc-500 max-w-sm mx-auto">{subtitle}</div>
    </div>
  );
}

function FileSpaceChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11.5px] px-2 py-1 rounded-full border transition inline-flex items-center gap-1.5"
      style={{
        backgroundColor: active ? (color ?? "#18181b") : "white",
        borderColor: active ? (color ?? "#18181b") : "rgb(228 228 231)",
        color: active ? "white" : "rgb(82 82 91)",
      }}
    >
      {color ? (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: active ? "white" : color }}
        />
      ) : null}
      {label}
    </button>
  );
}
