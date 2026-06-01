"use client";

/* SOPs · Compliance — org compliance dashboard.
 *
 * Reads: GET /api/sop-assignments/compliance
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, AlertCircle, TrendingUp, TrendingDown, Users as UsersIcon, Building,
  Activity, Hash, ClipboardCheck, BookCopy, CheckCircle2, Clock,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
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
      setLoadError(null);
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
    <>
      <OsTitleBar
        title="SOP compliance"
        Icon={ShieldCheck}
        iconGradient={GRAD.redPink}
        description={data === null ? "Loading…" : `${data.overview.completed} / ${data.overview.total} complete · ${data.overview.overallRate}% org rate · ${data.overview.overdue} overdue`}
        actions={
          <div className="cmpl__head-actions">
            <Link href="/sops" className="cmpl__nav-link"><Hash /> All SOPs</Link>
            <Link href="/sops/my-sops" className="cmpl__nav-link"><ClipboardCheck /> My SOPs</Link>
          </div>
        }
      />

      <div className="cmpl">
        {loadError ? (
          <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.redPink} title="Couldn't load compliance" subtitle={loadError} cta="Retry" />
        ) : data === null ? (
          <div className="cmpl__loading">Loading…</div>
        ) : (
          <>
            <div className="cmpl__kpis">
              <KpiTile accent={rateHue(data.overview.overallRate)} Icon={Activity}     label="Org rate"    value={`${data.overview.overallRate}%`} sub={`${data.overview.completed} of ${data.overview.total}`} />
              <KpiTile accent="var(--os-c-blue)"                  Icon={BookCopy}     label="Assignments" value={`${data.overview.total}`}        sub="across SOPs" />
              <KpiTile accent="var(--os-c-orange)"                Icon={Clock}        label="In progress" value={`${data.overview.inProgress}`}   sub="active work" />
              <KpiTile accent={data.overview.overdue > 0 ? "var(--os-c-red)" : "var(--os-c-green)"} Icon={data.overview.overdue > 0 ? AlertCircle : CheckCircle2} label="Overdue" value={`${data.overview.overdue}`} sub={data.overview.overdue > 0 ? "needs attention" : "all on time"} />
            </div>

            <div className="cmpl__grid">
              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><Building /> By department</h2>
                  <span className="cmpl__card-count">{data.departmentCompliance.length}</span>
                </header>
                {data.departmentCompliance.length === 0 ? (
                  <div className="cmpl__card-empty">No department data yet.</div>
                ) : (
                  <div className="cmpl__heatmap">
                    {data.departmentCompliance.map((d) => (
                      <div key={d.departmentId} className="cmpl__bar">
                        <div className="cmpl__bar-label">
                          <span>{d.name}</span>
                          <strong style={{ color: rateHue(d.rate) }}>{d.rate}%</strong>
                        </div>
                        <div className="cmpl__bar-track">
                          <div className="cmpl__bar-fill" style={{ width: `${d.rate}%`, background: rateHue(d.rate) }} />
                        </div>
                        <div className="cmpl__bar-sub">{d.completed} / {d.total}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><TrendingDown style={{ color: "var(--os-c-red)" }} /> Lowest-completion SOPs</h2>
                  <span className="cmpl__card-count">{bottomSops.length}</span>
                </header>
                {bottomSops.length === 0 ? (
                  <div className="cmpl__card-empty">No SOPs with completion data yet.</div>
                ) : (
                  <div className="cmpl__list">
                    {bottomSops.map((s) => (
                      <div key={s.sopId} className="cmpl__sop">
                        <div className="cmpl__sop-title">{s.title}{s.category && <em> · {s.category}</em>}</div>
                        <div className="cmpl__sop-bar">
                          <div className="cmpl__sop-bar-fill" style={{ width: `${s.rate}%`, background: rateHue(s.rate) }} />
                        </div>
                        <span className="cmpl__sop-rate" style={{ color: rateHue(s.rate) }}>{s.rate}% <em>· {s.completed}/{s.total}</em></span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><TrendingUp style={{ color: "var(--os-c-green)" }} /> Top performers</h2>
                  <span className="cmpl__card-count">{topPeople.length}</span>
                </header>
                {topPeople.length === 0 ? (
                  <div className="cmpl__card-empty">No person data yet.</div>
                ) : (
                  <div className="cmpl__list">
                    {topPeople.map((p) => (
                      <div key={p.userId} className="cmpl__person">
                        <span className="cmpl__person-av" style={{ background: avColor(p.userId) }}>{initials(p.name)}</span>
                        <div className="cmpl__person-main">
                          <div className="cmpl__person-name">{p.name}</div>
                          <div className="cmpl__person-meta">{p.department}{p.avgScore != null && ` · avg score ${p.avgScore}`}</div>
                        </div>
                        <span className="cmpl__person-rate" style={{ color: rateHue(p.rate) }}>{p.rate}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><AlertCircle style={{ color: "var(--os-c-red)" }} /> Overdue</h2>
                  <span className="cmpl__card-count">{data.overdueList.length}</span>
                </header>
                {data.overdueList.length === 0 ? (
                  <div className="cmpl__card-empty">
                    <UsersIcon /> All assignments are on time.
                  </div>
                ) : (
                  <div className="cmpl__list">
                    {data.overdueList.slice(0, 10).map((o) => {
                      const days = Math.floor((Date.now() - new Date(o.dueDate).getTime()) / MS_DAY);
                      return (
                        <div key={o.id} className="cmpl__over">
                          <div className="cmpl__over-main">
                            <div className="cmpl__over-title">{o.sopTitle}</div>
                            <div className="cmpl__over-meta">{o.userName} · {o.department}</div>
                          </div>
                          <span className="cmpl__over-days">{days}d late</span>
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
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Activity; label: string; value: string; sub: string }) {
  return (
    <div className="cmpl__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="cmpl__kpi-accent" aria-hidden="true" />
      <div className="cmpl__kpi-row">
        <div className="cmpl__kpi-icon"><Icon /></div>
        <div className="cmpl__kpi-label">{label}</div>
      </div>
      <div className="cmpl__kpi-value">{value}</div>
      <div className="cmpl__kpi-sub">{sub}</div>
    </div>
  );
}
