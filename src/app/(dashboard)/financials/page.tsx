"use client";

/* Finance hub — bespoke overview with KPI strip + statement tiles + period status.
 *
 * Reads in parallel: gl-accounts, journal-entries, accounting-periods,
 * budget-plans, purchase-orders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet, BookText, CalendarRange, ScrollText, ShoppingCart, FileBarChart,
  Receipt, ChevronRight, Coins, TrendingUp, Layers, Activity, Hash, CheckCircle2, Clock,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiAcct = { id: string; active: boolean; type?: string };
type ApiEntry = { id: string; status: string; postedAt: string };
type ApiPeriod = { id: string; label: string; status: string; startDate: string; endDate: string };
type ApiPlan = { id: string; status: string };
type ApiPO = { id: string; status: string; total?: number | string };

export default function FinancialsHubPage() {
  const [accts, setAccts] = useState<ApiAcct[] | null>(null);
  const [entries, setEntries] = useState<ApiEntry[] | null>(null);
  const [periods, setPeriods] = useState<ApiPeriod[] | null>(null);
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [pos, setPos] = useState<ApiPO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [a, e, p, b, po] = await Promise.all([
        fetch("/api/gl-accounts?includeInactive=1").catch(() => null),
        fetch("/api/journal-entries?limit=200").catch(() => null),
        fetch("/api/accounting-periods").catch(() => null),
        fetch("/api/budget-plans").catch(() => null),
        fetch("/api/purchase-orders?limit=100").catch(() => null),
      ]);
      const unwrap = async (r: Response | null) => {
        if (!r || !r.ok) return [];
        const d = await r.json();
        return d.data ?? (Array.isArray(d) ? d : []);
      };
      setAccts(await unwrap(a));
      setEntries(await unwrap(e));
      setPeriods(await unwrap(p));
      setPlans(await unwrap(b));
      setPos(await unwrap(po));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const active = (accts ?? []).filter((a) => a.active).length;
    const acctTotal = accts?.length ?? 0;
    const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
    const entriesMonth = (entries ?? []).filter((e) => new Date(e.postedAt).getTime() >= thisMonth.getTime());
    const posted = entriesMonth.filter((e) => e.status === "POSTED").length;
    const drafts = entriesMonth.filter((e) => e.status === "DRAFT").length;
    const now = Date.now();
    const currentPeriod = (periods ?? []).find((p) => new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime());
    const openPeriods = (periods ?? []).filter((p) => p.status === "OPEN" || p.status === "REOPENED").length;
    const closedPeriods = (periods ?? []).filter((p) => p.status === "CLOSED").length;
    const activePlans = (plans ?? []).filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;
    const openPos = (pos ?? []).filter((p) => p.status !== "CLOSED" && p.status !== "RECEIVED" && p.status !== "CANCELLED").length;
    const poValue = (pos ?? []).reduce((acc, p) => acc + (typeof p.total === "string" ? parseFloat(p.total) : (p.total ?? 0)), 0);
    return { active, acctTotal, postedMonth: posted, draftsMonth: drafts, currentPeriod, openPeriods, closedPeriods, totalPeriods: periods?.length ?? 0, activePlans, totalPlans: plans?.length ?? 0, openPos, totalPos: pos?.length ?? 0, poValue };
  }, [accts, entries, periods, plans, pos]);

  const loading = accts === null || entries === null || periods === null || plans === null;

  const monthLabel = new Date().toLocaleDateString("en", { month: "long", year: "numeric" });

  const periodList = useMemo(() => {
    const sorted = (periods ?? []).slice().sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    return sorted.slice(0, 6);
  }, [periods]);

  return (
    <>
      <OsTitleBar
        title="Finance"
        Icon={Coins}
        iconGradient={GRAD.greenTeal}
        description={loading ? "Computing your books…" : `${stats.acctTotal} GL accounts · ${stats.postedMonth} posted in ${monthLabel} · ${stats.openPeriods} open period${stats.openPeriods === 1 ? "" : "s"}`}
        actions={
          <div className="fin__head-actions">
            <Link href="/financials/statements" className="fin__nav-link"><Receipt /> Statements</Link>
            <Link href="/financials/reports" className="fin__nav-link"><FileBarChart /> Reports</Link>
            <Link href="/financials/entries" className="fin__btn-primary"><BookText /> New entry</Link>
          </div>
        }
      />

      <div className="fin">
        {error && <div className="fin__error">{error}</div>}

        <div className="fin__kpis">
          <KpiTile accent="var(--os-c-sage)"   Icon={Wallet}     label="GL accounts"      value={`${stats.acctTotal}`}    sub={`${stats.active} active`} />
          <KpiTile accent="var(--os-c-indigo)" Icon={BookText}   label="Posted this month" value={`${stats.postedMonth}`}  sub={`${stats.draftsMonth} draft${stats.draftsMonth === 1 ? "" : "s"}`} />
          <KpiTile accent="var(--os-c-orange)" Icon={CalendarRange} label="Open periods"     value={`${stats.openPeriods}`}  sub={`${stats.closedPeriods} closed · ${stats.totalPeriods} total`} />
          <KpiTile accent="var(--os-c-brown)"  Icon={ShoppingCart}  label="PO commitments"   value={fmtMoney(stats.poValue)} sub={`${stats.openPos} open of ${stats.totalPos}`} />
        </div>

        {stats.currentPeriod && (
          <section className="fin__period-card" style={{ ["--per-c" as unknown as string]: "var(--os-c-orange)" }}>
            <div className="fin__period-main">
              <span className="fin__period-tag"><Activity /> Current period</span>
              <h2>{stats.currentPeriod.label}</h2>
              <div className="fin__period-meta">
                <span><CalendarRange /> {new Date(stats.currentPeriod.startDate).toLocaleDateString()} → {new Date(stats.currentPeriod.endDate).toLocaleDateString()}</span>
                <span className={`fin__period-status fin__period-status--${stats.currentPeriod.status.toLowerCase()}`}>
                  {stats.currentPeriod.status === "OPEN" ? <CheckCircle2 /> : <Clock />} {stats.currentPeriod.status}
                </span>
              </div>
            </div>
            <Link href="/financials/calendar" className="fin__period-link">View calendar <ChevronRight /></Link>
          </section>
        )}

        <section className="fin__section">
          <header className="fin__section-head">
            <h2><Hash /> Books</h2>
            <span className="fin__section-line" />
          </header>
          <div className="fin__grid">
            <FinTile href="/financials/accounts" Icon={Wallet} hue="var(--os-c-sage)"
              title="Chart of accounts" stat={`${stats.acctTotal}`} sub={`${stats.active} active · 5 buckets`} />
            <FinTile href="/financials/entries" Icon={BookText} hue="var(--os-c-indigo)"
              title="Journal entries" stat={`${stats.postedMonth}`} sub={`posted in ${monthLabel}`} />
            <FinTile href="/financials/calendar" Icon={CalendarRange} hue="var(--os-c-orange)"
              title="Accounting periods" stat={stats.currentPeriod?.label ?? "—"} sub={stats.currentPeriod ? `current · ${stats.openPeriods} open` : `${stats.openPeriods} open`} />
            <FinTile href="/financials/statements" Icon={Receipt} hue="var(--os-c-blue)"
              title="Statements" stat="P&L · BS · CF" sub="generate for any period" />
          </div>
        </section>

        <section className="fin__section">
          <header className="fin__section-head">
            <h2><Layers /> Plan vs Spend</h2>
            <span className="fin__section-line" />
          </header>
          <div className="fin__grid">
            <FinTile href="/planning/plans" Icon={ScrollText} hue="var(--os-c-purple)"
              title="Budget plans" stat={`${stats.activePlans}`} sub={`active · ${stats.totalPlans} total`} />
            <FinTile href="/planning/variance" Icon={TrendingUp} hue="var(--os-c-red)"
              title="Variance" stat="—" sub="plan vs actual" />
            <FinTile href="/procurement/pos" Icon={ShoppingCart} hue="var(--os-c-brown)"
              title="Purchase orders" stat={`${stats.openPos}`} sub={`open · ${stats.totalPos} total`} />
            <FinTile href="/financials/reports" Icon={FileBarChart} hue="var(--os-c-pink)"
              title="Reports" stat="—" sub="dashboards · drill-ins" />
          </div>
        </section>

        {periodList.length > 0 && (
          <section className="fin__section">
            <header className="fin__section-head">
              <h2><CalendarRange /> Recent periods</h2>
              <span className="fin__section-line" />
              <Link href="/financials/calendar" className="fin__section-more">all <ChevronRight /></Link>
            </header>
            <div className="fin__periods">
              {periodList.map((p) => (
                <div key={p.id} className={`fin__period fin__period--${p.status.toLowerCase()}`}>
                  <span className="fin__period-label">{p.label}</span>
                  <span className="fin__period-dates">{new Date(p.startDate).toLocaleDateString()} → {new Date(p.endDate).toLocaleDateString()}</span>
                  <span className="fin__period-pill">{p.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Coins; label: string; value: string; sub: string }) {
  return (
    <div className="fin__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="fin__kpi-accent" aria-hidden="true" />
      <div className="fin__kpi-row">
        <div className="fin__kpi-icon"><Icon /></div>
        <div className="fin__kpi-label">{label}</div>
      </div>
      <div className="fin__kpi-value">{value}</div>
      <div className="fin__kpi-sub">{sub}</div>
    </div>
  );
}

function FinTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof Coins; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="fin__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="fin__tile-icon"><Icon /></span>
      <div className="fin__tile-body">
        <div className="fin__tile-title">{title}</div>
        <div className="fin__tile-stat">{stat}</div>
        <div className="fin__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="fin__tile-chev" />
    </Link>
  );
}
