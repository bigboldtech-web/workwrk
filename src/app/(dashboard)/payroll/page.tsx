"use client";

/* Payroll — bespoke run hero with status flow + KPI strip.
 *
 *  GET   /api/pay-runs           list
 *  PATCH /api/pay-runs/[id]      { action: calculate | post | cancel }
 *
 * Layout:
 *   OsTitleBar with nav + New pay run in actions.
 *   Hero card for the most-active run (DRAFT or CALCULATED next), with status flow stepper + totals.
 *   4-tile KPI strip: YTD spend · Last posted net · Employees paid · Next pay date.
 *   2-col body: Recent runs list (status-grouped) + Pay groups sidebar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleDollarSign, ArrowRight, ChevronRight, Calendar as CalendarIcon,
  Users, TrendingUp, FileText, Play, CheckCircle2,
  Loader2, Layers, BarChart3, Receipt, XCircle, Plus,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PrStatus = "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";

type ApiPayRun = {
  id: string;
  status: PrStatus;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  totalGross?: number | string | null;
  totalNet?: number | string | null;
  totalTax?: number | string | null;
  totalDeductions?: number | string | null;
  payGroup?: { id: string; name: string } | null;
  _count?: { payslips?: number };
  postedAt?: string | null;
  createdAt?: string;
};

const STATUS_LABELS: Record<PrStatus, string> = {
  DRAFT: "Draft", CALCULATING: "Calculating", CALCULATED: "Calculated",
  POSTED: "Posted", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<PrStatus, string> = {
  DRAFT: C.indigo, CALCULATING: C.orange, CALCULATED: C.purple,
  POSTED: C.green, CANCELLED: C.gray,
};
const STATUS_FLOW: PrStatus[] = ["DRAFT", "CALCULATING", "CALCULATED", "POSTED"];
function nextAction(s: PrStatus): { label: string; action: string } | null {
  if (s === "DRAFT") return { label: "Calculate", action: "calculate" };
  if (s === "CALCULATED") return { label: "Post payroll", action: "post" };
  return null;
}

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
function fmtFullMoney(n: number, currency = "₹"): string {
  return `${currency}${Math.round(n).toLocaleString()}`;
}
function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString("en-US", { day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<ApiPayRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pay-runs");
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

  async function advance(run: ApiPayRun) {
    const next = nextAction(run.status);
    if (!next) return;
    try {
      const res = await fetch(`/api/pay-runs/${run.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next.action }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can move payroll");
        else toast("Couldn't advance run");
        return;
      }
      toast(`${run.payGroup?.name ?? "Pay run"} → ${next.label === "Post payroll" ? "Posted" : "Calculated"}`);
      void load();
    } catch { toast("Couldn't advance run"); }
  }

  // ─── Focal run (hero) ────────────────────────────────────
  const focal = useMemo(() => {
    const list = runs ?? [];
    // Prefer CALCULATED ready to post, then DRAFT ready to calculate, then most recent
    return list.find((r) => r.status === "CALCULATED")
      ?? list.find((r) => r.status === "DRAFT")
      ?? list.find((r) => r.status === "CALCULATING")
      ?? list.sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime())[0]
      ?? null;
  }, [runs]);

  // ─── Pay groups (derived) ────────────────────────────────
  const payGroups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; runs: number; lastRun?: ApiPayRun }>();
    for (const r of runs ?? []) {
      if (!r.payGroup) continue;
      const k = r.payGroup.id;
      if (!m.has(k)) m.set(k, { id: k, name: r.payGroup.name, runs: 0 });
      const entry = m.get(k)!;
      entry.runs++;
      if (!entry.lastRun || new Date(r.payDate).getTime() > new Date(entry.lastRun.payDate).getTime()) {
        entry.lastRun = r;
      }
    }
    return Array.from(m.values()).sort((a, b) => b.runs - a.runs);
  }, [runs]);

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = runs ?? [];
    const year = new Date().getFullYear();
    const postedThisYear = list.filter((r) => r.status === "POSTED" && new Date(r.payDate).getFullYear() === year);
    const ytdSpend = postedThisYear.reduce((acc, r) => acc + num(r.totalNet), 0);
    const lastPosted = list.filter((r) => r.status === "POSTED").sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime())[0];
    const employeesPaid = lastPosted?._count?.payslips ?? 0;
    const inFlight = list.filter((r) => r.status === "DRAFT" || r.status === "CALCULATED" || r.status === "CALCULATING").length;
    const nextRun = list
      .filter((r) => r.status !== "CANCELLED" && r.status !== "POSTED" && new Date(r.payDate).getTime() >= Date.now())
      .sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())[0];
    return { ytdSpend, lastPostedNet: num(lastPosted?.totalNet), employeesPaid, inFlight, nextRun, ytdCount: postedThisYear.length };
  }, [runs]);

  // ─── Recent runs grouped ─────────────────────────────────
  const recentRuns = useMemo(() => (runs ?? [])
    .filter((r) => r.status !== "CANCELLED")
    .sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime())
    .slice(0, 12), [runs]);

  return (
    <>
      <OsTitleBar
        title="Payroll"
        Icon={CircleDollarSign}
        iconGradient={GRAD.greenTeal}
        description={runs === null
          ? "Loading pay runs…"
          : `${runs.length} run${runs.length === 1 ? "" : "s"} · ${stats.inFlight} in flight · ${fmtMoney(stats.ytdSpend)} YTD`}
        people={[PEOPLE.bb, PEOPLE.vn]}
        morePeople={2}
        actions={
          <div className="pyrl__head-actions">
            <Link href="/payroll/runs" className="pyrl__nav-link"><FileText /> All runs</Link>
            <Link href="/payroll/groups" className="pyrl__nav-link"><Layers /> Groups</Link>
            <button type="button" className="pyrl__btn-primary" onClick={() => toast("New pay run needs a pay group + period — open in /payroll/groups")}>
              <Plus /> New pay run
            </button>
          </div>
        }
      />

      <div className="pyrl">
        {/* Hero — focal run */}
        {loadError ? (
          <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.redPink} title="Couldn't load payroll" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : runs === null ? (
          <div className="pyrl__loading">Loading pay runs…</div>
        ) : !focal ? (
          <OsEmptyView
            Icon={CircleDollarSign}
            iconGradient={GRAD.greenTeal}
            title="No pay runs yet"
            subtitle="Set up your first pay group, then run payroll. Runs flow Draft → Calculated → Posted."
            chips={["Draft", "Calculate", "Post"]}
            cta="Configure payroll"
          />
        ) : (
          <RunHero run={focal} onAdvance={advance} />
        )}

        {/* KPIs */}
        {runs !== null && runs.length > 0 && (
          <div className="pyrl__kpis">
            <KpiTile
              accent="var(--os-c-green)"
              Icon={TrendingUp}
              label="YTD payroll spend"
              value={fmtMoney(stats.ytdSpend)}
              sub={`${stats.ytdCount} run${stats.ytdCount === 1 ? "" : "s"} posted ${new Date().getFullYear()}`}
            />
            <KpiTile
              accent="var(--os-c-blue)"
              Icon={Receipt}
              label="Last posted net"
              value={fmtMoney(stats.lastPostedNet)}
              sub={stats.lastPostedNet > 0 ? "most recent run" : "no posted runs yet"}
            />
            <KpiTile
              accent="var(--os-c-purple)"
              Icon={Users}
              label="Employees paid"
              value={`${stats.employeesPaid}`}
              sub="from last posted run"
            />
            <KpiTile
              accent="var(--os-c-orange)"
              Icon={CalendarIcon}
              label="Next pay date"
              value={stats.nextRun ? fmtShortDate(stats.nextRun.payDate) : "—"}
              sub={stats.nextRun ? `${stats.nextRun.payGroup?.name ?? "Pay group"} · ${Math.max(0, daysUntil(stats.nextRun.payDate))}d away` : "no scheduled run"}
            />
          </div>
        )}

        {/* 2-col body */}
        {runs !== null && runs.length > 0 && (
          <div className="pyrl__body">
            {/* Recent runs */}
            <section className="pyrl__panel">
              <header className="pyrl__panel-head">
                <FileText /> Recent runs
                <Link href="/payroll/runs" className="pyrl__panel-link">All <ChevronRight /></Link>
              </header>
              <div className="pyrl__runs">
                {recentRuns.map((r) => <RunRow key={r.id} run={r} onAdvance={advance} />)}
              </div>
            </section>

            {/* Pay groups sidebar */}
            <aside className="pyrl__side">
              <div className="pyrl__panel">
                <header className="pyrl__panel-head">
                  <Layers /> Pay groups
                  <Link href="/payroll/groups" className="pyrl__panel-link">Manage <ChevronRight /></Link>
                </header>
                {payGroups.length === 0 ? (
                  <div className="pyrl__panel-empty">No pay groups configured yet.</div>
                ) : (
                  <div className="pyrl__groups">
                    {payGroups.slice(0, 6).map((g) => (
                      <Link key={g.id} href={`/payroll/groups#${g.id}`} className="pyrl__group">
                        <div className="pyrl__group-icon"><Users /></div>
                        <div className="pyrl__group-main">
                          <div className="pyrl__group-name">{g.name}</div>
                          <div className="pyrl__group-meta">
                            {g.runs} run{g.runs === 1 ? "" : "s"}
                            {g.lastRun && ` · last ${fmtShortDate(g.lastRun.payDate)}`}
                          </div>
                        </div>
                        <ArrowRight className="pyrl__group-arrow" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="pyrl__panel">
                <header className="pyrl__panel-head">
                  <BarChart3 /> Quick actions
                </header>
                <div className="pyrl__quick">
                  <Link href="/payroll/runs" className="pyrl__quick-btn">
                    <FileText /> View all runs
                  </Link>
                  <Link href="/payroll/groups" className="pyrl__quick-btn">
                    <Layers /> Configure groups
                  </Link>
                  <Link href="/payroll/payslip" className="pyrl__quick-btn">
                    <Receipt /> Browse payslips
                  </Link>
                  <Link href="/compensation" className="pyrl__quick-btn">
                    <TrendingUp /> Compensation plans
                  </Link>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function RunHero({ run, onAdvance }: { run: ApiPayRun; onAdvance: (r: ApiPayRun) => void }) {
  const statusColor = STATUS_COLORS[run.status];
  const StatusIcon = run.status === "POSTED" ? CheckCircle2 : run.status === "CALCULATING" ? Loader2 : run.status === "CANCELLED" ? XCircle : Play;
  const nextStep = nextAction(run.status);
  const currentIdx = STATUS_FLOW.indexOf(run.status);
  const dayDelta = daysUntil(run.payDate);
  const dayLabel = dayDelta > 0 ? `in ${dayDelta} day${dayDelta === 1 ? "" : "s"}`
                  : dayDelta === 0 ? "today"
                  : `${-dayDelta} day${dayDelta === -1 ? "" : "s"} ago`;

  return (
    <section className="pyrl__hero" style={{ ["--hero-c" as unknown as string]: statusColor }}>
      <span className="pyrl__hero-accent" aria-hidden="true" />
      <div className="pyrl__hero-main">
        <div className="pyrl__hero-meta">
          <span className="pyrl__hero-tag">Focus run</span>
          <span className="pyrl__hero-status">
            <StatusIcon /> {STATUS_LABELS[run.status]}
          </span>
          <span className="pyrl__hero-pay-date">
            <CalendarIcon /> Pay {fmtShortDate(run.payDate)} · {dayLabel}
          </span>
        </div>
        <h2 className="pyrl__hero-title">{run.payGroup?.name ?? "Pay group"}</h2>
        <div className="pyrl__hero-period">{fmtPeriod(run.periodStart, run.periodEnd)}</div>

        {/* Status flow stepper */}
        <div className="pyrl__flow">
          {STATUS_FLOW.map((s, i) => {
            const isCurrent = s === run.status;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const tone = isCurrent ? "current" : isPast ? "past" : "future";
            return (
              <span key={s} className={`pyrl__flow-step pyrl__flow-step--${tone}`} style={{ ["--step-c" as unknown as string]: STATUS_COLORS[s] }}>
                <span className="pyrl__flow-dot">{i + 1}</span>
                <span className="pyrl__flow-label">{STATUS_LABELS[s]}</span>
                {i < STATUS_FLOW.length - 1 && <ChevronRight className="pyrl__flow-sep" />}
              </span>
            );
          })}
        </div>
      </div>

      <div className="pyrl__hero-totals">
        <Total label="Gross"      value={fmtFullMoney(num(run.totalGross))} accent="var(--os-ink)" />
        <Total label="Deductions" value={fmtFullMoney(num(run.totalDeductions))} accent="var(--os-c-red)" />
        <Total label="Tax"        value={fmtFullMoney(num(run.totalTax))} accent="var(--os-c-orange)" />
        <Total label="Net"        value={fmtFullMoney(num(run.totalNet))} accent="var(--os-c-green)" hero />
        <div className="pyrl__hero-actions">
          {nextStep && (
            <button type="button" className="pyrl__hero-advance" onClick={() => onAdvance(run)}>
              <ChevronRight /> {nextStep.label}
            </button>
          )}
          <Link href={`/payroll/${run.id}`} className="pyrl__hero-open">
            Open run <ArrowRight />
          </Link>
        </div>
        {run._count?.payslips !== undefined && (
          <div className="pyrl__hero-payslips">
            <Users /> {run._count.payslips} payslip{run._count.payslips === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </section>
  );
}

function Total({ label, value, accent, hero }: { label: string; value: string; accent: string; hero?: boolean }) {
  return (
    <div className={`pyrl__total${hero ? " pyrl__total--hero" : ""}`} style={{ ["--total-c" as unknown as string]: accent }}>
      <div className="pyrl__total-label">{label}</div>
      <div className="pyrl__total-value">{value}</div>
    </div>
  );
}

function RunRow({ run, onAdvance }: { run: ApiPayRun; onAdvance: (r: ApiPayRun) => void }) {
  const statusColor = STATUS_COLORS[run.status];
  const next = nextAction(run.status);
  const StatusIcon = run.status === "POSTED" ? CheckCircle2 : run.status === "CALCULATING" ? Loader2 : run.status === "CANCELLED" ? XCircle : Play;

  return (
    <article className="pyrl__run" style={{ ["--row-c" as unknown as string]: statusColor }}>
      <span className="pyrl__run-accent" aria-hidden="true" />
      <Link href={`/payroll/${run.id}`} className="pyrl__run-main">
        <div className="pyrl__run-head">
          <span className="pyrl__run-status">
            <StatusIcon /> {STATUS_LABELS[run.status]}
          </span>
          <span className="pyrl__run-group">{run.payGroup?.name ?? "Pay group"}</span>
        </div>
        <div className="pyrl__run-period">{fmtPeriod(run.periodStart, run.periodEnd)}</div>
        <div className="pyrl__run-meta">
          <CalendarIcon /> Pay {fmtShortDate(run.payDate)}
          {run._count?.payslips !== undefined && (
            <span><Users /> {run._count.payslips} slips</span>
          )}
        </div>
      </Link>
      <div className="pyrl__run-totals">
        <span className="pyrl__run-net">{fmtMoney(num(run.totalNet))}</span>
        <span className="pyrl__run-net-label">net</span>
      </div>
      <div className="pyrl__run-actions">
        {next && (
          <button type="button" className="pyrl__run-advance" onClick={() => onAdvance(run)} title={next.label}>
            <ChevronRight />
          </button>
        )}
        <Link href={`/payroll/${run.id}`} className="pyrl__run-open">
          <ArrowRight />
        </Link>
      </div>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof CircleDollarSign; label: string; value: string; sub: string }) {
  return (
    <div className="pyrl__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="pyrl__kpi-accent" aria-hidden="true" />
      <div className="pyrl__kpi-row">
        <div className="pyrl__kpi-icon"><Icon /></div>
        <div className="pyrl__kpi-label">{label}</div>
      </div>
      <div className="pyrl__kpi-value">{value}</div>
      <div className="pyrl__kpi-sub">{sub}</div>
    </div>
  );
}
