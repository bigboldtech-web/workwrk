"use client";

/* Finance · Accounting Periods — fiscal calendar grouped by year.
 *
 * Reads:  GET   /api/accounting-periods
 * Writes: PATCH /api/accounting-periods/[id]  { action: "close"|"reopen" }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarRange, Lock, Unlock, FileCheck2, AlertTriangle, Coins, BookText,
  CheckCircle2, Clock, Activity, Hash, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "OPEN" | "LOCKED" | "CLOSED" | "REOPENED";
type ApiPeriod = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: Status;
  closedAt?: string | null;
  fiscalYear?: { id: string; label: string; startDate: string; endDate: string } | null;
  _count?: { journalEntries?: number };
};

const STATUS_HUE: Record<Status, string> = {
  OPEN: "var(--os-c-green)", LOCKED: "var(--os-c-orange)",
  CLOSED: "var(--os-c-ink-3)", REOPENED: "var(--os-c-purple)",
};
const STATUS_LABEL: Record<Status, string> = {
  OPEN: "Open", LOCKED: "Locked", CLOSED: "Closed", REOPENED: "Reopened",
};
const STATUS_ICON: Record<Status, typeof Clock> = {
  OPEN: CheckCircle2, LOCKED: Lock, CLOSED: Lock, REOPENED: Activity,
};

function fmtSpan(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
function isCurrent(p: ApiPeriod): boolean {
  const now = Date.now();
  return new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime();
}

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<ApiPeriod[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"ALL" | Status>("ALL");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting-periods");
      if (res.status === 403) { setLoadError("Org-admin access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPeriods(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function act(id: string, action: "close" | "reopen") {
    try {
      const res = await fetch(`/api/accounting-periods/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(action === "close" ? "Period closed" : "Period reopened");
      void load();
    } catch { toast("Couldn't update period"); }
  }

  const stats = useMemo(() => {
    const list = periods ?? [];
    const open = list.filter((p) => p.status === "OPEN").length;
    const closed = list.filter((p) => p.status === "CLOSED").length;
    const locked = list.filter((p) => p.status === "LOCKED").length;
    const reopened = list.filter((p) => p.status === "REOPENED").length;
    const totalEntries = list.reduce((acc, p) => acc + (p._count?.journalEntries ?? 0), 0);
    const current = list.find(isCurrent);
    return { total: list.length, open, closed, locked, reopened, totalEntries, current };
  }, [periods]);

  const filtered = useMemo(() => {
    if (activeFilter === "ALL") return periods ?? [];
    return (periods ?? []).filter((p) => p.status === activeFilter);
  }, [periods, activeFilter]);

  const grouped = useMemo(() => {
    const m = new Map<string, { fy: string; periods: ApiPeriod[] }>();
    for (const p of filtered) {
      const k = p.fiscalYear?.label ?? "Unassigned";
      if (!m.has(k)) m.set(k, { fy: k, periods: [] });
      m.get(k)!.periods.push(p);
    }
    return Array.from(m.values()).sort((a, b) => b.fy.localeCompare(a.fy));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Accounting periods"
        Icon={CalendarRange}
        iconGradient={GRAD.orangePink}
        description={periods === null ? "Loading…" : `${stats.total} period${stats.total === 1 ? "" : "s"} · ${stats.open + stats.reopened} open · ${stats.closed + stats.locked} closed · ${stats.totalEntries} journal entries`}
        actions={
          <div className="prd__head-actions">
            <Link href="/financials" className="prd__nav-link"><Coins /> Finance</Link>
            <Link href="/financials/entries" className="prd__nav-link"><BookText /> Journal</Link>
          </div>
        }
      />

      <div className="prd">
        <div className="prd__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Open"      value={`${stats.open}`}      sub="ready to post" />
          <KpiTile accent="var(--os-c-purple)" Icon={Activity}     label="Reopened"  value={`${stats.reopened}`}  sub="audit logged" />
          <KpiTile accent="var(--os-c-orange)" Icon={Lock}         label="Locked"    value={`${stats.locked}`}    sub="awaiting close" />
          <KpiTile accent="var(--os-c-ink-3)"  Icon={FileCheck2}   label="Closed"    value={`${stats.closed}`}    sub={`${stats.totalEntries} entries posted`} />
        </div>

        {stats.current && (
          <section className="prd__current">
            <span className="prd__current-tag"><Activity /> Current period</span>
            <h2>{stats.current.label}</h2>
            <span className="prd__current-span">{fmtSpan(stats.current.startDate, stats.current.endDate)}</span>
            <span className={`prd__current-status prd__current-status--${stats.current.status.toLowerCase()}`}>
              {(() => { const I = STATUS_ICON[stats.current.status]; return <I />; })()} {STATUS_LABEL[stats.current.status]}
            </span>
            <span className="prd__current-entries"><FileCheck2 /> {stats.current._count?.journalEntries ?? 0} entries</span>
          </section>
        )}

        <div className="prd__toolbar">
          <div className="prd__filters">
            {(["ALL", "OPEN", "REOPENED", "LOCKED", "CLOSED"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`prd__filter${activeFilter === s ? " is-active" : ""}`}
                style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as Status] } : undefined}
                onClick={() => setActiveFilter(s)}
              >
                {s === "ALL" ? <Hash /> : (() => { const I = STATUS_ICON[s as Status]; return <I />; })()}
                {s === "ALL" ? "All" : STATUS_LABEL[s as Status]}
                <span className="prd__filter-n">
                  {s === "ALL" ? stats.total : s === "OPEN" ? stats.open : s === "REOPENED" ? stats.reopened : s === "LOCKED" ? stats.locked : stats.closed}
                </span>
              </button>
            ))}
          </div>
          <span className="prd__caption">Closing a period freezes every entry inside it. Reopen is recorded on the audit log.</span>
        </div>

        {loadError ? (
          <OsEmptyView Icon={CalendarRange} iconGradient={GRAD.redPink} title="Couldn't load periods" subtitle={loadError} cta="Retry" />
        ) : periods === null ? (
          <div className="prd__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={CalendarRange}
            iconGradient={GRAD.orangePink}
            title="No fiscal year set up yet"
            subtitle="Configure your fiscal year in Settings → Profile, then the system seeds monthly accounting periods for you."
            chips={["Open", "Locked", "Closed", "Reopened"]}
            cta="Open settings"
          />
        ) : grouped.length === 0 ? (
          <div className="prd__no-match"><Layers /> No periods in this status.</div>
        ) : (
          <div className="prd__years">
            {grouped.map((g) => (
              <section key={g.fy} className="prd__year">
                <header className="prd__year-head">
                  <h2>{g.fy}</h2>
                  <span className="prd__year-count">{g.periods.length} period{g.periods.length === 1 ? "" : "s"}</span>
                  <span className="prd__year-line" />
                </header>
                <div className="prd__ribbon">
                  {g.periods.map((p) => {
                    const current = isCurrent(p);
                    const isOpen = p.status === "OPEN" || p.status === "REOPENED";
                    const entries = p._count?.journalEntries ?? 0;
                    const Icon = STATUS_ICON[p.status];
                    return (
                      <article
                        key={p.id}
                        className={`prd__period${current ? " is-current" : ""}`}
                        style={{ ["--s-c" as unknown as string]: STATUS_HUE[p.status] }}
                      >
                        <header className="prd__period-head">
                          <span className="prd__period-label">{p.label}</span>
                          <span className="prd__period-status"><Icon /> {STATUS_LABEL[p.status]}</span>
                        </header>
                        <div className="prd__period-span">{fmtSpan(p.startDate, p.endDate)}</div>
                        <div className="prd__period-entries">
                          <FileCheck2 /> {entries} journal entr{entries === 1 ? "y" : "ies"}
                        </div>
                        {current && <div className="prd__period-current">Current period</div>}
                        {p.closedAt && <div className="prd__period-closed">Closed {new Date(p.closedAt).toLocaleDateString()}</div>}
                        <div className="prd__period-actions">
                          {isOpen ? (
                            <button type="button" className="prd__period-btn prd__period-btn--close" onClick={() => act(p.id, "close")}>
                              <Lock /> Close
                            </button>
                          ) : (
                            <button type="button" className="prd__period-btn prd__period-btn--reopen" onClick={() => act(p.id, "reopen")}>
                              <Unlock /> Reopen
                            </button>
                          )}
                        </div>
                        {!isOpen && entries === 0 && (
                          <div className="prd__period-warn"><AlertTriangle /> Closed with no entries</div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof CalendarRange; label: string; value: string; sub: string }) {
  return (
    <div className="prd__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="prd__kpi-accent" aria-hidden="true" />
      <div className="prd__kpi-row">
        <div className="prd__kpi-icon"><Icon /></div>
        <div className="prd__kpi-label">{label}</div>
      </div>
      <div className="prd__kpi-value">{value}</div>
      <div className="prd__kpi-sub">{sub}</div>
    </div>
  );
}
