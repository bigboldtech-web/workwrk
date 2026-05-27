"use client";

/* Finance hub — overview of the suite with live tile stats.
 *
 * Reads in parallel: gl-accounts, journal-entries, accounting-periods,
 * budget-plans, purchase-orders. Tiles route to the deep surfaces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Wallet, BookText, CalendarRange, ScrollText, ShoppingCart, FileBarChart, Receipt, ChevronRight, Coins } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiAcct = { id: string; active: boolean };
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
    const activePlans = (plans ?? []).filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;
    const openPos = (pos ?? []).filter((p) => p.status !== "CLOSED" && p.status !== "RECEIVED" && p.status !== "CANCELLED").length;
    return { active, acctTotal, postedMonth: posted, draftsMonth: drafts, currentPeriod, openPeriods, activePlans, totalPlans: plans?.length ?? 0, openPos, totalPos: pos?.length ?? 0 };
  }, [accts, entries, periods, plans, pos]);

  const loading = accts === null || entries === null || periods === null || plans === null;

  return (
    <div className="hub">
      <header className="hub__head">
        <div className="hub__icon" style={{ background: "linear-gradient(135deg, var(--os-c-sage), var(--os-c-teal))" }}><Coins /></div>
        <div>
          <h1>Finance</h1>
          <p>{loading ? "Computing your books…" : `${stats.acctTotal} GL accounts · ${stats.postedMonth} posted this month · ${stats.openPeriods} open period${stats.openPeriods === 1 ? "" : "s"}`}</p>
        </div>
      </header>

      {error && <div className="hub__error">{error}</div>}

      <div className="hub__grid">
        <HubTile href="/financials/accounts" icon={<Wallet />} hue="var(--os-c-sage)"
          title="Chart of accounts" stat={`${stats.acctTotal}`} sub={`${stats.active} active · 5 buckets`} />
        <HubTile href="/financials/entries" icon={<BookText />} hue="var(--os-c-indigo)"
          title="Journal entries" stat={`${stats.postedMonth}`} sub={`posted this month · ${stats.draftsMonth} draft${stats.draftsMonth === 1 ? "" : "s"}`} />
        <HubTile href="/financials/calendar" icon={<CalendarRange />} hue="var(--os-c-orange)"
          title="Accounting periods" stat={stats.currentPeriod?.label ?? "—"} sub={stats.currentPeriod ? `current · ${stats.openPeriods} open` : `${stats.openPeriods} open period${stats.openPeriods === 1 ? "" : "s"}`} />
        <HubTile href="/planning/plans" icon={<ScrollText />} hue="var(--os-c-purple)"
          title="Budget plans" stat={`${stats.activePlans}`} sub={`active · ${stats.totalPlans} total`} />
        <HubTile href="/procurement/pos" icon={<ShoppingCart />} hue="var(--os-c-brown)"
          title="Purchase orders" stat={`${stats.openPos}`} sub={`open · ${stats.totalPos} total this period`} />
        <HubTile href="/financials/statements" icon={<Receipt />} hue="var(--os-c-blue)"
          title="Statements" stat="P&L · BS · CF" sub="generate for any period" />
        <HubTile href="/financials/reports" icon={<FileBarChart />} hue="var(--os-c-pink)"
          title="Reports" stat="—" sub="dashboards · drill-ins" />
        <HubTile href="/planning/variance" icon={<FileBarChart />} hue="var(--os-c-red)"
          title="Variance" stat="—" sub="plan vs actual" />
      </div>
    </div>
  );
}

function HubTile({ href, icon, hue, title, stat, sub }: { href: string; icon: React.ReactNode; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="hub-tile" style={{ ["--tile-hue" as string]: hue }}>
      <span className="hub-tile__icon">{icon}</span>
      <div className="hub-tile__body">
        <div className="hub-tile__title">{title}</div>
        <div className="hub-tile__stat">{stat}</div>
        <div className="hub-tile__sub">{sub}</div>
      </div>
      <span className="hub-tile__chev"><ChevronRight /></span>
    </Link>
  );
}
