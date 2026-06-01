"use client";

/* Workforce planning — headcount + salary plans grouped by period.
 *
 *  GET  /api/headcount-plans
 *  POST /api/headcount-plans
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart, Plus, Users, Coins, TrendingUp, ChevronRight, Hash,
  CalendarRange, Activity, Building, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPlan = {
  id: string;
  period: string;
  departmentId: string | null;
  plannedHeadcount: number;
  plannedBudget: number | null;
  budgetCurrency: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  department?: { id: string; name: string } | null;
};

const PALETTE = [C.indigo, C.purple, C.blue, C.teal, C.green, C.orange, C.pink];
function periodColor(period: string): string {
  let h = 0; for (let i = 0; i < period.length; i++) h = (h * 31 + period.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function fmtMoney(n: number, cur: string): string {
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur === "INR" ? "₹" : "";
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`;
  return `${sym}${Math.round(n)}`;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function WorkforcePlanningPage() {
  const [rows, setRows] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/headcount-plans");
      if (res.status === 403) {
        setLoadError("Workforce planning requires manager-level access.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("workforce-planning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/headcount-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: currentPeriod(), plannedHeadcount: 0, budgetCurrency: "USD" }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Org-admin access required" : "Couldn't create"); return; }
      toast("Plan created — edit headcount + budget");
      void load();
    } catch { toast("Couldn't create"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const totalHeadcount = list.reduce((a, p) => a + p.plannedHeadcount, 0);
    const totalBudget = list.reduce((a, p) => a + (p.plannedBudget ?? 0), 0);
    const periods = new Set(list.map((p) => p.period));
    const departments = new Set(list.map((p) => p.department?.name).filter(Boolean));
    const orgWide = list.filter((p) => !p.departmentId).length;
    const cur = list[0]?.budgetCurrency ?? "USD";
    return { total: list.length, totalHeadcount, totalBudget, periods: periods.size, departments: departments.size, orgWide, cur };
  }, [rows]);

  const periodTabs = useMemo(() => {
    const m = new Map<string, ApiPlan[]>();
    for (const p of rows ?? []) {
      if (!m.has(p.period)) m.set(p.period, []);
      m.get(p.period)!.push(p);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (activePeriod) list = list.filter((p) => p.period === activePeriod);
    return list;
  }, [rows, activePeriod]);

  const groupedByPeriod = useMemo(() => {
    const m = new Map<string, ApiPlan[]>();
    for (const p of filtered) {
      if (!m.has(p.period)) m.set(p.period, []);
      m.get(p.period)!.push(p);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([period, items]) => ({
        period,
        color: periodColor(period),
        items: items.slice().sort((a, b) => (a.department?.name ?? "Org-wide").localeCompare(b.department?.name ?? "Org-wide")),
      }));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Workforce planning"
        Icon={LineChart}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading plans…" : `${stats.total} plan${stats.total === 1 ? "" : "s"} · ${stats.totalHeadcount} planned headcount · ${fmtMoney(stats.totalBudget, stats.cur)} budget`}
        actions={
          <div className="wfp__head-actions">
            <Link href="/planning" className="wfp__nav-link"><Hash /> Planning</Link>
            <Link href="/people" className="wfp__nav-link"><Users /> People</Link>
            <Link href="/planning/variance" className="wfp__nav-link"><TrendingUp /> Variance</Link>
            <button type="button" className="wfp__btn-primary" onClick={quickAdd}>
              <Plus /> New plan
            </button>
          </div>
        }
      />

      <div className="wfp">
        <div className="wfp__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={Users}        label="Planned headcount" value={`${stats.totalHeadcount}`} sub={`across ${stats.departments || "all"} dept${stats.departments === 1 ? "" : "s"}`} />
          <KpiTile accent="var(--os-c-green)"  Icon={Coins}         label="Salary budget"    value={fmtMoney(stats.totalBudget, stats.cur)} sub="rolled up" />
          <KpiTile accent="var(--os-c-purple)" Icon={CalendarRange} label="Periods"          value={`${stats.periods}`}    sub="months covered" />
          <KpiTile accent="var(--os-c-orange)" Icon={Building}      label="Departments"     value={`${stats.departments}`} sub={`${stats.orgWide} org-wide row${stats.orgWide === 1 ? "" : "s"}`} />
        </div>

        {periodTabs.length > 0 && (
          <div className="wfp__periods">
            <button type="button" className={`wfp__period${activePeriod === null ? " is-active" : ""}`} onClick={() => setActivePeriod(null)}>
              <Layers /> All periods <span>{stats.total}</span>
            </button>
            {periodTabs.map(([period, items]) => (
              <button
                key={period}
                type="button"
                className={`wfp__period${activePeriod === period ? " is-active" : ""}`}
                style={{ ["--p-c" as unknown as string]: periodColor(period) }}
                onClick={() => setActivePeriod(activePeriod === period ? null : period)}
              >
                <span className="wfp__period-dot" />
                {period}
                <span>{items.length}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={LineChart} iconGradient={GRAD.redPink} title="Couldn't load plans" subtitle={loadError} cta="Back" />
        ) : rows === null ? (
          <div className="wfp__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={LineChart}
            iconGradient={GRAD.indigoBlue}
            title="No headcount plans yet"
            subtitle="Set planned headcount and salary budget per department, per period. Track variance vs actual hires."
            chips={["Per-department", "Per-period", "Budget", "Variance"]}
            cta="New plan"
          />
        ) : (
          groupedByPeriod.map((g) => {
            const totalHc = g.items.reduce((a, p) => a + p.plannedHeadcount, 0);
            const totalBg = g.items.reduce((a, p) => a + (p.plannedBudget ?? 0), 0);
            return (
              <section key={g.period} className="wfp__group" style={{ ["--g-c" as unknown as string]: g.color }}>
                <header className="wfp__group-head">
                  <span className="wfp__group-dot" />
                  <h2>{g.period}</h2>
                  <span className="wfp__group-count">{g.items.length} row{g.items.length === 1 ? "" : "s"}</span>
                  <span className="wfp__group-line" />
                  <span className="wfp__group-totals">
                    <strong>{totalHc}</strong> HC · <strong>{fmtMoney(totalBg, g.items[0]?.budgetCurrency ?? stats.cur)}</strong>
                  </span>
                </header>
                <div className="wfp__table">
                  <div className="wfp__row wfp__row--head">
                    <span>Department</span>
                    <span className="text-right">Headcount</span>
                    <span className="text-right">Budget</span>
                    <span>Notes</span>
                    <span></span>
                  </div>
                  {g.items.map((p) => (
                    <div key={p.id} className="wfp__row">
                      <span className="wfp__row-dept">
                        {p.department ? <Building /> : <Activity />}
                        {p.department?.name ?? "Org-wide"}
                      </span>
                      <span className="wfp__row-num text-right">{p.plannedHeadcount}</span>
                      <span className="wfp__row-num text-right">{p.plannedBudget != null ? fmtMoney(p.plannedBudget, p.budgetCurrency) : "—"}</span>
                      <span className="wfp__row-notes">{p.notes ?? "—"}</span>
                      <ChevronRight className="wfp__row-arrow" />
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof LineChart; label: string; value: string; sub: string }) {
  return (
    <div className="wfp__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="wfp__kpi-accent" aria-hidden="true" />
      <div className="wfp__kpi-row">
        <div className="wfp__kpi-icon"><Icon /></div>
        <div className="wfp__kpi-label">{label}</div>
      </div>
      <div className="wfp__kpi-value">{value}</div>
      <div className="wfp__kpi-sub">{sub}</div>
    </div>
  );
}
