"use client";

/* Reviews — performance review cycles hero list.
 *
 *  GET   /api/reviews
 *  POST  /api/reviews             { name, type, startDate, endDate }
 *  PATCH /api/reviews             { id, status?, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award, Plus, Search, Calendar as CalendarIcon, CheckCircle2,
  Loader2, Play, ChevronRight, ArrowRight, Sparkles, Target,
  Activity, Users, TrendingUp,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type CycleStatus = "DRAFT" | "ACTIVE" | "IN_CALIBRATION" | "COMPLETED" | "CANCELLED";

type ApiCycle = {
  id: string;
  name: string;
  type: string;
  status: CycleStatus;
  startDate: string;
  endDate: string;
  reviews?: { id: string; status: string }[];
  _count?: { reviews?: number };
};

const STATUS_LABELS: Record<CycleStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", IN_CALIBRATION: "In calibration",
  COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<CycleStatus, string> = {
  DRAFT: C.indigo, ACTIVE: C.orange, IN_CALIBRATION: C.purple,
  COMPLETED: C.green, CANCELLED: C.gray,
};

const TYPE_LABELS: Record<string, string> = {
  MONTHLY_PULSE: "Monthly pulse",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
  PROBATION: "Probation",
  PIP_REVIEW: "PIP",
};
const TYPE_COLORS: Record<string, string> = {
  MONTHLY_PULSE: C.teal, QUARTERLY: C.blue, ANNUAL: C.purple,
  PROBATION: C.orange, PIP_REVIEW: C.red,
};

const FLOW: CycleStatus[] = ["DRAFT", "ACTIVE", "IN_CALIBRATION", "COMPLETED"];

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtPeriod(start: string, end: string): string {
  const s = new Date(start); const e = new Date(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}
function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

export default function ReviewsPage() {
  const [cycles, setCycles] = useState<ApiCycle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<CycleStatus>>(new Set());
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiCycle[] = data?.data?.items ?? data?.data?.data ?? data?.items ?? (Array.isArray(data?.data) ? data.data : []) ?? (Array.isArray(data) ? data : []);
      setCycles(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("reviews");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/reviews", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only HR can move review cycles");
        else toast("Couldn't update");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  async function newCycle() {
    const name = (typeof window !== "undefined" ? window.prompt("Review cycle name?") : "")?.trim();
    if (!name) return;
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86_400_000);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "QUARTERLY", startDate: now.toISOString(), endDate: end.toISOString() }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only HR can create review cycles");
        else toast("Couldn't create");
        return;
      }
      toast("Cycle created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  // ─── Featured cycle (hero) ──────────────────────────────
  const featured = useMemo(() => {
    const list = cycles ?? [];
    return list.find((c) => c.status === "ACTIVE" || c.status === "IN_CALIBRATION")
      ?? list.find((c) => c.status === "DRAFT")
      ?? list.slice().sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0]
      ?? null;
  }, [cycles]);

  const filtered = useMemo(() => {
    let list = cycles ?? [];
    if (featured) list = list.filter((c) => c.id !== featured.id);
    if (statusFilter.size > 0) list = list.filter((c) => statusFilter.has(c.status));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q));
    return list.slice().sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [cycles, statusFilter, search, featured]);

  const stats = useMemo(() => {
    const list = cycles ?? [];
    const byStatus: Record<CycleStatus, number> = { DRAFT: 0, ACTIVE: 0, IN_CALIBRATION: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const c of list) byStatus[c.status]++;
    const totalReviews = list.reduce((acc, c) => acc + (c._count?.reviews ?? 0), 0);
    const completedReviews = list.reduce((acc, c) => acc + (c.reviews?.filter((r) => r.status === "COMPLETED").length ?? 0), 0);
    return {
      total: list.length, byStatus,
      activeCount: byStatus.ACTIVE + byStatus.IN_CALIBRATION,
      totalReviews, completedReviews,
      progress: totalReviews > 0 ? Math.round((completedReviews / totalReviews) * 100) : 0,
    };
  }, [cycles]);

  function toggleStatus(s: CycleStatus) {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next);
  }

  return (
    <>
      <OsTitleBar
        title="Performance reviews"
        Icon={Award}
        iconGradient={GRAD.purpleIndigo}
        description={cycles === null ? "Loading cycles…" : `${stats.total} cycle${stats.total === 1 ? "" : "s"} · ${stats.activeCount} active · ${stats.completedReviews}/${stats.totalReviews} reviews done`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.pr]}
        morePeople={5}
        actions={
          <div className="rvw__head-actions">
            <Link href="/kra-kpi" className="rvw__nav-link"><Target /> KRA/KPI</Link>
            <Link href="/talent" className="rvw__nav-link"><Users /> Talent</Link>
            <button type="button" className="rvw__btn-primary" onClick={newCycle}>
              <Plus /> New cycle
            </button>
          </div>
        }
      />

      <div className="rvw">
        {loadError ? (
          <OsEmptyView Icon={Award} iconGradient={GRAD.redPink} title="Couldn't load cycles" subtitle={loadError} cta="Retry" />
        ) : cycles === null ? (
          <div className="rvw__loading">Loading cycles…</div>
        ) : !featured ? (
          <OsEmptyView
            Icon={Award}
            iconGradient={GRAD.purpleIndigo}
            title="No review cycles yet"
            subtitle="Plan your first review cycle. Pick monthly pulse, quarterly, annual, probation, or PIP."
            chips={["Monthly pulse", "Quarterly", "Annual", "Probation", "PIP"]}
            cta="New cycle"
          />
        ) : (
          <>
            <FeaturedCycle cycle={featured} onAdvance={patch} />

            <div className="rvw__kpis">
              <KpiTile accent="var(--os-c-orange)" Icon={Loader2}      label="Active"     value={`${stats.activeCount}`}                                  sub={`${stats.byStatus.IN_CALIBRATION} in calibration`} />
              <KpiTile accent="var(--os-c-indigo)" Icon={Play}         label="Draft"      value={`${stats.byStatus.DRAFT}`}                              sub="planning stage" />
              <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Completed"  value={`${stats.byStatus.COMPLETED}`}                          sub="historical" />
              <KpiTile accent="var(--os-c-purple)" Icon={Activity}     label="Progress"   value={`${stats.progress}%`}                                    sub={`${stats.completedReviews}/${stats.totalReviews} reviews`} progress={stats.progress} />
            </div>

            <div className="rvw__toolbar">
              <div className="rvw__search">
                <Search />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cycle name, type…" />
              </div>
              <div className="rvw__chips">
                {FLOW.map((s) => (
                  <button key={s} type="button" className={`rvw__chip${statusFilter.has(s) ? " is-active" : ""}`} style={{ ["--chip-c" as unknown as string]: STATUS_COLORS[s] }} onClick={() => toggleStatus(s)}>
                    <span className="rvw__chip-dot" />
                    {STATUS_LABELS[s]}
                    <span className="rvw__chip-count">{stats.byStatus[s]}</span>
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rvw__empty">
                <Search />
                <div>No other cycles match.</div>
              </div>
            ) : (
              <div className="rvw__list">
                {filtered.map((c) => <CycleRow key={c.id} cycle={c} />)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function FeaturedCycle({ cycle: c, onAdvance }: { cycle: ApiCycle; onAdvance: (id: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const statusColor = STATUS_COLORS[c.status];
  const typeColor = TYPE_COLORS[c.type] ?? C.indigo;
  const currentIdx = FLOW.indexOf(c.status);
  const next = c.status === "DRAFT" ? "ACTIVE" : c.status === "ACTIVE" ? "IN_CALIBRATION" : c.status === "IN_CALIBRATION" ? "COMPLETED" : null;
  const StatusIcon = c.status === "COMPLETED" ? CheckCircle2 : c.status === "ACTIVE" ? Loader2 : Play;
  const totalReviews = c._count?.reviews ?? c.reviews?.length ?? 0;
  const doneReviews = c.reviews?.filter((r) => r.status === "COMPLETED").length ?? 0;
  const progress = totalReviews > 0 ? Math.round((doneReviews / totalReviews) * 100) : 0;
  const dayDelta = daysUntil(c.endDate);
  const dayLabel = dayDelta > 0 ? `${dayDelta} days until close` : dayDelta === 0 ? "Closes today" : `Closed ${-dayDelta} days ago`;

  return (
    <section className="rvw__hero" style={{ ["--hero-c" as unknown as string]: statusColor }}>
      <span className="rvw__hero-accent" aria-hidden="true" />
      <div className="rvw__hero-main">
        <div className="rvw__hero-meta">
          <span className="rvw__hero-tag"><Sparkles /> Featured</span>
          <span className="rvw__hero-status">
            <StatusIcon /> {STATUS_LABELS[c.status]}
          </span>
          <span className="rvw__hero-type" style={{ ["--type-c" as unknown as string]: typeColor }}>
            {TYPE_LABELS[c.type] ?? c.type.replace(/_/g, " ")}
          </span>
        </div>
        <h2 className="rvw__hero-title">{c.name}</h2>
        <div className="rvw__hero-period">
          <CalendarIcon /> {fmtPeriod(c.startDate, c.endDate)} · {dayLabel}
        </div>

        <div className="rvw__flow">
          {FLOW.map((s, i) => {
            const isCurrent = s === c.status;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const tone = isCurrent ? "current" : isPast ? "past" : "future";
            return (
              <span key={s} className={`rvw__flow-step rvw__flow-step--${tone}`} style={{ ["--step-c" as unknown as string]: STATUS_COLORS[s] }}>
                <span className="rvw__flow-dot">{i + 1}</span>
                <span>{STATUS_LABELS[s]}</span>
              </span>
            );
          })}
        </div>

        <div className="rvw__hero-actions">
          {next && (
            <button type="button" className="rvw__hero-advance" onClick={() => onAdvance(c.id, { status: next })}>
              <ChevronRight /> Move to {STATUS_LABELS[next]}
            </button>
          )}
          <Link href={`/reviews/${c.id}`} className="rvw__hero-open">
            Open cycle <ArrowRight />
          </Link>
        </div>
      </div>

      <div className="rvw__hero-side">
        <div className="rvw__hero-progress-wrap">
          <svg viewBox="0 0 120 120" className="rvw__hero-ring">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--os-surface-1)" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={statusColor} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(progress / 100) * 326.7} 326.7`} transform="rotate(-90 60 60)" />
          </svg>
          <div className="rvw__hero-ring-num">{progress}<small>%</small></div>
        </div>
        <div className="rvw__hero-stats">
          <div className="rvw__hero-stat">
            <span>Total reviews</span>
            <strong>{totalReviews}</strong>
          </div>
          <div className="rvw__hero-stat">
            <span>Completed</span>
            <strong>{doneReviews}</strong>
          </div>
          <div className="rvw__hero-stat">
            <span>Remaining</span>
            <strong>{Math.max(0, totalReviews - doneReviews)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function CycleRow({ cycle: c }: { cycle: ApiCycle }) {
  const statusColor = STATUS_COLORS[c.status];
  const typeColor = TYPE_COLORS[c.type] ?? C.indigo;
  const totalReviews = c._count?.reviews ?? c.reviews?.length ?? 0;
  const doneReviews = c.reviews?.filter((r) => r.status === "COMPLETED").length ?? 0;
  const progress = totalReviews > 0 ? Math.round((doneReviews / totalReviews) * 100) : 0;
  const StatusIcon = c.status === "COMPLETED" ? CheckCircle2 : c.status === "ACTIVE" ? Loader2 : Play;

  return (
    <Link href={`/reviews/${c.id}`} className="rvw__row" style={{ ["--row-c" as unknown as string]: statusColor }}>
      <span className="rvw__row-accent" aria-hidden="true" />
      <div className="rvw__row-status">
        <span className="rvw__row-status-icon" style={{ background: statusColor }}><StatusIcon /></span>
        <span className="rvw__row-status-label">{STATUS_LABELS[c.status]}</span>
      </div>
      <div className="rvw__row-main">
        <div className="rvw__row-head">
          <h3 className="rvw__row-name">{c.name}</h3>
          <span className="rvw__row-type" style={{ ["--type-c" as unknown as string]: typeColor }}>
            {TYPE_LABELS[c.type] ?? c.type.replace(/_/g, " ")}
          </span>
        </div>
        <div className="rvw__row-meta">
          <span><CalendarIcon /> {fmtPeriod(c.startDate, c.endDate)}</span>
          <span><TrendingUp /> {progress}% complete</span>
          <span>{doneReviews}/{totalReviews} reviews</span>
        </div>
        <div className="rvw__row-bar">
          <div className="rvw__row-bar-fill" style={{ width: `${progress}%`, background: statusColor }} />
        </div>
      </div>
      <ArrowRight className="rvw__row-arrow" />
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub, progress }: { accent: string; Icon: typeof Award; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className="rvw__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="rvw__kpi-accent" aria-hidden="true" />
      <div className="rvw__kpi-row">
        <div className="rvw__kpi-icon"><Icon /></div>
        <div className="rvw__kpi-label">{label}</div>
      </div>
      <div className="rvw__kpi-value">{value}</div>
      <div className="rvw__kpi-sub">{sub}</div>
      {progress !== undefined && <div className="rvw__kpi-bar"><div className="rvw__kpi-bar-fill" style={{ width: `${progress}%` }} /></div>}
    </div>
  );
}
