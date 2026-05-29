"use client";

/* CRM · Pipeline — weighted ARR forecast with drag-to-stage.
 *
 *  GET   /api/crm/pipeline-stages   list stages with probability
 *  GET   /api/crm/opportunities     list deals
 *  PATCH /api/crm/opportunities     { id, pipelineStageId }   (drag updates this)
 *
 * Layout:
 *   OsTitleBar with period filter + New deal CTA in actions slot.
 *   Hero forecast strip: Committed · Weighted · Best case · Upside (gap).
 *   ARR funnel: stacked bar showing each stage's contribution to weighted ARR.
 *   Stage rows: count + sum + weighted bar + draggable deal pills.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Workflow, Plus, DollarSign, TrendingUp, Target, Gauge, ChevronRight,
  Building2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiStage = {
  id: string;
  name: string;
  position: number;
  probability: number;
  color?: string | null;
  isWon: boolean;
  isLost: boolean;
};

type ApiOpportunity = {
  id: string;
  name: string;
  amount?: number | string | null;
  currency?: string | null;
  pipelineStageId?: string | null;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  isWon?: boolean | null;
  account?: { id: string; name: string } | null;
  pipelineStage?: { id: string; name: string; color?: string | null; isWon: boolean; isLost: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

const PALETTE_BUCKETS = [
  { hex: "#10b981", color: C.green },
  { hex: "#f59e0b", color: C.orange },
  { hex: "#ef4444", color: C.red },
  { hex: "#60a5fa", color: C.blue },
  { hex: "#a78bfa", color: C.purple },
  { hex: "#ec4899", color: C.pink },
  { hex: "#6366f1", color: C.indigo },
  { hex: "#14b8a6", color: C.teal },
  { hex: "#eab308", color: C.yellow },
  { hex: "#94a3b8", color: C.gray },
];
function stageColor(s: ApiStage): string {
  if (s.isWon) return C.green;
  if (s.isLost) return C.red;
  if (!s.color) return C.indigo;
  const t = parseInt(s.color.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(t)) return C.indigo;
  const tr = (t >> 16) & 0xff, tg = (t >> 8) & 0xff, tb = t & 0xff;
  let best = PALETTE_BUCKETS[0]; let bestDist = Infinity;
  for (const p of PALETTE_BUCKETS) {
    const v = parseInt(p.hex.replace("#", ""), 16);
    const dr = ((v >> 16) & 0xff) - tr;
    const dg = ((v >> 8) & 0xff) - tg;
    const db = (v & 0xff) - tb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best.color;
}

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

export default function CrmPipelinePage() {
  const [stages, setStages] = useState<ApiStage[] | null>(null);
  const [opps, setOpps] = useState<ApiOpportunity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("quarter");
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const { rowVersion, bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [sRes, oRes] = await Promise.all([
        fetch("/api/crm/pipeline-stages"),
        fetch("/api/crm/opportunities"),
      ]);
      if (!sRes.ok) throw new Error(`stages ${sRes.status}`);
      if (!oRes.ok) throw new Error(`opps ${oRes.status}`);
      const sJ = await sRes.json();
      const oJ = await oRes.json();
      const stageList: ApiStage[] = sJ.stages ?? sJ.data ?? [];
      stageList.sort((a, b) => a.position - b.position);
      setStages(stageList);
      setOpps(oJ.opportunities ?? oJ.data ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/pipeline");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);
  // Also re-load when CRM changes anywhere (deal added on /crm, etc.)
  const vCrm = rowVersion("crm");
  useEffect(() => { if (vCrm > 0) void load(); }, [vCrm, load]);

  // ─── Period filter ────────────────────────────────────────
  const periodFilter = useCallback((o: ApiOpportunity): boolean => {
    if (period === "all") return true;
    const dateStr = o.expectedCloseDate ?? o.closedAt ?? o.updatedAt;
    if (!dateStr) return true;
    const t = new Date(dateStr).getTime();
    const now = new Date();
    if (period === "quarter") {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1).getTime();
      const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59).getTime();
      return t >= start && t <= end;
    }
    if (period === "year") {
      const start = new Date(now.getFullYear(), 0, 1).getTime();
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59).getTime();
      return t >= start && t <= end;
    }
    return true;
  }, [period]);

  const scopedOpps = useMemo(() => (opps ?? []).filter(periodFilter), [opps, periodFilter]);

  // ─── Forecast math ────────────────────────────────────────
  const forecast = useMemo(() => {
    if (!stages || !opps) return { committed: 0, weighted: 0, bestCase: 0, upside: 0 };
    const wonOpps = scopedOpps.filter((o) => o.pipelineStage?.isWon === true);
    const openOpps = scopedOpps.filter((o) => !o.pipelineStage?.isWon && !o.pipelineStage?.isLost);
    const committed = wonOpps.reduce((acc, o) => acc + num(o.amount), 0);
    const bestCase = openOpps.reduce((acc, o) => acc + num(o.amount), 0);
    const weighted = openOpps.reduce((acc, o) => {
      const stage = stages.find((s) => s.id === o.pipelineStageId);
      const prob = stage ? (stage.probability ?? 50) / 100 : 0.5;
      return acc + num(o.amount) * prob;
    }, 0);
    return { committed, weighted, bestCase, upside: bestCase - weighted };
  }, [stages, opps, scopedOpps]);

  // ─── Per-stage breakdown ──────────────────────────────────
  const stageRows = useMemo(() => {
    if (!stages || !opps) return [];
    return stages
      .filter((s) => !s.isLost) // exclude lost from forecast view
      .map((s) => {
        const dealsInStage = scopedOpps.filter((o) => o.pipelineStageId === s.id);
        const sumValue = dealsInStage.reduce((acc, o) => acc + num(o.amount), 0);
        const weighted = sumValue * (s.probability / 100);
        return { stage: s, color: stageColor(s), deals: dealsInStage, sumValue, weighted };
      });
  }, [stages, opps, scopedOpps]);

  const maxStageWeighted = Math.max(1, ...stageRows.map((r) => r.weighted));

  // ─── Funnel segments (weighted) ───────────────────────────
  const funnelSegments = useMemo(() => {
    const total = stageRows.reduce((acc, r) => acc + r.weighted, 0);
    if (total === 0) return [];
    return stageRows
      .filter((r) => r.weighted > 0)
      .map((r) => ({
        id: r.stage.id,
        name: r.stage.name,
        color: r.color,
        value: r.weighted,
        pct: (r.weighted / total) * 100,
      }));
  }, [stageRows]);

  // ─── Drag handlers ────────────────────────────────────────
  async function moveDeal(dealId: string, toStageId: string) {
    const current = opps?.find((o) => o.id === dealId);
    if (!current || current.pipelineStageId === toStageId) return;
    const targetStage = stages?.find((s) => s.id === toStageId);
    setOpps((prev) => prev?.map((o) => o.id === dealId
      ? { ...o, pipelineStageId: toStageId, pipelineStage: targetStage ? { id: targetStage.id, name: targetStage.name, color: targetStage.color, isWon: targetStage.isWon, isLost: targetStage.isLost } : o.pipelineStage }
      : o) ?? prev);
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dealId, pipelineStageId: toStageId }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      bumpRowVersion("crm");
      void load();
      toast(`Moved to ${targetStage?.name ?? "stage"}`);
    } catch {
      toast("Couldn't move");
      void load();
    }
  }

  async function addDeal() {
    const stageId = stages?.[0]?.id;
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled deal", pipelineStageId: stageId }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Deal added");
      void load();
    } catch {
      toast("Couldn't add deal");
    }
  }

  return (
    <>
      <OsTitleBar
        title="Pipeline · Forecast"
        Icon={Workflow}
        iconGradient={GRAD.greenTeal}
        description={opps === null
          ? "Loading…"
          : `${scopedOpps.filter((o) => !o.pipelineStage?.isWon && !o.pipelineStage?.isLost).length} open · weighted ${fmtMoney(forecast.weighted)}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={4}
        actions={
          <div className="crmw__head-actions">
            <div className="crmw__period">
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
            <Link href="/crm" className="crmw__nav-link">
              Kanban <ChevronRight />
            </Link>
            <button type="button" className="crmw__btn-primary" onClick={addDeal}>
              <Plus /> New deal
            </button>
          </div>
        }
      />

      <div className="crmw">
        {/* Forecast strip */}
        <div className="crmw__forecast">
          <ForecastTile
            accent="var(--os-c-green)"
            Icon={DollarSign}
            label="Committed"
            value={fmtMoney(forecast.committed)}
            sub="closed-won"
          />
          <ForecastTile
            accent="var(--os-c-blue)"
            Icon={TrendingUp}
            label="Weighted"
            value={fmtMoney(forecast.weighted)}
            sub="value × probability"
            hero
          />
          <ForecastTile
            accent="var(--os-c-purple)"
            Icon={Target}
            label="Best case"
            value={fmtMoney(forecast.bestCase)}
            sub="all open deals"
          />
          <ForecastTile
            accent="var(--os-c-orange)"
            Icon={Gauge}
            label="Upside"
            value={fmtMoney(forecast.upside)}
            sub="best - weighted"
          />
        </div>

        {/* ARR funnel */}
        {funnelSegments.length > 0 && (
          <section className="crmw__funnel">
            <div className="crmw__funnel-head">
              <span className="crmw__funnel-title">Weighted ARR by stage</span>
              <span className="crmw__funnel-total">{fmtMoney(forecast.weighted)} total</span>
            </div>
            <div className="crmw__funnel-bar">
              {funnelSegments.map((seg) => (
                <div
                  key={seg.id}
                  className="crmw__funnel-seg"
                  style={{ width: `${seg.pct}%`, background: seg.color }}
                  title={`${seg.name}: ${fmtMoney(seg.value)} (${seg.pct.toFixed(1)}%)`}
                />
              ))}
            </div>
            <div className="crmw__funnel-legend">
              {funnelSegments.map((seg) => (
                <span key={seg.id} className="crmw__funnel-chip">
                  <span className="crmw__funnel-dot" style={{ background: seg.color }} />
                  {seg.name}
                  <span className="crmw__funnel-val">{fmtMoney(seg.value)}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Stage breakdown */}
        {loadError ? (
          <OsEmptyView
            Icon={Workflow}
            iconGradient={GRAD.redPink}
            title="Couldn't load pipeline"
            subtitle={`API error: ${loadError}.`}
            cta="Retry"
          />
        ) : opps === null || stages === null ? (
          <div className="crmw__loading">Loading pipeline…</div>
        ) : stageRows.length === 0 ? (
          <OsEmptyView
            Icon={Workflow}
            iconGradient={GRAD.greenTeal}
            title="No stages configured"
            subtitle="Set up your pipeline stages in CRM Settings."
            cta="Settings"
          />
        ) : (
          <section className="crmw__stages">
            {stageRows.map((row) => {
              const isDrop = hoverStage === row.stage.id;
              return (
                <div
                  key={row.stage.id}
                  className={`crmw__stage${isDrop ? " is-drop" : ""}`}
                  style={{ ["--st-c" as unknown as string]: row.color }}
                  onDragOver={(e) => { e.preventDefault(); if (dragId) setHoverStage(row.stage.id); }}
                  onDragLeave={() => { if (hoverStage === row.stage.id) setHoverStage(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setHoverStage(null);
                    if (dragId) void moveDeal(dragId, row.stage.id);
                    setDragId(null);
                  }}
                >
                  <header className="crmw__stage-head">
                    <span className="crmw__stage-dot" />
                    <span className="crmw__stage-name">{row.stage.name}</span>
                    <span className="crmw__stage-prob">{row.stage.probability}%</span>
                    <span className="crmw__stage-count">{row.deals.length} deal{row.deals.length === 1 ? "" : "s"}</span>
                    <div className="crmw__stage-grow" />
                    <div className="crmw__stage-nums">
                      <div className="crmw__stage-num">
                        <span className="crmw__stage-num-label">Sum</span>
                        <span className="crmw__stage-num-val">{fmtMoney(row.sumValue)}</span>
                      </div>
                      <div className="crmw__stage-num crmw__stage-num--weighted">
                        <span className="crmw__stage-num-label">Weighted</span>
                        <span className="crmw__stage-num-val">{fmtMoney(row.weighted)}</span>
                      </div>
                    </div>
                  </header>

                  <div className="crmw__stage-bar-track">
                    <div
                      className="crmw__stage-bar-fill"
                      style={{ width: `${(row.weighted / maxStageWeighted) * 100}%`, background: row.color }}
                    />
                  </div>

                  <div className="crmw__stage-deals">
                    {row.deals.length === 0 ? (
                      <div className="crmw__stage-empty">Drop deals here to forecast at {row.stage.probability}%</div>
                    ) : (
                      row.deals.map((o) => {
                        const amt = num(o.amount);
                        const weighted = amt * (row.stage.probability / 100);
                        return (
                          <Link
                            key={o.id}
                            href={`/crm/${o.id}`}
                            className={`crmw__deal${dragId === o.id ? " is-dragging" : ""}`}
                            draggable
                            onDragStart={(e) => { setDragId(o.id); e.dataTransfer.effectAllowed = "move"; }}
                            onDragEnd={() => { setDragId(null); setHoverStage(null); }}
                          >
                            <span className="crmw__deal-accent" style={{ background: row.color }} aria-hidden="true" />
                            <div className="crmw__deal-main">
                              <div className="crmw__deal-title">{o.name}</div>
                              {o.account?.name && (
                                <div className="crmw__deal-acct"><Building2 /> {o.account.name}</div>
                              )}
                            </div>
                            <div className="crmw__deal-nums">
                              <div className="crmw__deal-amt">{fmtMoney(amt)}</div>
                              <div className="crmw__deal-weighted">{fmtMoney(weighted)} wt</div>
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </>
  );
}

function ForecastTile({ accent, Icon, label, value, sub, hero }: { accent: string; Icon: typeof DollarSign; label: string; value: string; sub: string; hero?: boolean }) {
  return (
    <div className={`crmw__tile${hero ? " crmw__tile--hero" : ""}`} style={{ ["--tile-c" as unknown as string]: accent }}>
      <span className="crmw__tile-accent" aria-hidden="true" />
      <div className="crmw__tile-row">
        <div className="crmw__tile-icon"><Icon /></div>
        <div className="crmw__tile-label">{label}</div>
      </div>
      <div className="crmw__tile-value">{value}</div>
      <div className="crmw__tile-sub">{sub}</div>
    </div>
  );
}
