"use client";

/* SOPs · Compliance — org compliance dashboard.
 *
 * Top: overall stat strip. Below: 4 panels:
 *   - Compliance by department (heatmap bars)
 *   - Bottom-5 SOPs by completion rate (the ones nobody's doing)
 *   - Top performers (people with highest completion rate)
 *   - Overdue assignments table (who needs a nudge)
 *
 * Reads: GET /api/sop-assignments/compliance
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, AlertCircle, TrendingUp, TrendingDown, Users as UsersIcon, Building } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type Overview = { total: number; completed: number; inProgress: number; overdue: number; overallRate: number };
type DeptRow = { departmentId: string; name: string; total: number; completed: number; rate: number };
type PersonRow = { userId: string; name: string; department: string; total: number; completed: number; overdue: number; rate: number; avgScore: number | null };
type SopRow = { sopId: string; title: string; category: string | null; total: number; completed: number; rate: number };
type OverdueRow = { id: string; sopTitle: string; userName: string; department: string; dueDate: string; stepsCompleted: number; stepsTotal: number };

type ApiData = {
  overview: Overview;
  departmentCompliance: DeptRow[];
  personScores: PersonRow[];
  sopCompliance: SopRow[];
  overdueList: OverdueRow[];
};

const MS_DAY = 86_400_000;
function rateHue(pct: number) {
  if (pct >= 90) return "var(--os-c-green)";
  if (pct >= 70) return "var(--os-c-teal)";
  if (pct >= 40) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(name: string) { const [a = "", b = ""] = name.split(/\s+/); return (((a[0] ?? "") + (b[0] ?? "")) || "?").toUpperCase(); }

export default function SopComplianceDashboard() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sop-assignments/compliance");
      if (res.status === 403) { setLoadError("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d.data ?? d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("sops");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const bottomSops = (data?.sopCompliance ?? []).filter((s) => s.total > 0).slice(0, 6);
  const topPeople = (data?.personScores ?? []).filter((p) => p.total > 0).slice(0, 8);

  return (
    <div className="cmpl">
      <header className="cmpl__head">
        <div className="cmpl__head-l">
          <div className="cmpl__icon" style={{ background: "linear-gradient(135deg, var(--os-c-red), var(--os-c-orange))" }}><ShieldCheck /></div>
          <div>
            <h1 className="cmpl__title">SOP compliance</h1>
            <div className="cmpl__sub">
              {data === null ? "Loading…" : `${data.overview.completed} / ${data.overview.total} assignments complete · ${data.overview.overallRate}% org rate · ${data.overview.overdue} overdue`}
            </div>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="cmpl__error">{loadError}</div>
      ) : data === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <section className="cmpl__stats">
            <div className="cmpl-stat">
              <span>Overall rate</span>
              <strong style={{ color: rateHue(data.overview.overallRate) }}>{data.overview.overallRate}%</strong>
            </div>
            <div className="cmpl-stat">
              <span>Assignments</span>
              <strong>{data.overview.total}</strong>
            </div>
            <div className="cmpl-stat">
              <span>In progress</span>
              <strong>{data.overview.inProgress}</strong>
            </div>
            <div className={`cmpl-stat ${data.overview.overdue > 0 ? "is-alert" : ""}`}>
              <span>Overdue</span>
              <strong style={{ color: data.overview.overdue > 0 ? "var(--os-c-red)" : undefined }}>{data.overview.overdue}</strong>
            </div>
          </section>

          <div className="cmpl__grid">
            <section className="cmpl__card">
              <header><Building /> <h2>By department</h2><span>{data.departmentCompliance.length}</span></header>
              {data.departmentCompliance.length === 0 ? (
                <div className="cmpl__empty">No department data yet.</div>
              ) : (
                <div className="cmpl__heatmap">
                  {data.departmentCompliance.map((d) => (
                    <div key={d.departmentId} className="cmpl-bar">
                      <div className="cmpl-bar__label">
                        <span>{d.name}</span>
                        <strong style={{ color: rateHue(d.rate) }}>{d.rate}%</strong>
                      </div>
                      <div className="cmpl-bar__track">
                        <div className="cmpl-bar__fill" style={{ width: `${d.rate}%`, background: rateHue(d.rate) }} />
                      </div>
                      <div className="cmpl-bar__sub">{d.completed} / {d.total}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="cmpl__card">
              <header><TrendingDown style={{ color: "var(--os-c-red)" }} /> <h2>Lowest-completion SOPs</h2><span>{bottomSops.length}</span></header>
              {bottomSops.length === 0 ? (
                <div className="cmpl__empty">No SOPs with completion data yet.</div>
              ) : (
                <div className="cmpl__list">
                  {bottomSops.map((s) => (
                    <div key={s.sopId} className="cmpl-sop">
                      <div className="cmpl-sop__title">{s.title}{s.category && <em> · {s.category}</em>}</div>
                      <div className="cmpl-sop__bar">
                        <div className="cmpl-sop__bar-fill" style={{ width: `${s.rate}%`, background: rateHue(s.rate) }} />
                      </div>
                      <span className="cmpl-sop__rate" style={{ color: rateHue(s.rate) }}>{s.rate}% <em>· {s.completed}/{s.total}</em></span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="cmpl__card">
              <header><TrendingUp style={{ color: "var(--os-c-green)" }} /> <h2>Top performers</h2><span>{topPeople.length}</span></header>
              {topPeople.length === 0 ? (
                <div className="cmpl__empty">No person data yet.</div>
              ) : (
                <div className="cmpl__list">
                  {topPeople.map((p) => (
                    <div key={p.userId} className="cmpl-person">
                      <span className="cmpl-person__av" style={{ background: avColor(p.userId) }}>{initials(p.name)}</span>
                      <div className="cmpl-person__main">
                        <div className="cmpl-person__name">{p.name}</div>
                        <div className="cmpl-person__meta">{p.department}{p.avgScore != null && ` · avg score ${p.avgScore}`}</div>
                      </div>
                      <span className="cmpl-person__rate" style={{ color: rateHue(p.rate) }}>{p.rate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="cmpl__card">
              <header><AlertCircle style={{ color: "var(--os-c-red)" }} /> <h2>Overdue assignments</h2><span>{data.overdueList.length}</span></header>
              {data.overdueList.length === 0 ? (
                <div className="cmpl__empty">
                  <UsersIcon /> All assignments are on time.
                </div>
              ) : (
                <div className="cmpl__list">
                  {data.overdueList.slice(0, 10).map((o) => {
                    const days = Math.floor((Date.now() - new Date(o.dueDate).getTime()) / MS_DAY);
                    return (
                      <div key={o.id} className="cmpl-over">
                        <div>
                          <div className="cmpl-over__title">{o.sopTitle}</div>
                          <div className="cmpl-over__meta">{o.userName} · {o.department}</div>
                        </div>
                        <span className="cmpl-over__days">{days}d late</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
