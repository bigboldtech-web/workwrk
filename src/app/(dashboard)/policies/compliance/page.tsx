"use client";

/* Policies · Compliance — org acknowledgement-adoption dashboard.
 *
 * Reads: GET /api/policies/compliance
 * Reuses the .cmpl__* layout from the SOP compliance dashboard, adapted to
 * ack semantics (no steps/assignment status — just acked / not acked).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, AlertCircle, TrendingUp, TrendingDown, Users as UsersIcon, Building,
  Activity, CheckCircle2, FileText,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";

type Overview = { totalPolicies: number; totalUsers: number; totalRequired: number; totalAcked: number; orgRate: number; pending: number };
type DeptRow = { departmentId: string; name: string; total: number; acked: number; rate: number };
type PersonRow = { userId: string; name: string; department: string; total: number; acked: number; rate: number };
type PolicyRow = { policyId: string; title: string; category: string | null; acked: number; total: number; rate: number };
type PendingRow = { policyId: string; policyTitle: string; userId: string; userName: string; department: string };

type ApiData = {
  overview: Overview;
  departmentCompliance: DeptRow[];
  personScores: PersonRow[];
  policyCompliance: PolicyRow[];
  pendingList: PendingRow[];
};

function rateHue(pct: number) {
  if (pct >= 90) return "var(--os-c-green)";
  if (pct >= 70) return "var(--os-c-teal)";
  if (pct >= 40) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}
const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(name: string) { const [a = "", b = ""] = name.split(/\s+/); return (((a[0] ?? "") + (b[0] ?? "")) || "?").toUpperCase(); }

export default function PolicyComplianceDashboard() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllBottom, setShowAllBottom] = useState(false);
  const [showAllTop, setShowAllTop] = useState(false);
  const [showAllPending, setShowAllPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/policies/compliance");
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

  const bottomAll = (data?.policyCompliance ?? []);
  const topAll = (data?.personScores ?? []).filter((p) => p.total > 0);
  const pendingAll = data?.pendingList ?? [];
  const bottom = showAllBottom ? bottomAll : bottomAll.slice(0, 6);
  const top = showAllTop ? topAll : topAll.slice(0, 8);
  const pending = showAllPending ? pendingAll : pendingAll.slice(0, 10);

  return (
    <>
      <OsTitleBar
        title="Policy compliance"
        Icon={ShieldCheck}
        iconGradient={GRAD.indigoBlue}
        showStandardActions={false}
        description={data === null ? "Loading…" : `${data.overview.totalAcked} / ${data.overview.totalRequired} acks · ${data.overview.orgRate}% org rate · ${data.overview.pending} pending`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/policies" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ShieldCheck className="h-3.5 w-3.5" /> All policies
            </Link>
            <Link href="/sops/compliance" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              SOP compliance
            </Link>
          </div>
        }
      />

      <div className="cmpl">
        {loadError ? (
          <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.indigoBlue} title="Couldn't load compliance" subtitle={loadError} cta="Retry" />
        ) : data === null ? (
          <div className="cmpl__loading">Loading…</div>
        ) : (
          <>
            <div className="cmpl__kpis">
              <KpiTile accent={rateHue(data.overview.orgRate)} Icon={Activity} label="Org ack rate" value={`${data.overview.orgRate}%`} sub={`${data.overview.totalAcked} of ${data.overview.totalRequired}`} />
              <KpiTile accent="var(--os-c-blue)" Icon={FileText} label="Policies" value={`${data.overview.totalPolicies}`} sub="requiring ack" />
              <KpiTile accent="var(--os-c-indigo)" Icon={UsersIcon} label="People" value={`${data.overview.totalUsers}`} sub="in org" />
              <KpiTile accent={data.overview.pending > 0 ? "var(--os-c-red)" : "var(--os-c-green)"} Icon={data.overview.pending > 0 ? AlertCircle : CheckCircle2} label="Pending" value={`${data.overview.pending}`} sub={data.overview.pending > 0 ? "not yet acked" : "all acknowledged"} />
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
                        <div className="cmpl__bar-sub">{d.acked} / {d.total}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><TrendingDown style={{ color: "var(--os-c-red)" }} /> Lowest-adoption policies</h2>
                  <span className="cmpl__card-count">{bottom.length}</span>
                </header>
                {bottom.length === 0 ? (
                  <div className="cmpl__card-empty">No policies requiring acknowledgement yet.</div>
                ) : (
                  <div className="cmpl__list">
                    {bottom.map((s) => (
                      <Link key={s.policyId} href={`/policies/${s.policyId}`} className="cmpl__sop" style={{ textDecoration: "none" }}>
                        <div className="cmpl__sop-title">{s.title}{s.category && <em> · {s.category}</em>}</div>
                        <div className="cmpl__sop-bar">
                          <div className="cmpl__sop-bar-fill" style={{ width: `${s.rate}%`, background: rateHue(s.rate) }} />
                        </div>
                        <span className="cmpl__sop-rate" style={{ color: rateHue(s.rate) }}>{s.rate}% <em>· {s.acked}/{s.total}</em></span>
                      </Link>
                    ))}
                    {bottomAll.length > 6 && (
                      <MoreToggle open={showAllBottom} total={bottomAll.length} onClick={() => setShowAllBottom((v) => !v)} />
                    )}
                  </div>
                )}
              </section>

              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><TrendingUp style={{ color: "var(--os-c-green)" }} /> Top performers</h2>
                  <span className="cmpl__card-count">{top.length}</span>
                </header>
                {top.length === 0 ? (
                  <div className="cmpl__card-empty">No person data yet.</div>
                ) : (
                  <div className="cmpl__list">
                    {top.map((p) => (
                      <div key={p.userId} className="cmpl__person">
                        <span className="cmpl__person-av" style={{ background: avColor(p.userId) }}>{initials(p.name)}</span>
                        <div className="cmpl__person-main">
                          <div className="cmpl__person-name">{p.name}</div>
                          <div className="cmpl__person-meta">{p.department} · {p.acked}/{p.total} acked</div>
                        </div>
                        <span className="cmpl__person-rate" style={{ color: rateHue(p.rate) }}>{p.rate}%</span>
                      </div>
                    ))}
                    {topAll.length > 8 && (
                      <MoreToggle open={showAllTop} total={topAll.length} onClick={() => setShowAllTop((v) => !v)} />
                    )}
                  </div>
                )}
              </section>

              <section className="cmpl__card">
                <header className="cmpl__card-head">
                  <h2><AlertCircle style={{ color: "var(--os-c-red)" }} /> Not yet acknowledged</h2>
                  <span className="cmpl__card-count">{data.overview.pending}</span>
                </header>
                {pendingAll.length === 0 ? (
                  <div className="cmpl__card-empty">
                    <UsersIcon /> Everyone has acknowledged every policy.
                  </div>
                ) : (
                  <div className="cmpl__list">
                    {pending.map((o) => (
                      <div key={`${o.policyId}:${o.userId}`} className="cmpl__over">
                        <div className="cmpl__over-main">
                          <div className="cmpl__over-title">{o.policyTitle}</div>
                          <div className="cmpl__over-meta">{o.userName} · {o.department}</div>
                        </div>
                      </div>
                    ))}
                    {pendingAll.length > 10 && (
                      <MoreToggle open={showAllPending} total={pendingAll.length} onClick={() => setShowAllPending((v) => !v)} />
                    )}
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

function MoreToggle({ open, total, onClick }: { open: boolean; total: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-1 text-[12px] text-zinc-500 hover:text-zinc-800 underline underline-offset-2">
      {open ? "Show less" : `View all ${total}`}
    </button>
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
