"use client";

/* CRM · Reports — bespoke charts dashboard (no chart deps).
 *
 *  GET /api/crm/leads
 *  GET /api/crm/accounts
 *  GET /api/crm/opportunities
 *  GET /api/crm/pipeline-stages
 *
 * Layout:
 *   OsTitleBar with period selector + nav links in actions slot.
 *   Hero KPI strip: Pipeline · Win rate · Avg won deal · Open deals.
 *   2-col body:
 *     Left wide: Stage funnel + Stage value bar chart.
 *     Right: Lead conversion donut + Account mix donut.
 *   Bottom: Won/lost monthly trend (inline SVG area chart).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart as LineChartIcon, DollarSign, Target, TrendingUp, Layers,
  PieChart as PieChartIcon, BarChart3, Filter,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiLead = { id: string; status: "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED"; createdAt: string };
type ApiAccount = { id: string; type: "PROSPECT" | "CUSTOMER" | "PARTNER" | "CHURNED" | "COMPETITOR"; createdAt: string };
type ApiOpportunity = {
  id: string;
  amount?: number | string | null;
  pipelineStageId?: string | null;
  isWon?: boolean | null;
  closedAt?: string | null;
  createdAt: string;
  pipelineStage?: { name: string; isWon: boolean; isLost: boolean } | null;
};
type ApiStage = { id: string; name: string; position: number; isWon: boolean; isLost: boolean; probability: number };

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

type Period = "quarter" | "year" | "all";

export default function CrmReportsPage() {
  const [leads, setLeads] = useState<ApiLead[] | null>(null);
  const [accounts, setAccounts] = useState<ApiAccount[] | null>(null);
  const [opps, setOpps] = useState<ApiOpportunity[] | null>(null);
  const [stages, setStages] = useState<ApiStage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("quarter");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [lRes, aRes, oRes, sRes] = await Promise.all([
        fetch("/api/crm/leads"),
        fetch("/api/crm/accounts"),
        fetch("/api/crm/opportunities"),
        fetch("/api/crm/pipeline-stages"),
      ]);
      if (!lRes.ok) throw new Error(`leads ${lRes.status}`);
      if (!aRes.ok) throw new Error(`accounts ${aRes.status}`);
      if (!oRes.ok) throw new Error(`opps ${oRes.status}`);
      if (!sRes.ok) throw new Error(`stages ${sRes.status}`);
      const lJ = await lRes.json();
      const aJ = await aRes.json();
      const oJ = await oRes.json();
      const sJ = await sRes.json();
      setLeads(lJ.leads ?? lJ.data ?? []);
      setAccounts(aJ.accounts ?? aJ.data ?? []);
      setOpps(oJ.opportunities ?? oJ.data ?? []);
      const stageList: ApiStage[] = sJ.stages ?? sJ.data ?? [];
      stageList.sort((a, b) => a.position - b.position);
      setStages(stageList);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/reports");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);
  const vCrm = rowVersion("crm");
  useEffect(() => { if (vCrm > 0) void load(); }, [vCrm, load]);

  // ─── Period filter ─────────────────────────────────────────
  const inPeriod = useCallback((iso: string): boolean => {
    if (period === "all") return true;
    const t = new Date(iso).getTime();
    const now = new Date();
    if (period === "quarter") {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1).getTime();
      const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59).getTime();
      return t >= start && t <= end;
    }
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59).getTime();
    return t >= start && t <= end;
  }, [period]);

  // ─── Aggregations ──────────────────────────────────────────
  const ready = leads !== null && accounts !== null && opps !== null && stages !== null;

  const scoped = useMemo(() => {
    const lScope = (leads ?? []).filter((l) => inPeriod(l.createdAt));
    const aScope = (accounts ?? []).filter((a) => inPeriod(a.createdAt));
    const oScope = (opps ?? []).filter((o) => inPeriod(o.closedAt ?? o.createdAt));
    return { leads: lScope, accounts: aScope, opps: oScope };
  }, [leads, accounts, opps, inPeriod]);

  const kpis = useMemo(() => {
    const open = scoped.opps.filter((o) => !o.closedAt);
    const won = scoped.opps.filter((o) => o.isWon === true);
    const lost = scoped.opps.filter((o) => o.isWon === false && !!o.closedAt);
    const closed = won.length + lost.length;
    const pipelineValue = open.reduce((acc, o) => acc + num(o.amount), 0);
    const wonValue = won.reduce((acc, o) => acc + num(o.amount), 0);
    const avgWin = won.length > 0 ? wonValue / won.length : 0;
    const winRate = closed === 0 ? 0 : Math.round((won.length / closed) * 100);
    return { open, won, lost, closed, pipelineValue, wonValue, avgWin, winRate };
  }, [scoped]);

  // Stage funnel: ordered by position, count per stage. Conversion = current / first.
  const funnel = useMemo(() => {
    if (!stages) return [];
    const active = stages.filter((s) => !s.isWon && !s.isLost);
    return active.map((s, i) => {
      const dealsInOrAfter = scoped.opps.filter((o) => {
        const stageIdx = active.findIndex((x) => x.id === o.pipelineStageId);
        return stageIdx >= i || o.isWon === true;
      });
      return { stage: s, count: dealsInOrAfter.length };
    });
  }, [stages, scoped]);
  const funnelTop = funnel[0]?.count ?? 1;

  // Stage value bars (open only)
  const stageBars = useMemo(() => {
    if (!stages) return [];
    return stages.filter((s) => !s.isWon && !s.isLost).map((s) => {
      const inStage = scoped.opps.filter((o) => o.pipelineStageId === s.id);
      const value = inStage.reduce((acc, o) => acc + num(o.amount), 0);
      return { stage: s, value, count: inStage.length };
    });
  }, [stages, scoped]);
  const maxStageValue = Math.max(1, ...stageBars.map((b) => b.value));

  // Lead conversion donut
  const leadSlices = useMemo(() => {
    const groups = [
      { id: "NEW",         label: "New",         count: 0, color: C.indigo },
      { id: "CONTACTED",   label: "Contacted",   count: 0, color: C.orange },
      { id: "QUALIFIED",   label: "Qualified",   count: 0, color: C.purple },
      { id: "CONVERTED",   label: "Converted",   count: 0, color: C.green  },
      { id: "UNQUALIFIED", label: "Unqualified", count: 0, color: C.gray   },
      { id: "DISQUALIFIED",label: "Disqualified",count: 0, color: C.red    },
    ];
    for (const l of scoped.leads) {
      const g = groups.find((x) => x.id === l.status);
      if (g) g.count++;
    }
    return groups.filter((g) => g.count > 0);
  }, [scoped.leads]);

  // Account mix donut
  const accountSlices = useMemo(() => {
    const groups = [
      { id: "CUSTOMER",   label: "Customers",   count: 0, color: C.green  },
      { id: "PROSPECT",   label: "Prospects",   count: 0, color: C.indigo },
      { id: "PARTNER",    label: "Partners",    count: 0, color: C.purple },
      { id: "COMPETITOR", label: "Competitors", count: 0, color: C.red    },
      { id: "CHURNED",    label: "Churned",     count: 0, color: C.gray   },
    ];
    for (const a of scoped.accounts) {
      const g = groups.find((x) => x.id === a.type);
      if (g) g.count++;
    }
    return groups.filter((g) => g.count > 0);
  }, [scoped.accounts]);

  // Won/Lost monthly trend (last 6 months)
  const trend = useMemo(() => {
    const monthsBack = 6;
    const buckets: { label: string; key: string; won: number; lost: number; wonValue: number }[] = [];
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        label: d.toLocaleDateString("en-US", { month: "short" }),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        won: 0, lost: 0, wonValue: 0,
      });
    }
    for (const o of opps ?? []) {
      const dateStr = o.closedAt ?? null;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.find((x) => x.key === k);
      if (b) {
        if (o.isWon === true) { b.won++; b.wonValue += num(o.amount); }
        else if (o.isWon === false) { b.lost++; }
      }
    }
    return buckets;
  }, [opps]);

  return (
    <>
      <OsTitleBar
        title="Reports"
        Icon={LineChartIcon}
        iconGradient={GRAD.greenTeal}
        description={!ready
          ? "Computing reports…"
          : `${kpis.open.length} open · ${kpis.winRate}% win rate · ${fmtMoney(kpis.pipelineValue)} pipeline`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={4}
        actions={
          <div className="rpt__head-actions">
            <div className="rpt__period">
              {(["quarter", "year", "all"] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={period === p ? "is-active" : ""}
                  onClick={() => setPeriod(p)}
                >
                  {p === "quarter" ? "This Q" : p === "year" ? "This year" : "All time"}
                </button>
              ))}
            </div>
            <Link href="/crm" className="rpt__nav-link">Pipeline</Link>
            <Link href="/crm/activities" className="rpt__nav-link">Activity</Link>
          </div>
        }
      />

      <div className="rpt">
        {/* KPI strip */}
        <div className="rpt__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={DollarSign} label="Pipeline"     value={fmtMoney(kpis.pipelineValue)}    sub={`${kpis.open.length} open deal${kpis.open.length === 1 ? "" : "s"}`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Target}     label="Win rate"     value={`${kpis.winRate}%`}              sub={`${kpis.won.length}/${kpis.closed} closed`} progress={kpis.winRate} />
          <KpiTile accent="var(--os-c-purple)" Icon={TrendingUp} label="Avg won deal" value={fmtMoney(kpis.avgWin)}            sub={fmtMoney(kpis.wonValue) + " total won"} />
          <KpiTile accent="var(--os-c-orange)" Icon={Layers}     label="Stages"       value={`${stages?.length ?? 0}`}         sub={`${kpis.lost.length} lost ${period === "all" ? "" : "this period"}`} />
        </div>

        {loadError ? (
          <OsEmptyView Icon={LineChartIcon} iconGradient={GRAD.redPink} title="Couldn't compute reports" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : !ready ? (
          <div className="rpt__loading">Computing reports…</div>
        ) : (
          <>
            {/* Main charts grid */}
            <div className="rpt__grid">
              {/* Funnel */}
              <section className="rpt__card rpt__card--funnel">
                <div className="rpt__card-head">
                  <Filter /> Sales funnel
                  <span className="rpt__card-sub">deals reaching each stage</span>
                </div>
                {funnel.length === 0 ? (
                  <div className="rpt__empty-small">No stages configured.</div>
                ) : (
                  <Funnel funnel={funnel} top={funnelTop} />
                )}
              </section>

              {/* Stage value bars */}
              <section className="rpt__card rpt__card--bars">
                <div className="rpt__card-head">
                  <BarChart3 /> Pipeline by stage
                  <span className="rpt__card-sub">open deal value</span>
                </div>
                {stageBars.length === 0 ? (
                  <div className="rpt__empty-small">No open deals.</div>
                ) : (
                  <div className="rpt__bars">
                    {stageBars.map((b) => (
                      <div key={b.stage.id} className="rpt__bar-row">
                        <div className="rpt__bar-label">{b.stage.name}</div>
                        <div className="rpt__bar-track">
                          <div className="rpt__bar-fill" style={{ width: `${(b.value / maxStageValue) * 100}%`, background: "var(--os-brand)" }} />
                        </div>
                        <div className="rpt__bar-val">{fmtMoney(b.value)}</div>
                        <div className="rpt__bar-count">{b.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Lead conversion donut */}
              <section className="rpt__card">
                <div className="rpt__card-head">
                  <PieChartIcon /> Lead conversion
                  <span className="rpt__card-sub">{scoped.leads.length} lead{scoped.leads.length === 1 ? "" : "s"}</span>
                </div>
                {leadSlices.length === 0 ? (
                  <div className="rpt__empty-small">No leads in this period.</div>
                ) : (
                  <Donut slices={leadSlices} centerValue={`${scoped.leads.length}`} centerLabel="leads" />
                )}
              </section>

              {/* Account mix donut */}
              <section className="rpt__card">
                <div className="rpt__card-head">
                  <PieChartIcon /> Account mix
                  <span className="rpt__card-sub">{scoped.accounts.length} account{scoped.accounts.length === 1 ? "" : "s"}</span>
                </div>
                {accountSlices.length === 0 ? (
                  <div className="rpt__empty-small">No accounts in this period.</div>
                ) : (
                  <Donut slices={accountSlices} centerValue={`${scoped.accounts.length}`} centerLabel="accounts" />
                )}
              </section>
            </div>

            {/* Trend chart (full width) */}
            <section className="rpt__card rpt__card--trend">
              <div className="rpt__card-head">
                <LineChartIcon /> Won vs lost (6 months)
                <span className="rpt__card-sub">closed deals by month</span>
              </div>
              <TrendChart trend={trend} />
            </section>
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub, progress }: { accent: string; Icon: typeof DollarSign; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className="rpt__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="rpt__kpi-accent" aria-hidden="true" />
      <div className="rpt__kpi-row">
        <div className="rpt__kpi-icon"><Icon /></div>
        <div className="rpt__kpi-label">{label}</div>
      </div>
      <div className="rpt__kpi-value">{value}</div>
      <div className="rpt__kpi-sub">{sub}</div>
      {progress !== undefined && (
        <div className="rpt__kpi-bar"><div className="rpt__kpi-bar-fill" style={{ width: `${progress}%` }} /></div>
      )}
    </div>
  );
}

/* ─── Funnel chart (trapezoid stack) ───────────────────────── */
function Funnel({ funnel, top }: { funnel: { stage: { name: string; id: string }; count: number }[]; top: number }) {
  const W = 480;
  const H = funnel.length * 56 + 4;
  const rowH = 48;
  const gap = 8;
  return (
    <div className="rpt__funnel">
      <svg viewBox={`0 0 ${W} ${H}`} className="rpt__funnel-svg" preserveAspectRatio="xMidYMid meet">
        {funnel.map((row, i) => {
          const pct = top === 0 ? 0 : row.count / top;
          const nextPct = i < funnel.length - 1 ? (funnel[i + 1].count / top) : pct * 0.85;
          const wTop = Math.max(60, W * pct);
          const wBot = Math.max(40, W * nextPct);
          const xTop = (W - wTop) / 2;
          const xBot = (W - wBot) / 2;
          const y = i * (rowH + gap);
          const fillStop1 = `color-mix(in srgb, var(--os-brand) ${10 + (1 - i / funnel.length) * 14}%, transparent)`;
          const fillStop2 = `color-mix(in srgb, var(--os-brand) ${22 + (1 - i / funnel.length) * 20}%, transparent)`;
          return (
            <g key={row.stage.id}>
              <defs>
                <linearGradient id={`fnl-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fillStop2 as string} />
                  <stop offset="100%" stopColor={fillStop1 as string} />
                </linearGradient>
              </defs>
              <path
                d={`M ${xTop} ${y} L ${xTop + wTop} ${y} L ${xBot + wBot} ${y + rowH} L ${xBot} ${y + rowH} Z`}
                fill={`url(#fnl-${i})`}
                stroke="var(--os-brand)"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            </g>
          );
        })}
      </svg>
      <ul className="rpt__funnel-legend">
        {funnel.map((row, i) => {
          const pct = top === 0 ? 0 : Math.round((row.count / top) * 100);
          return (
            <li key={row.stage.id} className="rpt__funnel-row">
              <span className="rpt__funnel-name">{row.stage.name}</span>
              <span className="rpt__funnel-count">{row.count}</span>
              <span className="rpt__funnel-pct">{pct}% of top</span>
              {i < funnel.length - 1 && (
                <span className="rpt__funnel-drop">
                  {row.count > 0 ? `${Math.round(((row.count - funnel[i + 1].count) / row.count) * 100)}% drop` : "—"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─── Donut chart (SVG conic-like via stroke-dasharray) ────── */
function Donut({ slices, centerValue, centerLabel }: { slices: { id: string; label: string; count: number; color: string }[]; centerValue: string; centerLabel: string }) {
  const total = slices.reduce((acc, s) => acc + s.count, 0);
  const SIZE = 180;
  const R = 68;
  const C2 = 2 * Math.PI * R;
  let offset = 0;
  const arcs = slices.map((s) => {
    const portion = total === 0 ? 0 : s.count / total;
    const dash = portion * C2;
    const gap = C2 - dash;
    const node = (
      <circle
        key={s.id}
        cx={SIZE / 2} cy={SIZE / 2} r={R}
        fill="none"
        stroke={s.color}
        strokeWidth={20}
        strokeDasharray={`${dash} ${gap}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        style={{ transition: "stroke-dasharray 240ms ease" }}
      />
    );
    offset += dash;
    return node;
  });
  return (
    <div className="rpt__donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="rpt__donut-svg">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--os-surface-1)" strokeWidth={20} />
        {arcs}
      </svg>
      <div className="rpt__donut-center">
        <div className="rpt__donut-num">{centerValue}</div>
        <div className="rpt__donut-lbl">{centerLabel}</div>
      </div>
      <ul className="rpt__donut-legend">
        {slices.map((s) => {
          const pct = total === 0 ? 0 : Math.round((s.count / total) * 100);
          return (
            <li key={s.id} className="rpt__donut-row">
              <span className="rpt__donut-dot" style={{ background: s.color }} />
              <span className="rpt__donut-label">{s.label}</span>
              <span className="rpt__donut-count">{s.count}</span>
              <span className="rpt__donut-pct">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─── Won/Lost trend area chart ─────────────────────────────── */
function TrendChart({ trend }: { trend: { label: string; won: number; lost: number; wonValue: number }[] }) {
  const W = 720, H = 220, P = { t: 18, r: 18, b: 32, l: 36 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  const maxY = Math.max(1, ...trend.map((t) => Math.max(t.won, t.lost)));
  const x = (i: number) => P.l + (i / Math.max(1, trend.length - 1)) * innerW;
  const y = (val: number) => P.t + innerH - (val / maxY) * innerH;

  const wonPath = trend.map((t, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(t.won)}`).join(" ");
  const lostPath = trend.map((t, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(t.lost)}`).join(" ");
  const wonArea = `${wonPath} L ${x(trend.length - 1)} ${P.t + innerH} L ${x(0)} ${P.t + innerH} Z`;

  return (
    <div className="rpt__trend">
      <svg viewBox={`0 0 ${W} ${H}`} className="rpt__trend-svg">
        <defs>
          <linearGradient id="trendWonFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--os-c-green)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--os-c-green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={P.t + innerH * f} y2={P.t + innerH * f}
            stroke="var(--os-line)" strokeDasharray={f === 1 ? "" : "2 3"} />
        ))}
        <path d={wonArea} fill="url(#trendWonFill)" />
        <path d={wonPath} fill="none" stroke="var(--os-c-green)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={lostPath} fill="none" stroke="var(--os-c-red)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 4" />
        {trend.map((t, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(t.won)} r={3.5} fill="white" stroke="var(--os-c-green)" strokeWidth={1.5} />
            {t.lost > 0 && <circle cx={x(i)} cy={y(t.lost)} r={3} fill="white" stroke="var(--os-c-red)" strokeWidth={1.5} />}
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--os-ink-3)">{t.label}</text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={P.l - 6} y={P.t + innerH * (1 - f) + 4} textAnchor="end" fontSize="10" fill="var(--os-ink-3)">
            {Math.round(maxY * f)}
          </text>
        ))}
      </svg>
      <div className="rpt__trend-legend">
        <span><span className="rpt__trend-swatch" style={{ background: "var(--os-c-green)" }} /> Won</span>
        <span><span className="rpt__trend-swatch rpt__trend-swatch--dash" /> Lost</span>
      </div>
    </div>
  );
}
