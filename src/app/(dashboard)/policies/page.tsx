"use client";

/* Policies — bespoke library grouped by category with KPI strip + ack tracking.
 *
 *  GET   /api/policies            list PUBLISHED policies (with my-ack state)
 *  POST  /api/policies            { title, content, status? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, Plus, Search, Hash, ChevronRight, FileText, CheckCircle2,
  AlertTriangle, Layers, Activity, Calendar as CalendarIcon, BadgeCheck,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PolStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type ApiPolicy = {
  id: string;
  title: string;
  category?: string | null;
  version: number;
  status: PolStatus;
  requiresAck: boolean;
  effectiveDate?: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledged?: boolean;
  ackRate?: number;
  totalAcks?: number;
  totalUsers?: number;
};

const CATEGORY_COLORS: Record<string, string> = {
  HR: C.pink, Security: C.red, Compliance: C.purple, Operations: C.orange,
  "Code of Conduct": C.blue, Leave: C.teal, Expense: C.brown,
};
function categoryColor(name: string): string {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
  return palette[h % palette.length];
}

function rateHue(pct: number): string {
  if (pct >= 90) return "var(--os-c-green)";
  if (pct >= 70) return "var(--os-c-teal)";
  if (pct >= 40) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

export default function PoliciesPage() {
  const [rows, setRows] = useState<ApiPolicy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [onlyMyAck, setOnlyMyAck] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/policies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("policies");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/policies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled policy",
          content: "Write the policy text here…",
          status: "PUBLISHED",
        }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't create"); return; }
      toast("Policy created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const requiresAck = list.filter((p) => p.requiresAck);
    const pendingMyAck = requiresAck.filter((p) => !p.acknowledged).length;
    const ackedMine = requiresAck.filter((p) => p.acknowledged).length;
    const orgAckRate = list.length
      ? Math.round(list.reduce((a, p) => a + (p.ackRate ?? 0), 0) / list.length)
      : 0;
    const lowAdoption = list.filter((p) => (p.ackRate ?? 0) < 50 && p.requiresAck).length;
    return {
      total: list.length,
      pendingMyAck, ackedMine, requiresAck: requiresAck.length,
      orgAckRate, lowAdoption,
    };
  }, [rows]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of rows ?? []) {
      const cat = p.category ?? "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (activeCategory) list = list.filter((p) => (p.category ?? "Uncategorized") === activeCategory);
    if (onlyMyAck) list = list.filter((p) => p.requiresAck && !p.acknowledged);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, activeCategory, onlyMyAck]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiPolicy[]>();
    for (const p of filtered) {
      const cat = p.category ?? "Uncategorized";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(p);
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
        title="Policies"
        Icon={ShieldCheck}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading…" : `${stats.total} polic${stats.total === 1 ? "y" : "ies"}${stats.pendingMyAck > 0 ? ` · ${stats.pendingMyAck} need your ack` : ""} · ${stats.orgAckRate}% org ack rate`}
        actions={
          <div className="pol__head-actions">
            <Link href="/sops" className="pol__nav-link"><FileText /> SOPs</Link>
            <Link href="/sops/compliance" className="pol__nav-link"><Activity /> Compliance</Link>
            <button type="button" className="pol__btn-primary" onClick={quickAdd}>
              <Plus /> New policy
            </button>
          </div>
        }
      />

      <div className="pol">
        <div className="pol__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={AlertTriangle} label="Pending your ack" value={`${stats.pendingMyAck}`} sub={`of ${stats.requiresAck} required`} />
          <KpiTile accent="var(--os-c-green)"  Icon={BadgeCheck}    label="You've acked"    value={`${stats.ackedMine}`}     sub="recorded on you" />
          <KpiTile accent={rateHue(stats.orgAckRate)} Icon={Activity} label="Org ack rate"   value={`${stats.orgAckRate}%`}    sub="weighted average" />
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Low adoption"    value={`${stats.lowAdoption}`}   sub="< 50% ack" />
        </div>

        {stats.pendingMyAck > 0 && (
          <div className="pol__banner">
            <AlertTriangle />
            <span><strong>{stats.pendingMyAck} polic{stats.pendingMyAck === 1 ? "y" : "ies"}</strong> require your acknowledgment.</span>
            <button type="button" onClick={() => setOnlyMyAck((v) => !v)} className="pol__banner-btn">
              {onlyMyAck ? "Show all" : "Show only mine"}
            </button>
          </div>
        )}

        <div className="pol__toolbar">
          <div className="pol__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policy, category…" />
          </div>
          {(search.trim() || activeCategory || onlyMyAck) && (
            <button type="button" className="pol__clear" onClick={() => { setSearch(""); setActiveCategory(null); setOnlyMyAck(false); }}>
              Clear filters
            </button>
          )}
        </div>

        {categories.length > 0 && (
          <div className="pol__cats">
            <button type="button" className={`pol__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Layers /> All <span>{stats.total}</span>
            </button>
            {categories.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`pol__cat${activeCategory === cat ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: categoryColor(cat) }}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                <span className="pol__cat-dot" />
                {cat}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.redPink} title="Couldn't load policies" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="pol__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={ShieldCheck}
            iconGradient={GRAD.indigoBlue}
            title="No published policies yet"
            subtitle="Document the rules. Policies require employee acknowledgment by default."
            chips={["HR", "Security", "Compliance", "Code of Conduct"]}
            cta="New policy"
          />
        ) : grouped.length === 0 ? (
          <div className="pol__no-match"><Search /> No policies match the current filter.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.name} className="pol__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="pol__group-head">
                <span className="pol__group-dot" />
                <h2>{g.name}</h2>
                <span className="pol__group-count">{g.items.length} polic{g.items.length === 1 ? "y" : "ies"}</span>
                <span className="pol__group-line" />
              </header>
              <div className="pol__grid">
                {g.items.map((p) => <PolicyCard key={p.id} p={p} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function PolicyCard({ p }: { p: ApiPolicy }) {
  const cat = p.category ?? "Uncategorized";
  const color = categoryColor(cat);
  const ackRate = p.ackRate ?? 0;
  return (
    <Link href={`/policies/${p.id}`} className="pol__card" style={{ ["--card-c" as unknown as string]: color }}>
      <header className="pol__card-head">
        <h3>{p.title}</h3>
        <span className="pol__card-ver">v{p.version}</span>
      </header>
      <div className="pol__card-meta">
        {p.requiresAck && (
          p.acknowledged ? (
            <span className="pol__card-ack pol__card-ack--ok"><CheckCircle2 /> You've acked</span>
          ) : (
            <span className="pol__card-ack pol__card-ack--pending"><AlertTriangle /> Ack required</span>
          )
        )}
        {p.effectiveDate && (
          <span className="pol__card-eff"><CalendarIcon /> Effective {new Date(p.effectiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
        )}
      </div>
      {p.requiresAck && (
        <div className="pol__card-rate">
          <div className="pol__card-rate-label">
            <span>Org ack rate</span>
            <strong style={{ color: rateHue(ackRate) }}>{ackRate}%</strong>
          </div>
          <div className="pol__card-rate-track">
            <div className="pol__card-rate-fill" style={{ width: `${ackRate}%`, background: rateHue(ackRate) }} />
          </div>
          {p.totalAcks != null && p.totalUsers != null && (
            <div className="pol__card-rate-sub">{p.totalAcks} of {p.totalUsers} acknowledged</div>
          )}
        </div>
      )}
      <footer className="pol__card-foot">
        <span>Updated {new Date(p.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <ChevronRight />
      </footer>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof ShieldCheck; label: string; value: string; sub: string }) {
  return (
    <div className="pol__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="pol__kpi-accent" aria-hidden="true" />
      <div className="pol__kpi-row">
        <div className="pol__kpi-icon"><Icon /></div>
        <div className="pol__kpi-label">{label}</div>
      </div>
      <div className="pol__kpi-value">{value}</div>
      <div className="pol__kpi-sub">{sub}</div>
    </div>
  );
}
