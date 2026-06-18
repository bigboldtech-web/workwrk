"use client";

/* Process Runs — checklist SOP executions with KPI strip + status sections.
 *
 *  GET    /api/process-runs
 *  PATCH  /api/process-runs        { id, action: cancel }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ListChecks, Search, Hash, ChevronRight, AlertTriangle, CheckCircle2, Clock,
  XCircle, Layers, Activity, Calendar as CalendarIcon, BookCopy,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PrStatus = "ACTIVE" | "COMPLETED" | "OVERDUE" | "CANCELLED";

type ApiProcessRun = {
  id: string;
  title: string;
  status: PrStatus;
  progress: number;
  dueDate?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  assigneeId?: string | null;
  sopId: string;
  sop?: { id: string; title: string; category?: string | null; sopType?: string } | null;
};

const STATUS_LABEL: Record<PrStatus, string> = {
  ACTIVE: "Active", COMPLETED: "Completed", OVERDUE: "Overdue", CANCELLED: "Cancelled",
};
const STATUS_HUE: Record<PrStatus, string> = {
  ACTIVE: "var(--os-c-orange)", COMPLETED: "var(--os-c-green)",
  OVERDUE: "var(--os-c-red)", CANCELLED: "var(--os-ink-3)",
};
const STATUS_ICON: Record<PrStatus, typeof Clock> = {
  ACTIVE: Clock, COMPLETED: CheckCircle2, OVERDUE: AlertTriangle, CANCELLED: XCircle,
};
const SECTION_ORDER: PrStatus[] = ["OVERDUE", "ACTIVE", "COMPLETED"];

const MS_DAY = 86_400_000;

export default function ProcessRunsPage() {
  const [rows, setRows] = useState<ApiProcessRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | PrStatus>("ALL");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/process-runs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("process-runs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function cancel(id: string) {
    try {
      const res = await fetch("/api/process-runs", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "cancel" }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't cancel"); return; }
      toast("Run cancelled");
      void load();
    } catch { toast("Couldn't cancel"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<PrStatus, number> = { ACTIVE: 0, COMPLETED: 0, OVERDUE: 0, CANCELLED: 0 };
    for (const r of list) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const avgProgress = list.length ? Math.round(list.reduce((a, r) => a + (r.progress ?? 0), 0) / list.length) : 0;
    return { total: list.length, counts, avgProgress };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter !== "ALL") list = list.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      (r.sop?.title ?? "").toLowerCase().includes(q) ||
      (r.sop?.category ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, statusFilter]);

  const grouped = useMemo(() => {
    const m = new Map<PrStatus, ApiProcessRun[]>();
    for (const s of SECTION_ORDER) m.set(s, []);
    for (const r of filtered) {
      if (r.status === "CANCELLED") continue;
      m.get(r.status)?.push(r);
    }
    return SECTION_ORDER.map((s) => ({ status: s, items: m.get(s) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  const cancelled = filtered.filter((r) => r.status === "CANCELLED");

  return (
    <>
      <OsTitleBar
        title="Process runs"
        Icon={ListChecks}
        iconGradient={GRAD.orangePink}
        showStandardActions={false}
        description={rows === null ? "Loading…" : `${stats.total} run${stats.total === 1 ? "" : "s"} · ${stats.counts.ACTIVE} active · ${stats.counts.OVERDUE} overdue · ${stats.avgProgress}% avg`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><BookCopy className="h-3.5 w-3.5" /> SOPs</Link>
            <Link href="/sops/my-sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><Activity className="h-3.5 w-3.5" /> My SOPs</Link>
            <button type="button" onClick={() => toast("Start a run from any checklist SOP")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">
              Start run
            </button>
          </div>
        }
      />

      <div className="prun">
        <div className="prun__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}         label="Active"    value={`${stats.counts.ACTIVE}`}    sub="in progress" />
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle}  label="Overdue"   value={`${stats.counts.OVERDUE}`}   sub="past due" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2}   label="Completed" value={`${stats.counts.COMPLETED}`} sub="this cycle" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Layers}         label="Avg progress" value={`${stats.avgProgress}%`}  sub="across runs" />
        </div>

        <div className="prun__toolbar">
          <div className="prun__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, SOP, category…" />
          </div>
          <div className="prun__filters">
            {(["ALL", "ACTIVE", "OVERDUE", "COMPLETED"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as PrStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`prun__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as PrStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as PrStatus]}
                  <span>{s === "ALL" ? stats.total : stats.counts[s as PrStatus]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={ListChecks} iconGradient={GRAD.redPink} title="Couldn't load runs" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="prun__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={ListChecks}
            iconGradient={GRAD.orangePink}
            title="No process runs yet"
            subtitle="Process runs are instances of checklist SOPs. Open a checklist SOP and click Start run."
            chips={["Checklist", "Assignee", "Due date", "Share link"]}
            cta="Browse SOPs"
          />
        ) : grouped.length === 0 && cancelled.length === 0 ? (
          <div className="prun__no-match"><AlertTriangle /> No runs match the current filter.</div>
        ) : (
          <>
            {grouped.map((g) => {
              const Icon = STATUS_ICON[g.status];
              return (
                <section key={g.status} className="prun__group" style={{ ["--g-c" as unknown as string]: STATUS_HUE[g.status] }}>
                  <header className="prun__group-head">
                    <span className="prun__group-tag"><Icon /> {STATUS_LABEL[g.status]}</span>
                    <span className="prun__group-count">{g.items.length}</span>
                    <span className="prun__group-line" />
                  </header>
                  <div className="prun__list">
                    {g.items.map((r) => <RunRow key={r.id} r={r} onCancel={cancel} />)}
                  </div>
                </section>
              );
            })}
            {cancelled.length > 0 && (
              <details className="prun__archive">
                <summary>Cancelled · {cancelled.length}</summary>
                <div className="prun__archive-list">
                  {cancelled.slice(0, 24).map((r) => (
                    <Link key={r.id} href={`/sops/${r.sopId}`} className="prun__archived">
                      <XCircle />
                      <span className="prun__archived-title">{r.title}</span>
                      <span className="prun__archived-sop">{r.sop?.title ?? "—"}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}

function RunRow({ r, onCancel }: { r: ApiProcessRun; onCancel: (id: string) => void }) {
  const pct = typeof r.progress === "number" ? r.progress : 0;
  const days = r.dueDate ? Math.ceil((new Date(r.dueDate).getTime() - Date.now()) / MS_DAY) : null;
  const dueLabel = !r.dueDate ? null :
    r.status === "COMPLETED" ? new Date(r.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) :
    days !== null && days < 0 ? `${-days}d late` :
    days === 0 ? "Due today" :
    days !== null && days <= 3 ? `Due in ${days}d` :
    `Due ${new Date(r.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const dueTone = !days ? "" : days < 0 ? "is-late" : days <= 3 ? "is-soon" : "";
  return (
    <Link href={r.sopId ? `/sops/${r.sopId}` : "/sops"} className="prun__row">
      <div className="prun__row-main">
        <div className="prun__row-title">{r.title}</div>
        <div className="prun__row-meta">
          {r.sop?.title && <span><BookCopy /> {r.sop.title}</span>}
          {r.sop?.category && <span>{r.sop.category}</span>}
          {dueLabel && <span className={`prun__row-due ${dueTone}`}><CalendarIcon /> {dueLabel}</span>}
        </div>
        {r.status !== "COMPLETED" && (
          <div className="prun__row-bar"><div className="prun__row-bar-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <div className="prun__row-right">
        <span className="prun__row-pct">{pct}%</span>
        {(r.status === "ACTIVE" || r.status === "OVERDUE") && (
          <button
            type="button"
            className="prun__row-cancel"
            onClick={(e) => { e.preventDefault(); onCancel(r.id); }}
          >
            <XCircle /> Cancel
          </button>
        )}
        <ChevronRight className="prun__row-arrow" />
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Clock; label: string; value: string; sub: string }) {
  return (
    <div className="prun__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="prun__kpi-accent" aria-hidden="true" />
      <div className="prun__kpi-row">
        <div className="prun__kpi-icon"><Icon /></div>
        <div className="prun__kpi-label">{label}</div>
      </div>
      <div className="prun__kpi-value">{value}</div>
      <div className="prun__kpi-sub">{sub}</div>
    </div>
  );
}
