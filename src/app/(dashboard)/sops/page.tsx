"use client";

/* SOP library — clean card/list grid grouped by category, aligned to the app's
 * Tailwind/zinc design language.
 *
 *  GET   /api/sops
 *  Status enum: DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookCopy, Plus, Search, ClipboardCheck, ChevronRight, ChevronDown, FileText,
  CheckCircle2, Archive, Eye, Edit3, AlertTriangle, BookOpen, Target, Loader2,
  LayoutGrid, List as ListIcon, MoreHorizontal, Trash2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type SopStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";

type ApiSop = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status: SopStatus;
  version: number;
  tags?: string[];
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  kra?: { id: string; name: string } | null;
  _count?: { assignments?: number; steps?: number };
};

const STATUS_LABEL: Record<SopStatus, string> = {
  DRAFT: "Draft", IN_REVIEW: "In review", APPROVED: "Approved",
  PUBLISHED: "Published", ARCHIVED: "Archived",
};
const STATUS_ICON: Record<SopStatus, typeof Edit3> = {
  DRAFT: Edit3, IN_REVIEW: Eye, APPROVED: ClipboardCheck,
  PUBLISHED: CheckCircle2, ARCHIVED: Archive,
};
const STATUS_PILL: Record<SopStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  IN_REVIEW: "bg-amber-50 text-amber-700",
  APPROVED: "bg-blue-50 text-blue-700",
  PUBLISHED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-zinc-100 text-zinc-400",
};

const STATUS_FILTERS: Array<"ALL" | SopStatus> = ["ALL", "PUBLISHED", "APPROVED", "IN_REVIEW", "DRAFT"];

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function SopsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ApiSop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | SopStatus>("ALL");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menu, setMenu] = useState<{ s: ApiSop; x: number; y: number } | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sops?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiSop[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("sops");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  function openMenu(e: React.MouseEvent, s: ApiSop) { e.preventDefault(); e.stopPropagation(); setMenu({ s, x: e.clientX, y: e.clientY }); }
  async function deleteSop(s: ApiSop) {
    if (!confirm(`Move "${s.title}" to Trash? It will be auto-deleted after 60 days.`)) return;
    const res = await fetch(`/api/sops/${s.id}`, { method: "DELETE" });
    if (res.ok) { toast("Moved to Trash"); void load(); } else toast(res.status === 403 ? "No permission" : "Couldn't delete");
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<SopStatus, number> = { DRAFT: 0, IN_REVIEW: 0, APPROVED: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const s of list) counts[s.status] = (counts[s.status] ?? 0) + 1;
    const totalAssignments = list.reduce((a, s) => a + (s._count?.assignments ?? 0), 0);
    return { total: list.length, counts, totalAssignments };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    list = list.filter((s) => s.status !== "ARCHIVED");
    if (statusFilter !== "ALL") list = list.filter((s) => s.status === statusFilter);
    if (activeCategory) list = list.filter((s) => (s.category ?? "Uncategorized") === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(q)));
    return list;
  }, [rows, search, statusFilter, activeCategory]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows ?? []) {
      if (s.status === "ARCHIVED") continue;
      const cat = s.category ?? "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiSop[]>();
    for (const s of filtered) {
      const cat = s.category ?? "Uncategorized";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(s);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({
        name,
        items: items.slice().sort((a, b) => a.title.localeCompare(b.title)),
      }));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="SOPs"
        showStandardActions={false}
        Icon={BookCopy}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading…" : `${stats.total} SOP${stats.total === 1 ? "" : "s"} · ${stats.counts.PUBLISHED} published · ${stats.totalAssignments} assignment${stats.totalAssignments === 1 ? "" : "s"}`}
        actions={
          <Link
            href="/sops/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium hover:opacity-90"
            style={{ background: "var(--os-brand)", color: "#fff" }}
          >
            <Plus className="h-3.5 w-3.5" /> New SOP
          </Link>
        }
      />

      <div className="px-6 py-5">
        {/* Toolbar (status counts live in the segmented filter — no redundant tiles) */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, tags…"
              className="h-full w-full bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400"
            />
          </div>

          {/* Category dropdown */}
          {categories.length > 0 && (
            <div className="relative">
              <select
                value={activeCategory ?? ""}
                onChange={(e) => setActiveCategory(e.target.value || null)}
                className="h-9 cursor-pointer appearance-none rounded-lg border border-zinc-200 bg-white pl-3 pr-8 text-[13px] text-zinc-700 outline-none hover:bg-zinc-50"
              >
                <option value="">All categories ({stats.total})</option>
                {categories.map(([cat, n]) => (
                  <option key={cat} value={cat}>{cat} ({n})</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
            <button
              type="button"
              onClick={() => setView("grid")}
              title="Card view"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${view === "grid" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              title="List view"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${view === "list" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status filter — own row. Inline styles so the global
            `.workwrk-os button { padding:0; border:none; background:none }`
            reset can't strip the pill padding/border/background. */}
        <div className="mt-3 flex flex-wrap items-center" style={{ gap: "8px" }}>
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s;
            const count = s === "ALL" ? stats.total : stats.counts[s as SopStatus];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "9999px",
                  fontSize: "13px",
                  fontWeight: active ? 600 : 400,
                  border: active ? "1px solid var(--os-brand)" : "1px solid #e4e4e7",
                  background: active ? "var(--os-brand)" : "#fff",
                  color: active ? "#fff" : "#52525b",
                  cursor: "pointer",
                  transition: "all .12s",
                }}
              >
                {s === "ALL" ? "All" : STATUS_LABEL[s as SopStatus]}
                <span style={{ color: active ? "rgba(255,255,255,0.75)" : "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="mt-5">
          {loadError ? (
            <OsEmptyView Icon={BookCopy} iconGradient={GRAD.redPink} title="Couldn't load SOPs" subtitle={loadError} cta="Retry" onCta={() => void load()} />
          ) : rows === null ? (
            <div className="flex items-center gap-2 py-16 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading SOPs…
            </div>
          ) : stats.total === 0 ? (
            <OsEmptyView
              Icon={BookCopy}
              iconGradient={GRAD.tealGreen}
              title="No SOPs yet"
              subtitle="Document a process once, then assign it to teammates. SOPs version automatically as you edit."
              chips={["Text", "Checklist", "Video"]}
              cta="New SOP"
              onCta={() => router.push("/sops/new")}
            />
          ) : grouped.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
              <AlertTriangle className="h-4 w-4" /> No SOPs match the current filter.
            </div>
          ) : (
            <div className="space-y-7">
              {grouped.map((g) => (
                <section key={g.name}>
                  <header className="mb-2.5 flex items-center gap-2">
                    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{g.name}</h2>
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-500">{g.items.length}</span>
                    <span className="h-px flex-1 bg-zinc-100" />
                  </header>
                  {view === "list" ? (
                    <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                      {g.items.map((s) => <SopRow key={s.id} s={s} onMenu={openMenu} />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {g.items.map((s) => <SopCard key={s.id} s={s} onMenu={openMenu} />)}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {menu ? (
        <>
          <div className="fixed inset-0 z-[140]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="fixed z-[141] w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl"
            style={{ left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 184), top: menu.y }}>
            <button type="button" onClick={() => { const s = menu.s; setMenu(null); window.location.href = `/sops/${s.id}`; }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"><FileText className="h-3.5 w-3.5" /> Open</button>
            <button type="button" onClick={() => { const s = menu.s; setMenu(null); void deleteSop(s); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          </div>
        </>
      ) : null}
    </>
  );
}

function SopCard({ s, onMenu }: { s: ApiSop; onMenu: (e: React.MouseEvent, s: ApiSop) => void }) {
  const Icon = STATUS_ICON[s.status];
  return (
    <Link
      href={`/sops/${s.id}`}
      onContextMenu={(e) => onMenu(e, s)}
      className="group relative flex flex-col rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-zinc-300 hover:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.15)]"
    >
      <button type="button" onClick={(e) => { e.preventDefault(); onMenu(e, s); }} className="absolute right-2 top-2 z-10 rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100" title="More"><MoreHorizontal className="h-4 w-4" /></button>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[s.status]}`}>
          <Icon className="h-3 w-3" /> {STATUS_LABEL[s.status]}
        </span>
        <span className="text-[11px] text-zinc-400">v{s.version}</span>
      </div>

      <h3 className="mt-2.5 line-clamp-1 text-[14px] font-semibold text-zinc-900 group-hover:text-zinc-950">{s.title}</h3>
      {s.description && (
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-zinc-500">{s.description}</p>
      )}

      {s.tags && s.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {s.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10.5px] text-zinc-500">{t}</span>
          ))}
          {s.tags.length > 3 && <span className="text-[10.5px] text-zinc-400">+{s.tags.length - 3}</span>}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-400">
        {s.kra && (
          <span className="inline-flex items-center gap-1 truncate" title={`Measures KRA: ${s.kra.name}`}>
            <Target className="h-3 w-3 shrink-0" /> <span className="truncate">{s.kra.name}</span>
          </span>
        )}
        {s._count?.steps != null && (
          <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3" /> {s._count.steps}</span>
        )}
        {s._count?.assignments != null && (
          <span className="inline-flex items-center gap-1"><ClipboardCheck className="h-3 w-3" /> {s._count.assignments}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <FileText className="h-3 w-3" /> {fmtDate(s.updatedAt)}
          <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </div>
    </Link>
  );
}

function SopRow({ s, onMenu }: { s: ApiSop; onMenu: (e: React.MouseEvent, s: ApiSop) => void }) {
  const Icon = STATUS_ICON[s.status];
  return (
    <Link href={`/sops/${s.id}`} onContextMenu={(e) => onMenu(e, s)} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50">
      <span className={`inline-flex w-[92px] shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[s.status]}`}>
        <Icon className="h-3 w-3" /> {STATUS_LABEL[s.status]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-zinc-900">{s.title}</span>
        {s.description && <span className="block truncate text-[12px] text-zinc-400">{s.description}</span>}
      </span>
      {s._count?.steps != null && (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-zinc-400 sm:inline-flex"><BookOpen className="h-3 w-3" /> {s._count.steps}</span>
      )}
      {s._count?.assignments != null && (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-zinc-400 sm:inline-flex"><ClipboardCheck className="h-3 w-3" /> {s._count.assignments}</span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{fmtDate(s.updatedAt)}</span>
      <button type="button" onClick={(e) => { e.preventDefault(); onMenu(e, s); }} className="shrink-0 rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100" title="More"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
    </Link>
  );
}
