"use client";

/* Finance · Budget Plans — directory grouped by fiscal year with KPI strip.
 *
 * Reads: GET /api/budget-plans
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ScrollText, Plus, ChevronRight, Layers, Search, Hash, Coins, Activity,
  CheckCircle2, Edit3, Archive, TrendingUp,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PlanType = "BUDGET" | "FORECAST" | "STRATEGIC" | "WHAT_IF";
type PlanStatus = "DRAFT" | "ACTIVE" | "ARCHIVED" | "PUBLISHED";

type ApiPlan = {
  id: string;
  name: string;
  type: PlanType;
  status: PlanStatus;
  version: number;
  description?: string | null;
  publishedAt?: string | null;
  updatedAt: string;
  fiscalYear?: { id: string; label: string } | null;
  scenarios?: { id: string; name: string; isDefault: boolean }[];
  _count?: { lines?: number };
};

const TYPE_HUE: Record<PlanType, string> = {
  BUDGET: "var(--os-c-indigo)", FORECAST: "var(--os-c-blue)",
  STRATEGIC: "var(--os-c-purple)", WHAT_IF: "var(--os-c-orange)",
};
const TYPE_LABEL: Record<PlanType, string> = {
  BUDGET: "Budget", FORECAST: "Forecast", STRATEGIC: "Strategic", WHAT_IF: "What-if",
};
const STATUS_LABEL: Record<PlanStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived", PUBLISHED: "Published",
};
const STATUS_HUE: Record<PlanStatus, string> = {
  DRAFT: "var(--os-c-orange)", ACTIVE: "var(--os-c-green)",
  PUBLISHED: "var(--os-c-blue)", ARCHIVED: "var(--os-ink-3)",
};
const STATUS_ICON: Record<PlanStatus, typeof Edit3> = {
  DRAFT: Edit3, ACTIVE: CheckCircle2, PUBLISHED: TrendingUp, ARCHIVED: Archive,
};

export default function BudgetPlansPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | PlanType>("ALL");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/budget-plans");
      if (res.status === 403) { setLoadError("Org-admin access required to view budget plans."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("planning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = plans ?? [];
    const counts: Record<PlanType, number> = { BUDGET: 0, FORECAST: 0, STRATEGIC: 0, WHAT_IF: 0 };
    for (const p of list) counts[p.type] = (counts[p.type] ?? 0) + 1;
    const active = list.filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;
    const draft = list.filter((p) => p.status === "DRAFT").length;
    const fy = new Set(list.map((p) => p.fiscalYear?.label).filter(Boolean));
    return { total: list.length, active, draft, fyCount: fy.size, counts };
  }, [plans]);

  const filtered = useMemo(() => {
    let list = plans ?? [];
    if (typeFilter !== "ALL") list = list.filter((p) => p.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      (p.fiscalYear?.label ?? "").toLowerCase().includes(q));
    return list;
  }, [plans, typeFilter, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiPlan[]>();
    for (const p of filtered) {
      const k = p.fiscalYear?.label ?? "No fiscal year";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Budget plans"
        Icon={ScrollText}
        iconGradient={GRAD.purpleIndigo}
        description={plans === null ? "Loading…" : `${stats.total} plan${stats.total === 1 ? "" : "s"} · ${stats.active} active · ${stats.fyCount} fiscal year${stats.fyCount === 1 ? "" : "s"}`}
        actions={
          <div className="plans__head-actions">
            <Link href="/planning" className="plans__nav-link"><Hash /> Planning</Link>
            <Link href="/planning/variance" className="plans__nav-link"><TrendingUp /> Variance</Link>
            <Link href="/financials" className="plans__nav-link"><Coins /> Finance</Link>
            <button type="button" className="plans__btn-primary" onClick={() => toast("Pick a fiscal year first in /financials/calendar")}>
              <Plus /> New plan
            </button>
          </div>
        }
      />

      <div className="plans">
        <div className="plans__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Active"    value={`${stats.active}`} sub={`${stats.total} total`} />
          <KpiTile accent="var(--os-c-indigo)" Icon={ScrollText}   label="Budgets"   value={`${stats.counts.BUDGET}`}    sub="annual plans" />
          <KpiTile accent="var(--os-c-blue)"   Icon={TrendingUp}   label="Forecasts" value={`${stats.counts.FORECAST}`}  sub="rolling" />
          <KpiTile accent="var(--os-c-orange)" Icon={Edit3}        label="Drafts"    value={`${stats.draft}`}            sub="not yet active" />
        </div>

        <div className="plans__toolbar">
          <div className="plans__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plan, description, fiscal year…" />
          </div>
          <div className="plans__filters">
            {(["ALL", "BUDGET", "FORECAST", "STRATEGIC", "WHAT_IF"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`plans__filter${typeFilter === t ? " is-active" : ""}`}
                style={t !== "ALL" ? { ["--f-c" as unknown as string]: TYPE_HUE[t as PlanType] } : undefined}
                onClick={() => setTypeFilter(t)}
              >
                {t === "ALL" ? "All" : TYPE_LABEL[t as PlanType]}
                <span>{t === "ALL" ? stats.total : stats.counts[t as PlanType]}</span>
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={ScrollText} iconGradient={GRAD.redPink} title="Couldn't load plans" subtitle={loadError} cta="Retry" />
        ) : plans === null ? (
          <div className="plans__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={ScrollText}
            iconGradient={GRAD.purpleIndigo}
            title="No budget plans yet"
            subtitle="Set up a fiscal year first, then create a Budget / Forecast / Strategic plan against it. Each plan has versions and one or more scenarios."
            chips={["Budget", "Forecast", "Strategic", "What-if"]}
            cta="Open fiscal calendar"
          />
        ) : grouped.length === 0 ? (
          <div className="plans__no-match"><Search /> No plans match the current filter.</div>
        ) : (
          grouped.map(([fyLabel, items]) => (
            <section key={fyLabel} className="plans__group">
              <header className="plans__group-head">
                <h2>{fyLabel}</h2>
                <span className="plans__group-count">{items.length} plan{items.length === 1 ? "" : "s"}</span>
                <span className="plans__group-line" />
              </header>
              <div className="plans__grid">
                {items.map((p) => <PlanCard key={p.id} p={p} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function PlanCard({ p }: { p: ApiPlan }) {
  const StatusIcon = STATUS_ICON[p.status];
  return (
    <Link href={`/planning/${p.id}`} className="plans__card" style={{ ["--card-c" as unknown as string]: TYPE_HUE[p.type] }}>
      <header className="plans__card-head">
        <span className="plans__card-type">{TYPE_LABEL[p.type]}</span>
        <span className="plans__card-status" style={{ ["--s-c" as unknown as string]: STATUS_HUE[p.status] }}>
          <StatusIcon /> {STATUS_LABEL[p.status]}
        </span>
      </header>
      <h3 className="plans__card-name">{p.name}</h3>
      {p.description && <p className="plans__card-desc">{p.description.length > 120 ? p.description.slice(0, 120) + "…" : p.description}</p>}
      <div className="plans__card-meta">
        <span><Layers /> v{p.version}</span>
        <span><Activity /> {p.scenarios?.length ?? 0} scenario{(p.scenarios?.length ?? 0) === 1 ? "" : "s"}</span>
        <span>{p._count?.lines ?? 0} line{(p._count?.lines ?? 0) === 1 ? "" : "s"}</span>
      </div>
      <footer className="plans__card-foot">
        <span>Updated {new Date(p.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <ChevronRight />
      </footer>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof ScrollText; label: string; value: string; sub: string }) {
  return (
    <div className="plans__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="plans__kpi-accent" aria-hidden="true" />
      <div className="plans__kpi-row">
        <div className="plans__kpi-icon"><Icon /></div>
        <div className="plans__kpi-label">{label}</div>
      </div>
      <div className="plans__kpi-value">{value}</div>
      <div className="plans__kpi-sub">{sub}</div>
    </div>
  );
}
