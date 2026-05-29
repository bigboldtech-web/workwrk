"use client";

/* Sprint — the live sprint room.
 *
 * Top: OsTitleBar with sprint name + verdict pill (ahead/on-track/behind) + actions.
 * Hero strip: 4 KPI tiles (Day X/Y · Committed h · Burned h · Completion %).
 * Body grid:
 *   - Burndown card (left, spans 2 rows): ideal vs actual line with today marker,
 *     gradient area fill, verdict pill in header.
 *   - Capacity card (left, bottom): per-assignee bars with workload tone.
 *   - At-risk card (right, spans 2 rows): scrollable list, priority strips,
 *     hover-reveal "Mark done" action.
 *
 * Reads:  GET  /api/tasks?startDate=…&endDate=…   (14-day window centered ~mid-sprint)
 * Writes: PATCH /api/tasks { id, status }         (mark at-risk item done)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, TrendingDown, AlertTriangle, CheckCircle2, Users, Play, Flag } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type ApiStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";
type ApiTask = {
  id: string;
  title: string;
  date: string;
  status: ApiStatus;
  priority: ApiPrio;
  completedAt?: string | null;
  estimateHours?: number | null;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

const SPRINT_DAYS = 14;
const today0 = () => startOfDay(new Date()).getTime();
const sprintStart = () => today0() - 6 * MS_DAY;
const sprintEnd = () => sprintStart() + SPRINT_DAYS * MS_DAY;

function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

export default function SprintPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const from = new Date(sprintStart()).toISOString().slice(0, 10);
      const to   = new Date(sprintEnd()).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      setTasks(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const burndown = useMemo(() => {
    const start = sprintStart();
    const totalCommitted = (tasks ?? []).reduce((acc, t) => acc + (t.estimateHours ?? 1), 0);
    const points: { day: number; ideal: number; actual: number; label: string }[] = [];
    const dayElapsed = Math.max(0, Math.min(SPRINT_DAYS, Math.floor((today0() - start) / MS_DAY) + 1));
    for (let i = 0; i < SPRINT_DAYS; i++) {
      const t = start + i * MS_DAY;
      const ideal = totalCommitted * (1 - i / (SPRINT_DAYS - 1));
      let actual: number = totalCommitted;
      if (i <= dayElapsed - 1) {
        const completedByThen = (tasks ?? []).filter((task) => task.completedAt && new Date(task.completedAt).getTime() <= t + MS_DAY - 1);
        const burned = completedByThen.reduce((acc, x) => acc + (x.estimateHours ?? 1), 0);
        actual = totalCommitted - burned;
      } else {
        actual = NaN;
      }
      points.push({ day: i, ideal, actual, label: dayLabel(t) });
    }
    return { points, totalCommitted, dayElapsed };
  }, [tasks]);

  const capacity = useMemo(() => {
    const byUser = new Map<string, { id: string; name: string; committed: number; done: number; tasks: number; doneTasks: number }>();
    const UNASSIGNED = "__none";
    for (const t of tasks ?? []) {
      const key = t.assignee?.id ?? UNASSIGNED;
      const name = t.assignee ? `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || "Unknown" : "Unassigned";
      if (!byUser.has(key)) byUser.set(key, { id: key, name, committed: 0, done: 0, tasks: 0, doneTasks: 0 });
      const u = byUser.get(key)!;
      const h = t.estimateHours ?? 1;
      u.committed += h;
      u.tasks += 1;
      if (t.status === "COMPLETED") { u.done += h; u.doneTasks += 1; }
    }
    return Array.from(byUser.values()).sort((a, b) => b.committed - a.committed);
  }, [tasks]);

  const atRisk = useMemo(() => {
    const t0 = today0();
    return (tasks ?? []).filter((t) => {
      if (t.status === "COMPLETED") return false;
      const due0 = startOfDay(new Date(t.date)).getTime();
      if (due0 < t0) return true;
      if (!t.assignee && t.priority !== "LOW") return true;
      return false;
    }).slice(0, 12);
  }, [tasks]);

  const doneCount = (tasks ?? []).filter((t) => t.status === "COMPLETED").length;
  const totalCount = tasks?.length ?? 0;
  const completionPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  // Verdict: compare current actual to expected ideal at this point in sprint
  const verdict = useMemo(() => {
    if (totalCount === 0 || burndown.dayElapsed === 0) return { tone: "neutral" as const, label: "Planning" };
    const expected = burndown.totalCommitted * (1 - (burndown.dayElapsed - 1) / (SPRINT_DAYS - 1));
    const currentRemaining = burndown.totalCommitted - (tasks ?? []).filter((t) => t.status === "COMPLETED").reduce((a, t) => a + (t.estimateHours ?? 1), 0);
    const delta = expected - currentRemaining;
    if (delta > burndown.totalCommitted * 0.05) return { tone: "good" as const, label: "Ahead of pace" };
    if (delta < -burndown.totalCommitted * 0.05) return { tone: "bad" as const, label: "Behind pace" };
    return { tone: "ok" as const, label: "On track" };
  }, [tasks, burndown, totalCount]);

  const burnedH = (tasks ?? []).filter((t) => t.status === "COMPLETED").reduce((a, t) => a + (t.estimateHours ?? 1), 0);

  async function markDone(id: string) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, status: "COMPLETED" as ApiStatus, completedAt: new Date().toISOString() } : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "COMPLETED" }) });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch {
      toast("Couldn't update");
      void load();
    }
  }

  return (
    <div className="sprint">
      <OsTitleBar
        title="Sprint"
        Icon={Zap}
        iconGradient={GRAD.orangePink}
        description={tasks === null ? "Loading…" : `Day ${burndown.dayElapsed} of ${SPRINT_DAYS} · ${doneCount}/${totalCount} done`}
        actions={
          <div className="sprint__head-actions">
            <span className={`sprint__verdict sprint__verdict--${verdict.tone}`}>
              <Flag /> {verdict.label}
            </span>
            <button type="button" className="sprint__btn sprint__btn--ghost">
              <Flag /> End sprint
            </button>
            <button type="button" className="sprint__btn sprint__btn--primary">
              <Play /> Start next
            </button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="sprint__kpis">
        <KpiTile
          accent="var(--os-c-orange)"
          label="Day"
          value={`${burndown.dayElapsed} / ${SPRINT_DAYS}`}
          sub={`${SPRINT_DAYS - burndown.dayElapsed} day${SPRINT_DAYS - burndown.dayElapsed === 1 ? "" : "s"} left`}
        />
        <KpiTile
          accent="var(--os-c-purple)"
          label="Committed"
          value={`${burndown.totalCommitted.toFixed(0)}h`}
          sub={`${totalCount} item${totalCount === 1 ? "" : "s"}`}
        />
        <KpiTile
          accent="var(--os-c-green)"
          label="Burned"
          value={`${burnedH.toFixed(0)}h`}
          sub={`${doneCount} done`}
        />
        <KpiTile
          accent="var(--os-c-blue)"
          label="Completion"
          value={`${completionPct}%`}
          sub={`${atRisk.length} at risk`}
          progress={completionPct}
        />
      </div>

      {loadError ? (
        <div className="sprint__error">Couldn&apos;t load sprint: {loadError}</div>
      ) : (
        <div className="sprint__grid">
          {/* Burndown */}
          <section className="sprint__card sprint__card--burn">
            <div className="sprint__card-head">
              <TrendingDown /> Burndown
              <span className="sprint__card-sub">ideal vs actual (hours remaining)</span>
              <span className={`sprint__card-verdict sprint__card-verdict--${verdict.tone}`}>{verdict.label}</span>
            </div>
            <Burndown points={burndown.points} total={burndown.totalCommitted} dayElapsed={burndown.dayElapsed} />
          </section>

          {/* At-risk */}
          <section className="sprint__card sprint__card--risk">
            <div className="sprint__card-head">
              <AlertTriangle /> At risk
              <span className="sprint__card-sub">{atRisk.length} need{atRisk.length === 1 ? "s" : ""} attention</span>
            </div>
            <div className="sprint__risks">
              {atRisk.length === 0 ? (
                <div className="sprint__empty sprint__empty--clear">
                  <CheckCircle2 />
                  <div className="sprint__empty-title">All clear</div>
                  <div className="sprint__empty-sub">No overdue or unassigned tasks.</div>
                </div>
              ) : atRisk.map((t) => {
                const due0 = startOfDay(new Date(t.date)).getTime();
                const overdue = due0 < today0();
                const prioTone =
                  t.priority === "URGENT" ? "var(--os-c-red)" :
                  t.priority === "HIGH" ? "var(--os-c-orange)" :
                  t.priority === "NORMAL" ? "var(--os-c-blue)" : "var(--os-c-sage)";
                return (
                  <article key={t.id} className="sprint__risk">
                    <span className="sprint__risk-accent" style={{ background: prioTone }} aria-hidden="true" />
                    <button type="button" className="sprint__risk-check" onClick={() => markDone(t.id)} title="Mark done" aria-label="Mark done" />
                    <div className="sprint__risk-main">
                      <div className="sprint__risk-title">{t.title}</div>
                      <div className="sprint__risk-meta">
                        {overdue && <span className="sprint__risk-chip sprint__risk-chip--danger">Overdue {Math.floor((today0() - due0) / MS_DAY)}d</span>}
                        {!t.assignee && <span className="sprint__risk-chip sprint__risk-chip--warn">Unassigned</span>}
                        {t.priority === "URGENT" && <span className="sprint__risk-chip sprint__risk-chip--danger">P0</span>}
                        {t.priority === "HIGH" && <span className="sprint__risk-chip sprint__risk-chip--warnAccent">P1</span>}
                        {t.assignee && <span className="sprint__risk-who">{t.assignee.firstName} {t.assignee.lastName}</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Capacity */}
          <section className="sprint__card sprint__card--cap">
            <div className="sprint__card-head">
              <Users /> Capacity by person
              <span className="sprint__card-sub">{capacity.length} contributor{capacity.length === 1 ? "" : "s"}</span>
            </div>
            <div className="sprint__caps">
              {capacity.length === 0 ? (
                <div className="sprint__empty">No tasks in this sprint yet.</div>
              ) : capacity.map((u) => {
                const pct = u.committed === 0 ? 0 : Math.round((u.done / u.committed) * 100);
                const tone = pct >= 70 ? "good" : pct >= 30 ? "warn" : "low";
                return (
                  <div key={u.id} className="sprint__cap">
                    <div className="sprint__cap-av" style={{ background: avColor(u.id) }}>
                      {initials(u.name.split(" ")[0], u.name.split(" ")[1])}
                    </div>
                    <div className="sprint__cap-main">
                      <div className="sprint__cap-name">
                        {u.name}
                        <span className="sprint__cap-count"> · {u.doneTasks}/{u.tasks}</span>
                      </div>
                      <div className="sprint__cap-bar">
                        <div className={`sprint__cap-fill sprint__cap-fill--${tone}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="sprint__cap-num">
                      <span className={`sprint__cap-pct sprint__cap-pct--${tone}`}>{pct}%</span>
                      <span className="sprint__cap-h">{u.done.toFixed(0)} / {u.committed.toFixed(0)}h</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function KpiTile({ accent, label, value, sub, progress }: { accent: string; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className="sprint__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="sprint__kpi-accent" aria-hidden="true" />
      <div className="sprint__kpi-label">{label}</div>
      <div className="sprint__kpi-value">{value}</div>
      <div className="sprint__kpi-sub">{sub}</div>
      {progress !== undefined && (
        <div className="sprint__kpi-bar">
          <div className="sprint__kpi-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function Burndown({ points, total, dayElapsed }: { points: { day: number; ideal: number; actual: number; label: string }[]; total: number; dayElapsed: number }) {
  const W = 720, H = 240, P = { t: 18, r: 18, b: 32, l: 40 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  const maxY = Math.max(total, 1);
  const x = (i: number) => P.l + (i / (points.length - 1)) * innerW;
  const y = (val: number) => P.t + innerH - (val / maxY) * innerH;

  const idealPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.ideal)}`).join(" ");
  const actualPoints = points.filter((p) => !isNaN(p.actual));
  const actualPath = actualPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.day)} ${y(p.actual)}`).join(" ");
  // Area fill underneath actual line (closed at bottom)
  const areaPath = actualPoints.length
    ? `${actualPath} L ${x(actualPoints[actualPoints.length - 1].day)} ${P.t + innerH} L ${x(actualPoints[0].day)} ${P.t + innerH} Z`
    : "";
  const todayX = dayElapsed > 0 ? x(Math.min(dayElapsed - 1, points.length - 1)) : null;

  return (
    <div className="sprint__chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="sprint__svg">
        <defs>
          <linearGradient id="sprintBurnFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--os-brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--os-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={P.t + innerH * f} y2={P.t + innerH * f} stroke="var(--os-line)" strokeDasharray={f === 1 ? "" : "2 3"} />
        ))}
        {/* today vertical */}
        {todayX !== null && (
          <>
            <line x1={todayX} x2={todayX} y1={P.t} y2={P.t + innerH} stroke="var(--os-c-red)" strokeWidth={1} strokeDasharray="3 3" opacity="0.6" />
            <text x={todayX} y={P.t - 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--os-c-red)">TODAY</text>
          </>
        )}
        {/* area fill */}
        {areaPath && <path d={areaPath} fill="url(#sprintBurnFill)" />}
        {/* ideal */}
        <path d={idealPath} fill="none" stroke="var(--os-ink-3)" strokeWidth={1.5} strokeDasharray="4 4" />
        {/* actual */}
        {actualPath && <path d={actualPath} fill="none" stroke="var(--os-brand)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {actualPoints.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={y(p.actual)} r={3.5} fill="white" stroke="var(--os-brand)" strokeWidth={1.5} />
        ))}
        {/* x labels */}
        {points.filter((_, i) => i % 2 === 0).map((p) => (
          <text key={p.day} x={x(p.day)} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--os-ink-3)">
            {p.label}
          </text>
        ))}
        {/* y labels */}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={P.l - 6} y={P.t + innerH * (1 - f) + 4} textAnchor="end" fontSize="10" fill="var(--os-ink-3)">
            {Math.round(maxY * f)}h
          </text>
        ))}
      </svg>
      <div className="sprint__chart-legend">
        <span><span className="sprint__chart-swatch" style={{ background: "var(--os-brand)" }} /> Actual</span>
        <span><span className="sprint__chart-swatch sprint__chart-swatch--dash" /> Ideal</span>
        <span><span className="sprint__chart-swatch sprint__chart-swatch--today" /> Today</span>
      </div>
    </div>
  );
}
