"use client";

/* SOP library — bespoke layout grouped by category with KPI strip.
 *
 *  GET   /api/sops
 *  PATCH /api/sops/[id]   { status?, title?, ... }
 *
 *  Status enum: DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookCopy, Plus, Search, ClipboardCheck, Hash, ChevronRight, FileText,
  CheckCircle2, Activity, Archive, Layers, Eye, Edit3, AlertTriangle, BookOpen,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
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
  _count?: { assignments?: number; steps?: number };
};

const STATUS_LABEL: Record<SopStatus, string> = {
  DRAFT: "Draft", IN_REVIEW: "In review", APPROVED: "Approved",
  PUBLISHED: "Published", ARCHIVED: "Archived",
};
const STATUS_COLOR: Record<SopStatus, string> = {
  DRAFT: "var(--os-c-indigo)", IN_REVIEW: "var(--os-c-purple)",
  APPROVED: "var(--os-c-blue)", PUBLISHED: "var(--os-c-green)",
  ARCHIVED: "var(--os-ink-3)",
};
const STATUS_ICON: Record<SopStatus, typeof Edit3> = {
  DRAFT: Edit3, IN_REVIEW: Eye, APPROVED: ClipboardCheck,
  PUBLISHED: CheckCircle2, ARCHIVED: Archive,
};

const CATEGORY_PALETTE = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function categoryColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

export default function SopsPage() {
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
        color: categoryColor(name),
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
          <div className="sop__head-actions">
            <Link href="/sops/my-sops" className="sop__nav-link"><ClipboardCheck /> My SOPs</Link>
            <Link href="/sops/compliance" className="sop__nav-link"><Activity /> Compliance</Link>
            <Link href="/sops/new" className="sop__btn-primary"><Plus /> New SOP</Link>
          </div>
        }
      />

      <div className="sop">
        <div className="sop__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2}   label="Published"  value={`${stats.counts.PUBLISHED}`} sub="live in library" />
          <KpiTile accent="var(--os-c-purple)" Icon={Eye}            label="In review"  value={`${stats.counts.IN_REVIEW}`} sub="awaiting approval" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Edit3}          label="Drafts"     value={`${stats.counts.DRAFT}`}     sub="in progress" />
          <KpiTile accent="var(--os-c-blue)"   Icon={ClipboardCheck} label="Assignments" value={`${stats.totalAssignments}`} sub="across SOPs" />
        </div>

        <div className="sop__toolbar">
          <div className="sop__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, description, tags…" />
          </div>
          <div className="sop__filters">
            {(["ALL", "PUBLISHED", "APPROVED", "IN_REVIEW", "DRAFT"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as SopStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`sop__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_COLOR[s as SopStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as SopStatus]}
                  <span>{s === "ALL" ? stats.total : stats.counts[s as SopStatus]}</span>
                </button>
              );
            })}
          </div>
          <label className="sop__archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <Archive /> Show archived
          </label>
        </div>

        {categories.length > 0 && (
          <div className="sop__cats">
            <button type="button" className={`sop__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Layers /> All <span>{stats.total}</span>
            </button>
            {categories.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`sop__cat${activeCategory === cat ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: categoryColor(cat) }}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                <span className="sop__cat-dot" />
                {cat}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={BookCopy} iconGradient={GRAD.redPink} title="Couldn't load SOPs" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="sop__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={BookCopy}
            iconGradient={GRAD.tealGreen}
            title="No SOPs yet"
            subtitle="Document a process once, then assign it to teammates. SOPs version automatically as you edit."
            chips={["Text", "Checklist", "Video"]}
            cta="New SOP"
          />
        ) : grouped.length === 0 ? (
          <div className="sop__no-match"><AlertTriangle /> No SOPs match the current filter.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.name} className="sop__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="sop__group-head">
                <span className="sop__group-dot" />
                <h2>{g.name}</h2>
                <span className="sop__group-count">{g.items.length} SOP{g.items.length === 1 ? "" : "s"}</span>
                <span className="sop__group-line" />
              </header>
              <div className="sop__grid">
                {g.items.map((s) => <SopCard key={s.id} s={s} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function SopCard({ s }: { s: ApiSop }) {
  const Icon = STATUS_ICON[s.status];
  return (
    <Link href={`/sops/${s.id}`} className="sop__card" style={{ ["--card-c" as unknown as string]: STATUS_COLOR[s.status] }}>
      <header className="sop__card-head">
        <span className="sop__card-status"><Icon /> {STATUS_LABEL[s.status]}</span>
        <span className="sop__card-version">v{s.version}</span>
      </header>
      <h3 className="sop__card-title">{s.title}</h3>
      {s.description && (
        <p className="sop__card-desc">{s.description.length > 120 ? s.description.slice(0, 120) + "…" : s.description}</p>
      )}
      {s.tags && s.tags.length > 0 && (
        <div className="sop__card-tags">
          {s.tags.slice(0, 4).map((t) => <span key={t}>{t}</span>)}
          {s.tags.length > 4 && <span className="sop__card-tag-more">+{s.tags.length - 4}</span>}
        </div>
      )}
      <footer className="sop__card-foot">
        {s._count?.steps != null && <span><BookOpen /> {s._count.steps} step{s._count.steps === 1 ? "" : "s"}</span>}
        {s._count?.assignments != null && <span><ClipboardCheck /> {s._count.assignments}</span>}
        <span className="sop__card-updated">
          <FileText /> {new Date(s.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
        <ChevronRight className="sop__card-arrow" />
      </footer>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof BookCopy; label: string; value: string; sub: string }) {
  return (
    <div className="sop__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="sop__kpi-accent" aria-hidden="true" />
      <div className="sop__kpi-row">
        <div className="sop__kpi-icon"><Icon /></div>
        <div className="sop__kpi-label">{label}</div>
      </div>
      <div className="sop__kpi-value">{value}</div>
      <div className="sop__kpi-sub">{sub}</div>
    </div>
  );
}
