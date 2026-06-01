"use client";

/* Onboarding — new-hire journeys with KPI strip + status sections.
 *
 *  GET /api/onboarding
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IdCard, Search, Hash, ChevronRight, Activity, CheckCircle2, AlertTriangle,
  Clock, Users, Building, Calendar as CalendarIcon, Award, Sparkles,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ObStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

type ApiInstance = {
  id: string;
  status: ObStatus;
  startDate: string;
  targetDate?: string | null;
  completedAt?: string | null;
  progress: Array<{ stepId?: string; done?: boolean } | unknown> | unknown;
  user?: { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null } | null;
  buddy?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  template?: { name: string; steps?: unknown[]; durationDays?: number } | null;
};

const STATUS_LABEL: Record<ObStatus, string> = {
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", OVERDUE: "Overdue",
};
const STATUS_HUE: Record<ObStatus, string> = {
  NOT_STARTED: "var(--os-c-indigo)", IN_PROGRESS: "var(--os-c-orange)",
  COMPLETED: "var(--os-c-green)", OVERDUE: "var(--os-c-red)",
};
const STATUS_ICON: Record<ObStatus, typeof Clock> = {
  NOT_STARTED: Clock, IN_PROGRESS: Activity, COMPLETED: CheckCircle2, OVERDUE: AlertTriangle,
};
const GROUP_ORDER: ObStatus[] = ["OVERDUE", "IN_PROGRESS", "NOT_STARTED", "COMPLETED"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }
function fullName(u?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!u) return "Unknown";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unknown";
}

function progressPct(inst: ApiInstance): number {
  const totalSteps = Array.isArray(inst.template?.steps) ? inst.template.steps.length : 0;
  const progress = Array.isArray(inst.progress) ? inst.progress : [];
  const doneSteps = progress.filter((p) => (p as { done?: boolean })?.done === true).length;
  if (totalSteps === 0) return inst.status === "COMPLETED" ? 100 : 0;
  return Math.round((doneSteps / totalSteps) * 100);
}

const MS_DAY = 86_400_000;

export default function OnboardingPage() {
  const [rows, setRows] = useState<ApiInstance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ObStatus>("ALL");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("onboarding");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<ObStatus, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0, OVERDUE: 0 };
    for (const r of list) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const totalPct = list.length > 0 ? list.reduce((a, r) => a + progressPct(r), 0) / list.length : 0;
    return { total: list.length, counts, avgPct: Math.round(totalPct) };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter !== "ALL") list = list.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) =>
      fullName(r.user).toLowerCase().includes(q) ||
      (r.template?.name ?? "").toLowerCase().includes(q) ||
      (r.user?.department?.name ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, statusFilter]);

  const grouped = useMemo(() => {
    const m = new Map<ObStatus, ApiInstance[]>();
    for (const s of GROUP_ORDER) m.set(s, []);
    for (const r of filtered) m.get(r.status)?.push(r);
    return GROUP_ORDER.map((s) => ({ status: s, items: m.get(s) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Onboarding"
        Icon={IdCard}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading…" : `${stats.total} journey${stats.total === 1 ? "" : "s"} · ${stats.counts.IN_PROGRESS} active · ${stats.counts.OVERDUE} overdue · ${stats.avgPct}% avg progress`}
        actions={
          <div className="onb__head-actions">
            <Link href="/onboarding/me" className="onb__nav-link"><Sparkles /> My onboarding</Link>
            <Link href="/people" className="onb__nav-link"><Users /> People</Link>
          </div>
        }
      />

      <div className="onb">
        <div className="onb__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}     label="In progress"  value={`${stats.counts.IN_PROGRESS}`} sub={`${stats.avgPct}% avg`} />
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Overdue"      value={`${stats.counts.OVERDUE}`}     sub="needs attention" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Clock}        label="Not started"  value={`${stats.counts.NOT_STARTED}`} sub="upcoming" />
          <KpiTile accent="var(--os-c-green)"  Icon={Award}        label="Completed"    value={`${stats.counts.COMPLETED}`}   sub="this cycle" />
        </div>

        <div className="onb__toolbar">
          <div className="onb__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, template, department…" />
          </div>
          <div className="onb__filters">
            {(["ALL", "IN_PROGRESS", "OVERDUE", "NOT_STARTED", "COMPLETED"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as ObStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`onb__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as ObStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as ObStatus]}
                  <span>{s === "ALL" ? stats.total : stats.counts[s as ObStatus]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={IdCard} iconGradient={GRAD.redPink} title="Couldn't load" subtitle={loadError} cta="Retry" />
        ) : rows === null ? (
          <div className="onb__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={IdCard}
            iconGradient={GRAD.orangePink}
            title="No onboarding journeys yet"
            subtitle="When you hire someone in Recruiting, an onboarding instance auto-starts from the matching template."
            chips={["Templates", "Buddies", "Checklists"]}
            cta="Set up templates"
          />
        ) : (
          grouped.map((g) => {
            const Icon = STATUS_ICON[g.status];
            return (
              <section key={g.status} className="onb__section" style={{ ["--s-c" as unknown as string]: STATUS_HUE[g.status] }}>
                <header className="onb__section-head">
                  <span className="onb__section-tag"><Icon /> {STATUS_LABEL[g.status]}</span>
                  <span className="onb__section-count">{g.items.length}</span>
                  <span className="onb__section-line" />
                </header>
                <div className="onb__list">
                  {g.items.map((i) => <OnboardRow key={i.id} i={i} />)}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function OnboardRow({ i }: { i: ApiInstance }) {
  const pct = progressPct(i);
  const userColor = i.user ? avColor(i.user.id) : "var(--os-ink-3)";
  const days = i.targetDate ? Math.ceil((new Date(i.targetDate).getTime() - Date.now()) / MS_DAY) : null;
  const targetLabel = !i.targetDate ? null :
    i.status === "COMPLETED" ? null :
    days !== null && days < 0 ? `${-days}d late` :
    days === 0 ? "Due today" :
    days !== null && days <= 7 ? `Due in ${days}d` :
    `Target ${new Date(i.targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const targetTone = !days ? "" : days < 0 ? "is-late" : days <= 7 ? "is-soon" : "";
  return (
    <Link href={i.user?.id ? `/people/${i.user.id}` : "/onboarding"} className={`onb__row${i.status === "COMPLETED" ? " is-done" : ""}`}>
      <span className="onb__row-av" style={{ background: userColor }}>{initials(i.user?.firstName, i.user?.lastName)}</span>
      <div className="onb__row-main">
        <div className="onb__row-name">{fullName(i.user)}</div>
        <div className="onb__row-meta">
          <span>{i.template?.name ?? "Onboarding"}</span>
          {i.user?.department?.name && <span><Building /> {i.user.department.name}</span>}
          {i.buddy && <span>Buddy: {fullName(i.buddy)}</span>}
          {targetLabel && <span className={`onb__row-target ${targetTone}`}><CalendarIcon /> {targetLabel}</span>}
        </div>
        {i.status !== "COMPLETED" && (
          <div className="onb__row-bar"><div className="onb__row-bar-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <div className="onb__row-right">
        <span className="onb__row-pct">{pct}%</span>
        <ChevronRight className="onb__row-arrow" />
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof IdCard; label: string; value: string; sub: string }) {
  return (
    <div className="onb__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="onb__kpi-accent" aria-hidden="true" />
      <div className="onb__kpi-row">
        <div className="onb__kpi-icon"><Icon /></div>
        <div className="onb__kpi-label">{label}</div>
      </div>
      <div className="onb__kpi-value">{value}</div>
      <div className="onb__kpi-sub">{sub}</div>
    </div>
  );
}
