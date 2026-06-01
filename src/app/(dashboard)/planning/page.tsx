"use client";

/* Planning hub — overview of plans + variance + workforce. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ScrollText, TrendingUp, Users as UsersIcon, ChevronRight, Layers, CalendarRange,
  Activity, Hash, Coins, TrendingDown, CheckCircle2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiPlan = {
  id: string;
  name?: string;
  status: string;
  fiscalYear?: { label: string };
  totalBudget?: number | string;
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}
function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default function PlanningHubPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/budget-plans");
      if (!r.ok) { setPlans([]); return; }
      const d = await r.json();
      setPlans(d.data ?? (Array.isArray(d) ? d : []));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("planning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = plans ?? [];
    const active = list.filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;
    const draft = list.filter((p) => p.status === "DRAFT").length;
    const closed = list.filter((p) => p.status === "CLOSED" || p.status === "ARCHIVED").length;
    const fy = new Set(list.map((p) => p.fiscalYear?.label).filter(Boolean));
    const totalBudget = list.reduce((a, p) => a + num(p.totalBudget), 0);
    return { total: list.length, active, draft, closed, fyCount: fy.size, totalBudget };
  }, [plans]);

  return (
    <>
      <OsTitleBar
        title="Planning"
        Icon={Layers}
        iconGradient={GRAD.purpleIndigo}
        description={plans === null ? "Loading plans…" : `${stats.active} active plan${stats.active === 1 ? "" : "s"} · ${stats.fyCount} fiscal year${stats.fyCount === 1 ? "" : "s"} · ${money(stats.totalBudget)} budgeted`}
        actions={
          <div className="plan__head-actions">
            <Link href="/planning/plans" className="plan__nav-link"><ScrollText /> Plans</Link>
            <Link href="/planning/variance" className="plan__nav-link"><TrendingUp /> Variance</Link>
            <Link href="/financials" className="plan__nav-link"><Coins /> Finance</Link>
          </div>
        }
      />

      <div className="plan">
        {error && (
          <OsEmptyView Icon={Layers} iconGradient={GRAD.redPink} title="Couldn't load planning" subtitle={error} cta="Retry" />
        )}

        {!error && (
          <>
            <div className="plan__kpis">
              <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Active plans"  value={`${stats.active}`}   sub={`${stats.total} total`} />
              <KpiTile accent="var(--os-c-purple)" Icon={Coins}        label="Budgeted"      value={money(stats.totalBudget)} sub="across plans" />
              <KpiTile accent="var(--os-c-orange)" Icon={Activity}     label="Drafts"        value={`${stats.draft}`}    sub="not yet active" />
              <KpiTile accent="var(--os-c-blue)"   Icon={CalendarRange} label="Fiscal years" value={`${stats.fyCount}`}  sub="covered" />
            </div>

            <section className="plan__section">
              <header className="plan__section-head">
                <h2><Hash /> Workspaces</h2>
                <span className="plan__section-line" />
              </header>
              <div className="plan__grid">
                <HubTile href="/planning/plans" Icon={ScrollText} hue="var(--os-c-indigo)"
                  title="Budget plans" stat={`${stats.active}`} sub={`active · ${stats.total} total`} />
                <HubTile href="/planning/variance" Icon={TrendingDown} hue="var(--os-c-orange)"
                  title="Plan variance" stat="Plan vs actual" sub="per account · per month" />
                <HubTile href="/workforce-planning" Icon={UsersIcon} hue="var(--os-c-pink)"
                  title="Workforce plan" stat="Headcount" sub="salary + role budget" />
                <HubTile href="/financials/calendar" Icon={CalendarRange} hue="var(--os-c-teal)"
                  title="Periods" stat="Fiscal calendar" sub="open & close" />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Layers; label: string; value: string; sub: string }) {
  return (
    <div className="plan__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="plan__kpi-accent" aria-hidden="true" />
      <div className="plan__kpi-row">
        <div className="plan__kpi-icon"><Icon /></div>
        <div className="plan__kpi-label">{label}</div>
      </div>
      <div className="plan__kpi-value">{value}</div>
      <div className="plan__kpi-sub">{sub}</div>
    </div>
  );
}

function HubTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof Layers; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="plan__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="plan__tile-icon"><Icon /></span>
      <div className="plan__tile-body">
        <div className="plan__tile-title">{title}</div>
        <div className="plan__tile-stat">{stat}</div>
        <div className="plan__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="plan__tile-chev" />
    </Link>
  );
}
