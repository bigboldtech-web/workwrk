"use client";

// /library — unified destination for Notes, Whiteboards, and Files.
//
// Replaces the standalone /whiteboards entry as a sidebar destination.
// Notes live in Doc table; Whiteboards in Whiteboard table; Files is
// a placeholder until the upload surface lands.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Library as LibraryIcon, FileText, Frame, Folder, Plus, Search, Loader2, Clock,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Tab = "notes" | "whiteboards" | "files";

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
  const [tab, setTab] = useState<Tab>("notes");
  const [query, setQuery] = useState("");

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
        {tab === "notes" ? <NotesTab query={query} /> : null}
        {tab === "whiteboards" ? <WhiteboardsTab query={query} /> : null}
        {tab === "files" ? <FilesPlaceholder /> : null}
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

function NotesTab({ query }: { query: string }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [rows, setRows] = useState<ApiDoc[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docs");
      const data = await res.json();
      setRows(data.docs ?? []);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const newNote = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled note" }),
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
            <button
              key={d.id}
              type="button"
              onClick={() => router.push(`/docs/${d.id}`)}
              className="text-left rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-2 mb-2">
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
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Whiteboards tab
// ────────────────────────────────────────────────────────────────────

function WhiteboardsTab({ query }: { query: string }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [rows, setRows] = useState<ApiWhiteboard[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whiteboards");
      const data = await res.json();
      setRows(data.whiteboards ?? []);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const newBoard = async () => {
    const name = window.prompt("Whiteboard name?", "Untitled whiteboard")?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
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
            <button
              key={b.id}
              type="button"
              onClick={() => router.push(`/whiteboards/${b.id}`)}
              className="text-left rounded-lg border border-zinc-200 bg-white overflow-hidden hover:border-zinc-300 hover:shadow-sm transition"
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
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Files tab — placeholder
// ────────────────────────────────────────────────────────────────────

function FilesPlaceholder() {
  return (
    <EmptyTab
      icon={<Folder className="h-8 w-8 text-zinc-300" />}
      title="Files coming soon"
      subtitle="Upload attachments to any task, KRA, or SOP. They'll be indexed and discoverable here."
    />
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
