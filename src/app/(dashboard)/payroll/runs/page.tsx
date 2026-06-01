"use client";

/* Payroll · Runs — historical pay runs ledger.
 *
 *  GET   /api/pay-runs?limit=100
 *  PATCH /api/pay-runs/[id]  { action: "calculate"|"post"|"cancel" }
 *
 * Layout:
 *   OsTitleBar with nav.
 *   4-tile KPI strip: In flight · Posted YTD · Disbursed YTD · Avg run.
 *   Toolbar: search + year filter + status chips.
 *   Year-grouped sections showing all runs (active + posted) with table rows.
 *   Cancelled runs in collapsed strip.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleDollarSign, ArrowLeft, ChevronRight, Search, Calendar as CalendarIcon,
  Play, CheckCircle2, Loader2, XCircle, Ban, ArrowRight,
  Receipt, Layers, Users,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";

type ApiPayRun = {
  id: string;
  status: Status;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  totalGross?: number | string | null;
  totalNet?: number | string | null;
  totalTax?: number | string | null;
  totalDeductions?: number | string | null;
  payGroup?: { id: string; name: string } | null;
  _count?: { payslips?: number };
};

const STATUS_LABELS: Record<Status, string> = {
  DRAFT: "Draft", CALCULATING: "Calculating", CALCULATED: "Calculated",
  POSTED: "Posted", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<Status, string> = {
  DRAFT: C.indigo, CALCULATING: C.orange, CALCULATED: C.purple,
  POSTED: C.green, CANCELLED: C.gray,
};
const STATUS_FILTER_ORDER: Status[] = ["DRAFT", "CALCULATING", "CALCULATED", "POSTED", "CANCELLED"];

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number, currency = "₹"): string {
  if (n >= 1_00_00_000) return `${currency}${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `${currency}${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${currency}${(n / 1_000).toFixed(0)}k`;
  return `${currency}${Math.round(n).toLocaleString()}`;
}
function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtPeriod(start: string, end: string): string {
  const s = new Date(start); const e = new Date(end);
  const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
  if (sameMonth) {
    return `${s.toLocaleDateString("en-US", { day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

function nextAction(s: Status): { action: string; label: string } | null {
  if (s === "DRAFT") return { action: "calculate", label: "Calculate" };
  if (s === "CALCULATED") return { action: "post", label: "Post" };
  return null;
}

export default function PayrollRunsPage() {
  const [runs, setRuns] = useState<ApiPayRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<Status>>(new Set());
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pay-runs?limit=100");
      if (res.status === 403) { setLoadError("Org-admin access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("payroll");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function act(id: string, action: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/pay-runs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can move payroll");
        else toast("Couldn't update pay run");
        return;
      }
      toast(action === "calculate" ? "Calculating…" : action === "post" ? "Posted" : "Cancelled");
      void load();
    } catch { toast("Couldn't update pay run"); }
    finally { setBusyId(null); }
  }

  // ─── Years ───────────────────────────────────────────────
  const years = useMemo(() => {
    const s = new Set<number>();
    for (const r of runs ?? []) s.add(new Date(r.payDate).getFullYear());
    return Array.from(s).sort((a, b) => b - a);
  }, [runs]);

  // ─── Counts ──────────────────────────────────────────────
  const counts = useMemo(() => {
    const list = runs ?? [];
    const byStatus: Record<Status, number> = {
      DRAFT: 0, CALCULATING: 0, CALCULATED: 0, POSTED: 0, CANCELLED: 0,
    };
    for (const r of list) byStatus[r.status]++;
    return { total: list.length, byStatus };
  }, [runs]);

  // ─── Filter ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = runs ?? [];
    if (yearFilter !== null) list = list.filter((r) => new Date(r.payDate).getFullYear() === yearFilter);
    if (statusFilter.size > 0) list = list.filter((r) => statusFilter.has(r.status));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.payGroup?.name ?? "").toLowerCase().includes(q));
    return list.slice().sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime());
  }, [runs, yearFilter, statusFilter, search]);

  // ─── Group by year-month ─────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: ApiPayRun[] }>();
    for (const r of filtered) {
      const d = new Date(r.payDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, v]) => ({ key, label: v.label, items: v.items }));
  }, [filtered]);

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = runs ?? [];
    const year = new Date().getFullYear();
    const inFlight = list.filter((r) => r.status === "DRAFT" || r.status === "CALCULATING" || r.status === "CALCULATED").length;
    const postedYtd = list.filter((r) => r.status === "POSTED" && new Date(r.payDate).getFullYear() === year);
    const disbursedYtd = postedYtd.reduce((acc, r) => acc + num(r.totalNet), 0);
    const avgRun = postedYtd.length === 0 ? 0 : disbursedYtd / postedYtd.length;
    return { inFlight, postedYtd: postedYtd.length, disbursedYtd, avgRun };
  }, [runs]);

  function toggleStatus(s: Status) {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next);
  }
  function clearAll() {
    setSearch(""); setYearFilter(null); setStatusFilter(new Set());
  }
  const hasFilter = search.trim() !== "" || yearFilter !== null || statusFilter.size > 0;

  return (
    <>
      <OsTitleBar
        title="Pay runs"
        Icon={CircleDollarSign}
        iconGradient={GRAD.greenTeal}
        description={runs === null
          ? "Loading runs…"
          : `${counts.total} run${counts.total === 1 ? "" : "s"} · ${stats.inFlight} in flight · ${fmtMoney(stats.disbursedYtd)} YTD`}
        actions={
          <div className="pyrr__head-actions">
            <button type="button" className="pyrr__back" onClick={() => history.back()}>
              <ArrowLeft /> Payroll
            </button>
            <Link href="/payroll/groups" className="pyrr__nav-link"><Layers /> Groups</Link>
          </div>
        }
      />

      <div className="pyrr">
        {/* KPIs */}
        <div className="pyrr__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Loader2}      label="In flight"     value={`${stats.inFlight}`}         sub="awaiting action" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Posted YTD"    value={`${stats.postedYtd}`}        sub={`${new Date().getFullYear()} so far`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Receipt}      label="Disbursed YTD" value={fmtMoney(stats.disbursedYtd)} sub="net paid out" />
          <KpiTile accent="var(--os-c-purple)" Icon={CircleDollarSign} label="Avg run" value={fmtMoney(stats.avgRun)}        sub={`avg posted ${new Date().getFullYear()}`} />
        </div>

        {/* Toolbar */}
        <div className="pyrr__toolbar">
          <div className="pyrr__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pay group…"
              aria-label="Search pay runs"
            />
          </div>

          <div className="pyrr__filter-group">
            <span className="pyrr__filter-label">Status</span>
            <div className="pyrr__chips">
              {STATUS_FILTER_ORDER.map((s) => (
                <FilterChip key={s} label={STATUS_LABELS[s]} count={counts.byStatus[s]} color={STATUS_COLORS[s]} active={statusFilter.has(s)} onClick={() => toggleStatus(s)} />
              ))}
            </div>
          </div>

          {years.length > 0 && (
            <div className="pyrr__filter-group">
              <span className="pyrr__filter-label">Year</span>
              <div className="pyrr__years">
                <button type="button" className={yearFilter === null ? "is-active" : ""} onClick={() => setYearFilter(null)}>All</button>
                {years.map((y) => (
                  <button key={y} type="button" className={yearFilter === y ? "is-active" : ""} onClick={() => setYearFilter(y)}>{y}</button>
                ))}
              </div>
            </div>
          )}

          {hasFilter && (
            <button type="button" className="pyrr__clear" onClick={clearAll}>Clear</button>
          )}
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.redPink} title="Couldn't load pay runs" subtitle={loadError} cta="Retry" />
        ) : runs === null ? (
          <div className="pyrr__loading">Loading pay runs…</div>
        ) : counts.total === 0 ? (
          <OsEmptyView
            Icon={CircleDollarSign}
            iconGradient={GRAD.greenTeal}
            title="No pay runs yet"
            subtitle="Set up a pay group, then run payroll for a period. Calculate → review → post."
            chips={["Draft", "Calculate", "Post"]}
            cta="Configure payroll"
          />
        ) : grouped.length === 0 ? (
          <div className="pyrr__empty">
            <Search />
            <div>No runs match these filters.</div>
            <button type="button" className="pyrr__empty-reset" onClick={clearAll}>Clear filters</button>
          </div>
        ) : (
          grouped.map((g) => (
            <section key={g.key} className="pyrr__group">
              <header className="pyrr__group-head">
                <CalendarIcon />
                <h2 className="pyrr__group-title">{g.label}</h2>
                <span className="pyrr__group-count">{g.items.length} run{g.items.length === 1 ? "" : "s"}</span>
                <span className="pyrr__group-net">
                  {fmtMoney(g.items.filter((r) => r.status === "POSTED").reduce((acc, r) => acc + num(r.totalNet), 0))} posted
                </span>
                <span className="pyrr__group-line" />
              </header>
              <div className="pyrr__rows">
                {g.items.map((r) => <RunRow key={r.id} run={r} busy={busyId === r.id} onAct={act} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function RunRow({ run, busy, onAct }: { run: ApiPayRun; busy: boolean; onAct: (id: string, action: string) => void }) {
  const statusColor = STATUS_COLORS[run.status];
  const StatusIcon = run.status === "POSTED" ? CheckCircle2 : run.status === "CALCULATING" ? Loader2 : run.status === "CANCELLED" ? XCircle : Play;
  const next = nextAction(run.status);
  const dayDelta = daysUntil(run.payDate);
  const dayLabel = run.status === "POSTED"
    ? "posted"
    : dayDelta > 0 ? `pay in ${dayDelta}d`
    : dayDelta === 0 ? "pay today"
    : `pay ${-dayDelta}d ago`;
  const dayTone = run.status === "POSTED" ? "muted"
    : dayDelta < 0 ? "bad"
    : dayDelta <= 3 ? "warn"
    : "muted";

  return (
    <article className={`pyrr__row${run.status === "CANCELLED" ? " is-cancelled" : ""}`} style={{ ["--row-c" as unknown as string]: statusColor }}>
      <span className="pyrr__row-accent" aria-hidden="true" />

      <div className="pyrr__row-status">
        <span className="pyrr__row-status-icon" style={{ background: statusColor }}>
          <StatusIcon />
        </span>
        <span className="pyrr__row-status-label">{STATUS_LABELS[run.status]}</span>
      </div>

      <Link href={`/payroll/${run.id}`} className="pyrr__row-main">
        <div className="pyrr__row-group">{run.payGroup?.name ?? "Pay group"}</div>
        <div className="pyrr__row-period">{fmtPeriod(run.periodStart, run.periodEnd)}</div>
      </Link>

      <div className="pyrr__row-paydate">
        <div className="pyrr__row-pd-date">{fmtShortDate(run.payDate)}</div>
        <div className={`pyrr__row-pd-rel pyrr__row-pd-rel--${dayTone}`}>{dayLabel}</div>
      </div>

      <div className="pyrr__row-totals">
        <div className="pyrr__row-total">
          <span>Gross</span>
          <strong>{fmtMoney(num(run.totalGross))}</strong>
        </div>
        <div className="pyrr__row-total pyrr__row-total--net">
          <span>Net</span>
          <strong>{fmtMoney(num(run.totalNet))}</strong>
        </div>
        {run._count?.payslips !== undefined && (
          <div className="pyrr__row-total">
            <span>Slips</span>
            <strong><Users /> {run._count.payslips}</strong>
          </div>
        )}
      </div>

      <div className="pyrr__row-actions">
        {next && run.status !== "CANCELLED" && (
          <button type="button" className="pyrr__row-advance" disabled={busy} onClick={() => onAct(run.id, next.action)} title={next.label}>
            {busy ? <Loader2 /> : <ChevronRight />}
          </button>
        )}
        {(run.status === "DRAFT" || run.status === "CALCULATED") && (
          <button type="button" className="pyrr__row-cancel" disabled={busy} onClick={() => onAct(run.id, "cancel")} title="Cancel">
            <Ban />
          </button>
        )}
        <Link href={`/payroll/${run.id}`} className="pyrr__row-open" title="Open">
          <ArrowRight />
        </Link>
      </div>
    </article>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`pyrr__chip${active ? " is-active" : ""}`}
      style={{ ["--chip-c" as unknown as string]: color }}
      onClick={onClick}
    >
      <span className="pyrr__chip-dot" />
      {label}
      <span className="pyrr__chip-count">{count}</span>
    </button>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof CircleDollarSign; label: string; value: string; sub: string }) {
  return (
    <div className="pyrr__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="pyrr__kpi-accent" aria-hidden="true" />
      <div className="pyrr__kpi-row">
        <div className="pyrr__kpi-icon"><Icon /></div>
        <div className="pyrr__kpi-label">{label}</div>
      </div>
      <div className="pyrr__kpi-value">{value}</div>
      <div className="pyrr__kpi-sub">{sub}</div>
    </div>
  );
}
