"use client";

/* Plan variance — plan vs actual per account for the selected plan/scenario/period.
 *
 * GET /api/financials/variance?plan=<id>&scenario=<id>&period=<id>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Coins, ScrollText, Hash, CalendarRange,
  Activity, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type AcctType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

type ApiPlan = {
  id: string;
  name: string;
  status: string;
  scenarios?: { id: string; name: string; isDefault: boolean }[];
  fiscalYear?: { id: string; label: string; periods?: { id: string; label: string; startDate: string; endDate: string; status: string }[] } | null;
};

type ApiVarianceRow = {
  account: { id: string; code: string; name: string; type: AcctType };
  planned: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  favorable: boolean | null;
};

type ApiVariance = {
  plan: { id: string; name: string };
  scenario: { id: string; name: string };
  period: { id: string; label: string };
  rows: ApiVarianceRow[];
  summary: { totalPlanned: number; totalActual: number; totalVariance: number };
};

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export default function VariancePage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [planId, setPlanId] = useState<string>("");
  const [scenarioId, setScenarioId] = useState<string>("");
  const [periodId, setPeriodId] = useState<string>("");
  const [variance, setVariance] = useState<ApiVariance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const loadPlans = useCallback(async () => {
    try {
      const r = await fetch("/api/budget-plans");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const list: ApiPlan[] = d.data ?? (Array.isArray(d) ? d : []);
      setPlans(list);
      if (list.length > 0 && !planId) {
        const first = list.find((p) => p.status === "ACTIVE" || p.status === "PUBLISHED") ?? list[0];
        setPlanId(first.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [planId]);
  useEffect(() => { void loadPlans(); }, [loadPlans]);
  const v = rowVersion("planning");
  useEffect(() => { if (v > 0) void loadPlans(); }, [v, loadPlans]);

  const activePlan = useMemo(() => (plans ?? []).find((p) => p.id === planId), [plans, planId]);

  useEffect(() => {
    if (!activePlan) return;
    if (!scenarioId) {
      const def = activePlan.scenarios?.find((s) => s.isDefault) ?? activePlan.scenarios?.[0];
      if (def) setScenarioId(def.id);
    }
    if (!periodId) {
      const periods = activePlan.fiscalYear?.periods ?? [];
      if (periods.length > 0) {
        const now = Date.now();
        const current = periods.find((p) =>
          new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime()
        );
        setPeriodId((current ?? periods[periods.length - 1]).id);
      }
    }
  }, [activePlan, scenarioId, periodId]);

  const loadVariance = useCallback(async () => {
    if (!planId || !scenarioId || !periodId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/financials/variance?plan=${planId}&scenario=${scenarioId}&period=${periodId}`);
      if (!r.ok) {
        setError(r.status === 403 ? "Org-admin access required" : `HTTP ${r.status}`);
        setVariance(null);
        return;
      }
      const d = await r.json();
      setVariance(d.data ?? d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setBusy(false);
    }
  }, [planId, scenarioId, periodId]);
  useEffect(() => { void loadVariance(); }, [loadVariance]);

  const grouped = useMemo(() => {
    if (!variance) return null;
    const byType = new Map<AcctType, ApiVarianceRow[]>();
    for (const r of variance.rows) {
      if (!byType.has(r.account.type)) byType.set(r.account.type, []);
      byType.get(r.account.type)!.push(r);
    }
    const order: AcctType[] = ["REVENUE", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"];
    return order
      .filter((t) => byType.has(t))
      .map((t) => ({
        type: t,
        rows: byType.get(t) ?? [],
        planned: (byType.get(t) ?? []).reduce((a, r) => a + r.planned, 0),
        actual: (byType.get(t) ?? []).reduce((a, r) => a + r.actual, 0),
        variance: (byType.get(t) ?? []).reduce((a, r) => a + r.variance, 0),
      }));
  }, [variance]);

  const summary = variance?.summary;
  const overallFav = summary ? summary.totalVariance >= 0 : null;

  return (
    <>
      <OsTitleBar
        title="Plan variance"
        Icon={TrendingDown}
        iconGradient={GRAD.orangePink}
        description={variance ? `${variance.plan.name} · ${variance.scenario.name} · ${variance.period.label}` : "Pick a plan, scenario, and period"}
        actions={
          <div className="var__head-actions">
            <Link href="/planning" className="var__nav-link"><Hash /> Planning</Link>
            <Link href="/planning/plans" className="var__nav-link"><ScrollText /> Plans</Link>
            <Link href="/financials" className="var__nav-link"><Coins /> Finance</Link>
          </div>
        }
      />

      <div className="var">
        {plans === null ? (
          <div className="var__loading">Loading plans…</div>
        ) : (plans ?? []).length === 0 ? (
          <OsEmptyView
            Icon={ScrollText}
            iconGradient={GRAD.purpleIndigo}
            title="No budget plans yet"
            subtitle="Variance compares planned numbers from a budget against posted actuals. Create a plan first."
            chips={["Plan", "Scenario", "Period"]}
            cta="New plan"
          />
        ) : (
          <>
            <section className="var__toolbar">
              <label className="var__field">
                <span>Plan</span>
                <select value={planId} onChange={(e) => { setPlanId(e.target.value); setScenarioId(""); setPeriodId(""); }}>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="var__field">
                <span>Scenario</span>
                <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} disabled={!activePlan?.scenarios?.length}>
                  {(activePlan?.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.isDefault ? " (default)" : ""}</option>)}
                </select>
              </label>
              <label className="var__field">
                <span>Period</span>
                <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} disabled={!activePlan?.fiscalYear?.periods?.length}>
                  {(activePlan?.fiscalYear?.periods ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              {activePlan?.fiscalYear && (
                <span className="var__fy"><CalendarRange /> {activePlan.fiscalYear.label}</span>
              )}
            </section>

            {error ? (
              <OsEmptyView Icon={TrendingDown} iconGradient={GRAD.redPink} title="Couldn't load variance" subtitle={error} cta="Retry" />
            ) : busy ? (
              <div className="var__loading">Computing variance…</div>
            ) : !variance ? (
              <div className="var__placeholder">Pick a plan, scenario, and period to compute variance.</div>
            ) : (
              <>
                <div className="var__kpis">
                  <KpiTile accent="var(--os-c-indigo)" Icon={ScrollText}  label="Planned" value={money(summary?.totalPlanned ?? 0)} sub="across accounts" />
                  <KpiTile accent="var(--os-c-blue)"   Icon={Activity}    label="Actual"  value={money(summary?.totalActual ?? 0)}  sub="posted to GL" />
                  <KpiTile
                    accent={overallFav ? "var(--os-c-green)" : "var(--os-c-red)"}
                    Icon={overallFav ? TrendingUp : TrendingDown}
                    label="Variance"
                    value={money(summary?.totalVariance ?? 0)}
                    sub={overallFav ? "favorable" : "unfavorable"}
                  />
                  <KpiTile
                    accent={overallFav ? "var(--os-c-green)" : "var(--os-c-orange)"}
                    Icon={overallFav ? CheckCircle2 : AlertTriangle}
                    label="Status"
                    value={overallFav ? "On plan" : "Off plan"}
                    sub={summary?.totalPlanned ? `${Math.round(((summary.totalActual / summary.totalPlanned) - 1) * 100)}% vs plan` : "—"}
                  />
                </div>

                {grouped && grouped.length > 0 && (
                  <div className="var__sections">
                    {grouped.map((g) => (
                      <section key={g.type} className={`var__section var__section--${g.type.toLowerCase()}`}>
                        <header className="var__section-head">
                          <span className="var__section-tag">{g.type === "REVENUE" ? <TrendingUp /> : <TrendingDown />} {g.type}</span>
                          <span className="var__section-line" />
                          <span className="var__section-tot">{g.rows.length} accounts</span>
                        </header>
                        <div className="var__table">
                          <div className="var__row var__row--head">
                            <span>Account</span>
                            <span className="text-right">Planned</span>
                            <span className="text-right">Actual</span>
                            <span className="text-right">Variance</span>
                            <span className="text-right">%</span>
                          </div>
                          {g.rows.map((r) => {
                            const fav = r.favorable;
                            const cls = fav === null ? "" : fav ? "is-fav" : "is-unfav";
                            return (
                              <div key={r.account.id} className={`var__row ${cls}`}>
                                <span className="var__row-acct">
                                  <code>{r.account.code}</code>
                                  <span>{r.account.name}</span>
                                </span>
                                <span className="var__row-num text-right">{money(r.planned)}</span>
                                <span className="var__row-num text-right">{money(r.actual)}</span>
                                <span className="var__row-num var__row-var text-right">{money(r.variance)}</span>
                                <span className="var__row-pct text-right">{r.variancePct !== null ? `${r.variancePct >= 0 ? "+" : ""}${r.variancePct.toFixed(1)}%` : "—"}</span>
                              </div>
                            );
                          })}
                          <div className="var__row var__row--foot">
                            <span>Subtotal</span>
                            <span className="var__row-num text-right">{money(g.planned)}</span>
                            <span className="var__row-num text-right">{money(g.actual)}</span>
                            <span className="var__row-num text-right">{money(g.variance)}</span>
                            <span></span>
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof TrendingDown; label: string; value: string; sub: string }) {
  return (
    <div className="var__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="var__kpi-accent" aria-hidden="true" />
      <div className="var__kpi-row">
        <div className="var__kpi-icon"><Icon /></div>
        <div className="var__kpi-label">{label}</div>
      </div>
      <div className="var__kpi-value">{value}</div>
      <div className="var__kpi-sub">{sub}</div>
    </div>
  );
}

