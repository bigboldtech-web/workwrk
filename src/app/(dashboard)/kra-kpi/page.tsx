"use client";

/* KRA/KPI — definitions library grouped by category.
 *
 *  GET   /api/kras
 *  POST  /api/kras
 *  PATCH /api/kras
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Target, Plus, Search, ChevronRight, Hash, Briefcase,
  TrendingUp, TrendingDown, Award, Users, Activity, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiKpi = {
  id: string;
  name: string;
  unit?: string | null;
  type?: string | null;
  frequency?: string | null;
  targetValue?: number | string | null;
  lowerIsBetter?: boolean;
};

type ApiKra = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  roleId?: string | null;
  role?: { id: string; title: string } | null;
  kpis?: ApiKpi[];
  _count?: { assignments?: number };
  createdAt?: string;
  updatedAt?: string;
};

const CATEGORY_PALETTE = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function categoryColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

const FREQ_LABELS: Record<string, string> = {
  DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUALLY: "Annually",
};

export default function KraKpiPage() {
  const [kras, setKras] = useState<ApiKra[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kras?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiKra[] = data?.data?.items ?? data?.data?.data ?? data?.items ?? (Array.isArray(data?.data) ? data.data : []) ?? (Array.isArray(data) ? data : []);
      setKras(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("kra-kpi");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = (typeof window !== "undefined" ? window.prompt("KRA name?") : "")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/kras", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: activeCategory ?? "Uncategorized" }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only HR can create KRAs");
        else toast("Couldn't create");
        return;
      }
      toast("KRA created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  const filtered = useMemo(() => {
    let list = kras ?? [];
    if (activeCategory) list = list.filter((k) => (k.category ?? "Uncategorized") === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((k) =>
      k.name.toLowerCase().includes(q) ||
      (k.description ?? "").toLowerCase().includes(q) ||
      (k.kpis ?? []).some((p) => p.name.toLowerCase().includes(q)));
    return list;
  }, [kras, search, activeCategory]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of kras ?? []) {
      const cat = k.category ?? "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [kras]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiKra[]>();
    for (const k of filtered) {
      const cat = k.category ?? "Uncategorized";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(k);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ name, color: categoryColor(name), items: items.slice().sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [filtered]);

  const stats = useMemo(() => {
    const list = kras ?? [];
    const totalKpis = list.reduce((acc, k) => acc + (k.kpis?.length ?? 0), 0);
    const totalAssignments = list.reduce((acc, k) => acc + (k._count?.assignments ?? 0), 0);
    const withRole = list.filter((k) => k.role).length;
    return { total: list.length, totalKpis, totalAssignments, withRole, categories: categories.length };
  }, [kras, categories]);

  return (
    <>
      <OsTitleBar
        title="KRA / KPI"
        Icon={Target}
        iconGradient={GRAD.purpleIndigo}
        description={kras === null ? "Loading…" : `${stats.total} KRA${stats.total === 1 ? "" : "s"} · ${stats.totalKpis} KPI${stats.totalKpis === 1 ? "" : "s"} · ${stats.categories} categor${stats.categories === 1 ? "y" : "ies"}`}
        actions={
          <div className="kra__head-actions">
            <Link href="/kra-kpi/review" className="kra__nav-link"><Activity /> KPI review cycle</Link>
            <Link href="/reviews" className="kra__nav-link"><Award /> Reviews</Link>
            <button type="button" className="kra__btn-primary" onClick={quickAdd}>
              <Plus /> New KRA
            </button>
          </div>
        }
      />

      <div className="kra">
        <div className="kra__kpis">
          <KpiTile accent="var(--os-c-purple)" Icon={Target}    label="KRAs"          value={`${stats.total}`}            sub="key result areas" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Activity}  label="KPIs"          value={`${stats.totalKpis}`}        sub="metric definitions" />
          <KpiTile accent="var(--os-c-green)"  Icon={Users}     label="Assignments"   value={`${stats.totalAssignments}`} sub="people on KRAs" />
          <KpiTile accent="var(--os-c-orange)" Icon={Briefcase} label="Role-mapped"   value={`${stats.withRole}`}         sub={`${stats.total - stats.withRole} role-agnostic`} />
        </div>

        <div className="kra__toolbar">
          <div className="kra__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search KRA, KPI, description…" />
          </div>
        </div>

        {categories.length > 0 && (
          <div className="kra__cats">
            <button type="button" className={`kra__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Hash /> All <span>{stats.total}</span>
            </button>
            {categories.map(([cat, count]) => (
              <button key={cat} type="button" className={`kra__cat${activeCategory === cat ? " is-active" : ""}`} style={{ ["--cat-c" as unknown as string]: categoryColor(cat) }} onClick={() => setActiveCategory(cat)}>
                <span className="kra__cat-dot" />
                {cat}
                <span>{count}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={Target} iconGradient={GRAD.redPink} title="Couldn't load KRAs" subtitle={loadError} cta="Retry" />
        ) : kras === null ? (
          <div className="kra__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Target}
            iconGradient={GRAD.purpleIndigo}
            title="No KRAs defined yet"
            subtitle="KRAs (Key Result Areas) define outcomes you measure with KPIs. Assign them to roles or individuals."
            chips={["Sales", "Engineering", "Operations", "Marketing"]}
            cta="New KRA"
          />
        ) : grouped.length === 0 ? (
          <div className="kra__empty">
            <Search />
            <div>No KRAs match.</div>
          </div>
        ) : (
          grouped.map((g) => (
            <section key={g.name} className="kra__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="kra__group-head">
                <span className="kra__group-dot" />
                <h2>{g.name}</h2>
                <span className="kra__group-count">{g.items.length} KRA{g.items.length === 1 ? "" : "s"}</span>
                <span className="kra__group-line" />
              </header>
              <div className="kra__grid">
                {g.items.map((k) => <KraCard key={k.id} kra={k} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function KraCard({ kra: k }: { kra: ApiKra }) {
  const cat = k.category ?? "Uncategorized";
  const color = categoryColor(cat);
  const kpis = k.kpis ?? [];
  return (
    <article className="kra__card" style={{ ["--card-c" as unknown as string]: color }}>
      <header className="kra__card-head">
        <h3 className="kra__card-name">{k.name}</h3>
        {k.role && <span className="kra__card-role"><Briefcase /> {k.role.title}</span>}
      </header>
      {k.description && <p className="kra__card-desc">{k.description.length > 120 ? k.description.slice(0, 120) + "…" : k.description}</p>}
      {kpis.length > 0 && (
        <div className="kra__kpis-list">
          <div className="kra__kpis-label"><Layers /> {kpis.length} KPI{kpis.length === 1 ? "" : "s"}</div>
          <ul>
            {kpis.slice(0, 4).map((p) => (
              <li key={p.id} className="kra__kpi-item">
                {p.lowerIsBetter ? <TrendingDown /> : <TrendingUp />}
                <span className="kra__kpi-name">{p.name}</span>
                {p.targetValue != null && p.targetValue !== "" && (
                  <span className="kra__kpi-target">{p.targetValue}{p.unit ? ` ${p.unit}` : ""}</span>
                )}
                {p.frequency && <span className="kra__kpi-freq">{FREQ_LABELS[p.frequency] ?? p.frequency}</span>}
              </li>
            ))}
            {kpis.length > 4 && <li className="kra__kpi-more">+{kpis.length - 4} more</li>}
          </ul>
        </div>
      )}
      <footer className="kra__card-foot">
        <span><Users /> {k._count?.assignments ?? 0} assigned</span>
        <ChevronRight className="kra__card-arrow" />
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Target; label: string; value: string; sub: string }) {
  return (
    <div className="kra__kpi-stat" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="kra__kpi-stat-accent" aria-hidden="true" />
      <div className="kra__kpi-stat-row">
        <div className="kra__kpi-stat-icon"><Icon /></div>
        <div className="kra__kpi-stat-label">{label}</div>
      </div>
      <div className="kra__kpi-stat-value">{value}</div>
      <div className="kra__kpi-stat-sub">{sub}</div>
    </div>
  );
}
