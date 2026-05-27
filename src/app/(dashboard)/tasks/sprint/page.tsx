"use client";

/* Sprint — the live sprint room.
 *
 * Top stripe: sprint summary (name · day X of Y · committed/done bars).
 * Hero: burndown line chart (ideal vs actual, by day).
 * Below: capacity-by-person — every assignee with their committed h /
 *        completed h, colored green/orange/red based on burn rate.
 * Right rail: at-risk tickets (overdue, blocked, no assignee).
 *
 * Reads:
 *   GET /api/tasks?startDate=…&endDate=…   (we treat last 14 days as "the sprint")
 * Writes:
 *   PATCH /api/tasks { id, status }        when toggling an at-risk item
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, TrendingDown, AlertTriangle, CheckCircle2, Users } from "lucide-react";
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
const sprintStart = () => today0() - 6 * MS_DAY; // ~mid sprint, last 14 days window
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
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const burndown = useMemo(() => {
    // Build per-day points: ideal vs actual remaining-hours line
    const start = sprintStart();
    const totalCommitted = (tasks ?? []).reduce((acc, t) => acc + (t.estimateHours ?? 1), 0);
    const points: { day: number; ideal: number; actual: number; label: string }[] = [];
    const dayElapsed = Math.max(0, Math.min(SPRINT_DAYS, Math.floor((today0() - start) / MS_DAY) + 1));
    for (let i = 0; i < SPRINT_DAYS; i++) {
      const t = start + i * MS_DAY;
      const ideal = totalCommitted * (1 - i / (SPRINT_DAYS - 1));
      let actual = totalCommitted;
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
      if (due0 < t0) return true; // overdue
      if (!t.assignee && t.priority !== "LOW") return true; // unassigned & meaningful
      return false;
    }).slice(0, 10);
  }, [tasks]);

  const doneCount = (tasks ?? []).filter((t) => t.status === "COMPLETED").length;
  const totalCount = tasks?.length ?? 0;
  const completionPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

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
      <header className="sprint__head">
        <div className="sprint__head-l">
          <div className="sprint__icon"><Zap /></div>
          <div>
            <h1 className="sprint__title">Sprint · current 2-week</h1>
            <div className="sprint__sub">
              {tasks === null ? "Loading…" : (
                <>Day {burndown.dayElapsed} of {SPRINT_DAYS} · {doneCount} of {totalCount} done · {completionPct}% complete</>
              )}
            </div>
          </div>
        </div>
        <div className="sprint__progress">
          <div className="sprint__progress-bar">
            <div className="sprint__progress-fill" style={{ width: `${completionPct}%` }} />
          </div>
          <span className="sprint__progress-pct">{completionPct}%</span>
        </div>
      </header>

      {loadError ? (
        <div className="sprint__error">Couldn&apos;t load sprint: {loadError}</div>
      ) : (
        <div className="sprint__grid">
          {/* Burndown */}
          <section className="sprint__card sprint__card--burn">
            <div className="sprint__card-head">
              <TrendingDown /> Burndown
              <span className="sprint__card-sub">ideal vs actual (hours remaining)</span>
            </div>
            <Burndown points={burndown.points} total={burndown.totalCommitted} />
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
                      <div className="sprint__cap-name">{u.name} <span className="sprint__cap-count">· {u.doneTasks}/{u.tasks}</span></div>
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

          {/* At-risk */}
          <section className="sprint__card sprint__card--risk">
            <div className="sprint__card-head">
              <AlertTriangle /> At risk
              <span className="sprint__card-sub">{atRisk.length} need{atRisk.length === 1 ? "s" : ""} attention</span>
            </div>
            <div className="sprint__risks">
              {atRisk.length === 0 ? (
                <div className="sprint__empty">
                  <CheckCircle2 style={{ width: 28, height: 28, color: "var(--os-c-green)", marginBottom: 8 }} />
                  <div style={{ color: "var(--os-c-green)", fontWeight: 600 }}>All clear — no overdue or unassigned tasks.</div>
                </div>
              ) : atRisk.map((t) => {
                const due0 = startOfDay(new Date(t.date)).getTime();
                const overdue = due0 < today0();
                return (
                  <article key={t.id} className="sprint__risk">
                    <button type="button" className="sprint__risk-check" onClick={() => markDone(t.id)} title="Mark done" />
                    <div className="sprint__risk-main">
                      <div className="sprint__risk-title">{t.title}</div>
                      <div className="sprint__risk-meta">
                        {overdue && <span className="sprint__risk-chip sprint__risk-chip--danger">Overdue {Math.floor((today0() - due0) / MS_DAY)}d</span>}
                        {!t.assignee && <span className="sprint__risk-chip sprint__risk-chip--warn">Unassigned</span>}
                        {t.priority === "URGENT" && <span className="sprint__risk-chip sprint__risk-chip--danger">P0</span>}
                        {t.assignee && <span className="sprint__risk-who">{t.assignee.firstName} {t.assignee.lastName}</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Burndown({ points, total }: { points: { day: number; ideal: number; actual: number; label: string }[]; total: number }) {
  const W = 640, H = 220, P = { t: 18, r: 18, b: 28, l: 36 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  const maxY = Math.max(total, 1);
  const x = (i: number) => P.l + (i / (points.length - 1)) * innerW;
  const y = (val: number) => P.t + innerH - (val / maxY) * innerH;

  const idealPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.ideal)}`).join(" ");
  const actualPoints = points.filter((p) => !isNaN(p.actual));
  const actualPath = actualPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.day)} ${y(p.actual)}`).join(" ");

  return (
    <div className="sprint__chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="sprint__svg">
        {/* y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={P.t + innerH * f} y2={P.t + innerH * f} stroke="var(--os-line)" strokeDasharray={f === 1 ? "" : "2 3"} />
        ))}
        {/* ideal */}
        <path d={idealPath} fill="none" stroke="var(--os-ink-3)" strokeWidth={1.5} strokeDasharray="4 4" />
        {/* actual */}
        {actualPath && <path d={actualPath} fill="none" stroke="var(--os-brand)" strokeWidth={2.5} strokeLinejoin="round" />}
        {actualPoints.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={y(p.actual)} r={3} fill="var(--os-brand)" />
        ))}
        {/* x labels */}
        {points.filter((_, i) => i % 2 === 0).map((p) => (
          <text key={p.day} x={x(p.day)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--os-ink-3)">
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
      </div>
    </div>
  );
}
