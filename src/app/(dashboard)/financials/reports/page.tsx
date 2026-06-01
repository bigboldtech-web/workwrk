"use client";

/* Finance · Reports — launchpad for financial statements + analytics.
 *
 * Pulls live summary numbers from /api/financial-reports so each tile
 * shows real totals for the current YTD range. Click any tile to open
 * the full statement view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileBarChart, Coins, BookText, ChevronRight, Receipt, TrendingUp, TrendingDown,
  Scale, Briefcase, CalendarRange, Activity, Layers, Hash, Wallet,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type TrialBalance = { totalDebits: number; totalCredits: number; delta: number; rows: { id: string; type: string }[] };
type IncomeStatement = { totalRevenue: number; totalExpense: number; netIncome: number };
type BalanceSheet = { totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number; delta: number };

function money(n: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (opts?.compact) {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  return `${sign}$${new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(abs)}`;
}

function ytdRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), 0, 1);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    label: `YTD ${now.getFullYear()}`,
  };
}

export default function FinancialReportsPage() {
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [is, setIs] = useState<IncomeStatement | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const range = useMemo(ytdRange, []);

  const load = useCallback(async () => {
    try {
      const q = `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      const [a, b, c] = await Promise.all([
        fetch(`/api/financial-reports${q}&report=trial-balance`).catch(() => null),
        fetch(`/api/financial-reports${q}&report=income-statement`).catch(() => null),
        fetch(`/api/financial-reports${q}&report=balance-sheet`).catch(() => null),
      ]);
      const unwrap = async (r: Response | null) => {
        if (!r || !r.ok) return null;
        const d = await r.json();
        return d.data ?? d;
      };
      const [tbD, isD, bsD] = await Promise.all([unwrap(a), unwrap(b), unwrap(c)]);
      if (tbD === null && isD === null && bsD === null) {
        setLoadError("Couldn't reach the financial reports API.");
      } else {
        setLoadError(null);
        setTb(tbD as TrialBalance);
        setIs(isD as IncomeStatement);
        setBs(bsD as BalanceSheet);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const loading = tb === null && is === null && bs === null && !loadError;

  const isHealthy = tb ? Math.abs(tb.delta) < 0.01 : true;
  const bsHealthy = bs ? Math.abs(bs.delta) < 0.01 : true;
  const margin = is && is.totalRevenue !== 0 ? (is.netIncome / is.totalRevenue) * 100 : null;

  return (
    <>
      <OsTitleBar
        title="Financial reports"
        Icon={FileBarChart}
        iconGradient={GRAD.pinkPurple}
        description={loading ? "Computing your statements…" : `${range.label} · live aggregation from posted entries`}
        actions={
          <div className="frep__head-actions">
            <Link href="/financials" className="frep__nav-link"><Coins /> Finance</Link>
            <Link href="/financials/entries" className="frep__nav-link"><BookText /> Journal</Link>
            <Link href="/financials/statements" className="frep__btn-primary"><Receipt /> Statements</Link>
          </div>
        }
      />

      <div className="frep">
        <section className="frep__range">
          <span className="frep__range-tag"><CalendarRange /> {range.label}</span>
          <span className="frep__range-sub">{new Date(range.from).toLocaleDateString()} → {new Date(range.to).toLocaleDateString()}</span>
          <span className={`frep__range-health ${isHealthy && bsHealthy ? "is-ok" : "is-off"}`}>
            <Activity /> {isHealthy && bsHealthy ? "books balance" : "imbalance detected"}
          </span>
        </section>

        {loadError ? (
          <OsEmptyView Icon={FileBarChart} iconGradient={GRAD.redPink} title="Couldn't load reports" subtitle={loadError} cta="Retry" />
        ) : (
          <>
            <section className="frep__section">
              <header className="frep__section-head">
                <h2><Hash /> Core statements</h2>
                <span className="frep__section-line" />
                <Link href="/financials/statements" className="frep__section-more">open viewer <ChevronRight /></Link>
              </header>
              <div className="frep__grid">
                <ReportCard
                  href="/financials/statements?report=trial-balance"
                  Icon={Scale}
                  hue="var(--os-c-indigo)"
                  title="Trial balance"
                  subtitle="Sum of debits and credits across every account"
                  badge={isHealthy ? "BALANCED" : "OFF"}
                  badgeOk={isHealthy}
                  rows={tb ? [
                    { label: "Total debits", value: money(tb.totalDebits, { compact: true }) },
                    { label: "Total credits", value: money(tb.totalCredits, { compact: true }) },
                    { label: "Delta", value: money(tb.delta), highlight: !isHealthy },
                  ] : null}
                />
                <ReportCard
                  href="/financials/statements?report=income-statement"
                  Icon={TrendingUp}
                  hue="var(--os-c-green)"
                  title="Income statement"
                  subtitle="Revenue less expenses — your P&L for the period"
                  badge={is && is.netIncome >= 0 ? "PROFIT" : "LOSS"}
                  badgeOk={!!is && is.netIncome >= 0}
                  rows={is ? [
                    { label: "Revenue", value: money(is.totalRevenue, { compact: true }) },
                    { label: "Expense", value: money(is.totalExpense, { compact: true }) },
                    { label: "Net income", value: money(is.netIncome, { compact: true }), highlight: true },
                    ...(margin !== null ? [{ label: "Margin", value: `${margin.toFixed(1)}%` }] : []),
                  ] : null}
                />
                <ReportCard
                  href="/financials/statements?report=balance-sheet"
                  Icon={Briefcase}
                  hue="var(--os-c-blue)"
                  title="Balance sheet"
                  subtitle="Assets, liabilities, and equity — your snapshot"
                  badge={bsHealthy ? "TIES" : "OFF"}
                  badgeOk={bsHealthy}
                  rows={bs ? [
                    { label: "Assets", value: money(bs.totalAssets, { compact: true }) },
                    { label: "Liabilities", value: money(bs.totalLiabilities, { compact: true }) },
                    { label: "Equity", value: money(bs.totalEquity, { compact: true }) },
                    { label: "Delta", value: money(bs.delta), highlight: !bsHealthy },
                  ] : null}
                />
              </div>
            </section>

            <section className="frep__section">
              <header className="frep__section-head">
                <h2><Layers /> Analytics & insights</h2>
                <span className="frep__section-line" />
              </header>
              <div className="frep__grid">
                <LaunchTile href="/planning/variance" Icon={TrendingDown} hue="var(--os-c-red)"
                  title="Variance" stat="Plan vs actual" sub="month-by-month spend gaps" />
                <LaunchTile href="/planning/plans" Icon={Receipt} hue="var(--os-c-purple)"
                  title="Budget plans" stat="Active plans" sub="open the planning hub" />
                <LaunchTile href="/financials/calendar" Icon={CalendarRange} hue="var(--os-c-orange)"
                  title="Periods" stat="Cycle calendar" sub="open & close fiscal months" />
                <LaunchTile href="/financials/accounts" Icon={Wallet} hue="var(--os-c-sage)"
                  title="Chart of accounts" stat={tb ? `${tb.rows.length} active accounts` : "—"} sub="every line posts here" />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

type Row = { label: string; value: string; highlight?: boolean };

function ReportCard({ href, Icon, hue, title, subtitle, badge, badgeOk, rows }: {
  href: string;
  Icon: typeof FileBarChart;
  hue: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeOk: boolean;
  rows: Row[] | null;
}) {
  return (
    <Link href={href} className="frep__card" style={{ ["--card-c" as unknown as string]: hue }}>
      <header className="frep__card-head">
        <span className="frep__card-icon"><Icon /></span>
        <div className="frep__card-meta">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className={`frep__card-badge ${badgeOk ? "is-ok" : "is-off"}`}>{badge}</span>
      </header>
      <div className="frep__card-body">
        {rows ? rows.map((r) => (
          <div key={r.label} className={`frep__card-row${r.highlight ? " is-h" : ""}`}>
            <span>{r.label}</span>
            <strong>{r.value}</strong>
          </div>
        )) : (
          <div className="frep__card-skeleton">Computing…</div>
        )}
      </div>
      <footer className="frep__card-foot">
        <span>Open statement</span>
        <ChevronRight />
      </footer>
    </Link>
  );
}

function LaunchTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof FileBarChart; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="frep__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="frep__tile-icon"><Icon /></span>
      <div className="frep__tile-body">
        <div className="frep__tile-title">{title}</div>
        <div className="frep__tile-stat">{stat}</div>
        <div className="frep__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="frep__tile-chev" />
    </Link>
  );
}
