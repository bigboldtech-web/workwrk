"use client";

/* Compensation — comp cycle list with status flow.
 *
 *  GET   /api/comp-cycles
 *  POST  /api/comp-cycles            { name, startDate, endDate, reportingCurrency?, budgetPct? }
 *  PATCH /api/comp-cycles/[id]       { name?, status?, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet, Plus, Search, ArrowLeft, ChevronRight, Calendar as CalendarIcon,
  Loader2, CheckCircle2, Play, ArrowRight, TrendingUp, Users, Receipt,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type CycleStatus = "DRAFT" | "OPEN" | "CLOSED";
type ApiCycle = {
  id: string;
  name: string;
  description?: string | null;
  status: CycleStatus;
  startDate: string;
  endDate: string;
  budgetPct?: number | null;
  reportingCurrency: string;
  closedAt?: string | null;
  _count?: { decisions?: number };
};

const STATUS_LABELS: Record<CycleStatus, string> = { DRAFT: "Draft", OPEN: "Open", CLOSED: "Closed" };
const STATUS_COLORS: Record<CycleStatus, string> = { DRAFT: C.indigo, OPEN: C.orange, CLOSED: C.green };
const FLOW: CycleStatus[] = ["DRAFT", "OPEN", "CLOSED"];

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysBetween(start: string, end: string): number {
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

export default function CompensationPage() {
  const [cycles, setCycles] = useState<ApiCycle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<CycleStatus>>(new Set());
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/comp-cycles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCycles(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("compensation");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/comp-cycles/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can edit comp cycles");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  async function quickAdd() {
    const name = (typeof window !== "undefined" ? window.prompt("Comp cycle name?") : "")?.trim();
    if (!name) return;
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 86_400_000);
    try {
      const res = await fetch("/api/comp-cycles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, startDate: now.toISOString(), endDate: end.toISOString() }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can create comp cycles");
        else toast("Couldn't create");
        return;
      }
      toast("Cycle created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  const filtered = useMemo(() => {
    let list = cycles ?? [];
    if (statusFilter.size > 0) list = list.filter((c) => statusFilter.has(c.status));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    return list.slice().sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [cycles, statusFilter, search]);

  const stats = useMemo(() => {
    const list = cycles ?? [];
    const byStatus: Record<CycleStatus, number> = { DRAFT: 0, OPEN: 0, CLOSED: 0 };
    for (const c of list) byStatus[c.status]++;
    const totalDecisions = list.reduce((acc, c) => acc + (c._count?.decisions ?? 0), 0);
    return { total: list.length, byStatus, totalDecisions };
  }, [cycles]);

  function toggleStatus(s: CycleStatus) {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next);
  }

  return (
    <>
      <OsTitleBar
        title="Compensation"
        Icon={Wallet}
        iconGradient={GRAD.tealGreen}
        description={cycles === null ? "Loading cycles…" : `${stats.total} cycle${stats.total === 1 ? "" : "s"} · ${stats.byStatus.OPEN} open · ${stats.totalDecisions} decisions`}
        actions={
          <div className="comp__head-actions">
            <button type="button" className="comp__back" onClick={() => history.back()}>
              <ArrowLeft /> Back
            </button>
            <button type="button" className="comp__btn-primary" onClick={quickAdd}>
              <Plus /> New cycle
            </button>
          </div>
        }
      />

      <div className="comp">
        <div className="comp__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Loader2}     label="Open"        value={`${stats.byStatus.OPEN}`}    sub="in flight cycles" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Play}        label="Draft"       value={`${stats.byStatus.DRAFT}`}   sub="ready to launch" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Closed"     value={`${stats.byStatus.CLOSED}`}  sub="historical" />
          <KpiTile accent="var(--os-c-purple)" Icon={TrendingUp}  label="Decisions"   value={`${stats.totalDecisions}`}   sub="across all cycles" />
        </div>

        <div className="comp__toolbar">
          <div className="comp__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cycle name…" />
          </div>
          <div className="comp__chips">
            {FLOW.map((s) => (
              <button
                key={s}
                type="button"
                className={`comp__chip${statusFilter.has(s) ? " is-active" : ""}`}
                style={{ ["--chip-c" as unknown as string]: STATUS_COLORS[s] }}
                onClick={() => toggleStatus(s)}
              >
                <span className="comp__chip-dot" />
                {STATUS_LABELS[s]}
                <span className="comp__chip-count">{stats.byStatus[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Wallet} iconGradient={GRAD.redPink} title="Couldn't load cycles" subtitle={loadError} cta="Retry" />
        ) : cycles === null ? (
          <div className="comp__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView Icon={Wallet} iconGradient={GRAD.tealGreen} title="No comp cycles yet" subtitle="Plan your first comp cycle. Managers propose merit + bonus per direct report; HR finalizes." chips={["Annual", "Mid-year", "Bonus", "Promotion"]} cta="New cycle" />
        ) : filtered.length === 0 ? (
          <div className="comp__empty">
            <Search />
            <div>No cycles match these filters.</div>
            <button type="button" className="comp__empty-reset" onClick={() => { setSearch(""); setStatusFilter(new Set()); }}>Clear</button>
          </div>
        ) : (
          <div className="comp__list">
            {filtered.map((c) => <CycleRow key={c.id} cycle={c} onAdvance={patch} />)}
          </div>
        )}
      </div>
    </>
  );
}

function CycleRow({ cycle: c, onAdvance }: { cycle: ApiCycle; onAdvance: (id: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const statusColor = STATUS_COLORS[c.status];
  const currentIdx = FLOW.indexOf(c.status);
  const next = c.status === "DRAFT" ? "OPEN" : c.status === "OPEN" ? "CLOSED" : null;
  const days = daysBetween(c.startDate, c.endDate);
  const decisions = c._count?.decisions ?? 0;

  return (
    <article className="comp__cycle" style={{ ["--row-c" as unknown as string]: statusColor }}>
      <span className="comp__cycle-accent" aria-hidden="true" />

      <Link href={`/compensation/${c.id}`} className="comp__cycle-main">
        <div className="comp__cycle-head">
          <span className="comp__cycle-status">
            {c.status === "OPEN" ? <Loader2 /> : c.status === "CLOSED" ? <CheckCircle2 /> : <Play />}
            {STATUS_LABELS[c.status]}
          </span>
          <h3 className="comp__cycle-name">{c.name}</h3>
        </div>
        <div className="comp__cycle-flow">
          {FLOW.map((s, i) => {
            const isCurrent = s === c.status;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const tone = isCurrent ? "current" : isPast ? "past" : "future";
            return (
              <span key={s} className={`comp__flow-step comp__flow-step--${tone}`} style={{ ["--step-c" as unknown as string]: STATUS_COLORS[s] }}>
                <span className="comp__flow-dot">{i + 1}</span>
                <span>{STATUS_LABELS[s]}</span>
              </span>
            );
          })}
        </div>
        <div className="comp__cycle-meta">
          <span><CalendarIcon /> {fmtShortDate(c.startDate)} → {fmtShortDate(c.endDate)} <em>({days}d)</em></span>
          <span><Receipt /> Budget {c.budgetPct ?? "—"}% · {c.reportingCurrency}</span>
          <span><Users /> {decisions} decision{decisions === 1 ? "" : "s"}</span>
        </div>
      </Link>

      <div className="comp__cycle-actions">
        {next && (
          <button type="button" className="comp__cycle-advance" onClick={() => onAdvance(c.id, { status: next })} title={`Move to ${STATUS_LABELS[next]}`}>
            <ChevronRight /> {STATUS_LABELS[next]}
          </button>
        )}
        <Link href={`/compensation/${c.id}`} className="comp__cycle-open" title="Open">
          <ArrowRight />
        </Link>
      </div>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Wallet; label: string; value: string; sub: string }) {
  return (
    <div className="comp__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="comp__kpi-accent" aria-hidden="true" />
      <div className="comp__kpi-row">
        <div className="comp__kpi-icon"><Icon /></div>
        <div className="comp__kpi-label">{label}</div>
      </div>
      <div className="comp__kpi-value">{value}</div>
      <div className="comp__kpi-sub">{sub}</div>
    </div>
  );
}
