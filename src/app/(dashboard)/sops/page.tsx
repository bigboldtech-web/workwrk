"use client";

/* SOP library — clean card grid grouped by category, aligned to the app's
 * Tailwind/zinc design language (not the old bespoke sop__* CSS).
 *
 *  GET   /api/sops
 *  Status enum: DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookCopy, Plus, Search, ClipboardCheck, ChevronRight, FileText,
  CheckCircle2, Activity, Archive, Eye, Edit3, AlertTriangle, BookOpen, Target, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

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
// Clean signal pills, matching the rest of the app.
const STATUS_PILL: Record<SopStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  IN_REVIEW: "bg-amber-50 text-amber-700",
  APPROVED: "bg-blue-50 text-blue-700",
  PUBLISHED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-zinc-100 text-zinc-400",
};

const STATUS_FILTERS: Array<"ALL" | SopStatus> = ["ALL", "PUBLISHED", "APPROVED", "IN_REVIEW", "DRAFT"];

export default function SopsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ApiSop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | SopStatus>("ALL");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { rowVersion } = useOsShell();

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

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<SopStatus, number> = { DRAFT: 0, IN_REVIEW: 0, APPROVED: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const s of list) counts[s.status] = (counts[s.status] ?? 0) + 1;
    const totalAssignments = list.reduce((a, s) => a + (s._count?.assignments ?? 0), 0);
    return { total: list.length, counts, totalAssignments };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (!showArchived) list = list.filter((s) => s.status !== "ARCHIVED");
    if (statusFilter !== "ALL") list = list.filter((s) => s.status === statusFilter);
    if (activeCategory) list = list.filter((s) => (s.category ?? "Uncategorized") === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(q)));
    return list;
  }, [rows, search, statusFilter, activeCategory, showArchived]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows ?? []) {
      if (!showArchived && s.status === "ARCHIVED") continue;
      const cat = s.category ?? "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows, showArchived]);

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
        Icon={BookCopy}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading…" : `${stats.total} SOP${stats.total === 1 ? "" : "s"} · ${stats.counts.PUBLISHED} published · ${stats.totalAssignments} assignment${stats.totalAssignments === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sops/my-sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ClipboardCheck className="h-3.5 w-3.5" /> My SOPs
            </Link>
            <Link href="/sops/compliance" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <Activity className="h-3.5 w-3.5" /> Compliance
            </Link>
            <Link href="/sops/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[13px] font-medium text-white hover:bg-zinc-800">
              <Plus className="h-3.5 w-3.5" /> New SOP
            </Link>
          </div>
        }
      />

      <div className="px-6 py-5">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile Icon={CheckCircle2}   label="Published"   value={stats.counts.PUBLISHED}  sub="live in library"   tint="#10b981" />
          <StatTile Icon={Eye}            label="In review"   value={stats.counts.IN_REVIEW}  sub="awaiting approval" tint="#f59e0b" />
          <StatTile Icon={Edit3}          label="Drafts"      value={stats.counts.DRAFT}      sub="in progress"       tint="#6366f1" />
          <StatTile Icon={ClipboardCheck} label="Assignments" value={stats.totalAssignments}  sub="across SOPs"       tint="#3b82f6" />
        </div>

        {/* Toolbar */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, tags…"
              className="h-full w-full bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1">
            {STATUS_FILTERS.map((s) => {
              const active = statusFilter === s;
              const count = s === "ALL" ? stats.total : stats.counts[s as SopStatus];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors ${
                    active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {s === "ALL" ? "All" : STATUS_LABEL[s as SopStatus]}
                  <span className={`tabular-nums ${active ? "text-zinc-300" : "text-zinc-400"}`}>{count}</span>
                </button>
              );
            })}
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12.5px] text-zinc-600 hover:bg-zinc-50">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-zinc-900" />
            <Archive className="h-3.5 w-3.5" /> Archived
          </label>
        </div>

        {/* Category chips */}
        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <CategoryChip label="All" count={stats.total} active={activeCategory === null} onClick={() => setActiveCategory(null)} />
            {categories.map(([cat, n]) => (
              <CategoryChip
                key={cat}
                label={cat}
                count={n}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              />
            ))}
          </div>
        )}

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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {g.items.map((s) => <SopCard key={s.id} s={s} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatTile({ Icon, label, value, sub, tint }: { Icon: typeof BookCopy; label: string; value: number; sub: string; tint: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: tint }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      </div>
      <div className="mt-2 text-[22px] font-semibold tabular-nums leading-none text-zinc-900">{value}</div>
      <div className="mt-1 text-[11px] text-zinc-400">{sub}</div>
    </div>
  );
}

function CategoryChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
        active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {label}
      <span className={`tabular-nums ${active ? "text-zinc-300" : "text-zinc-400"}`}>{count}</span>
    </button>
  );
}

function SopCard({ s }: { s: ApiSop }) {
  const Icon = STATUS_ICON[s.status];
  return (
    <Link
      href={`/sops/${s.id}`}
      className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-zinc-300 hover:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.15)]"
    >
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
          <FileText className="h-3 w-3" />
          {new Date(s.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </div>
    </Link>
  );
}
