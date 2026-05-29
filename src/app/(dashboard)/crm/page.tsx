"use client";

/* CRM — pipeline kanban-first.
 *
 * - GET  /api/crm/pipeline-stages → stage definitions (color-coded)
 * - GET  /api/crm/opportunities   → deal data
 * - PATCH /api/crm/opportunities  → stage change on drag, rename
 * - POST  /api/crm/opportunities  → add deal in a stage column
 *
 * Layout:
 *   OsTitleBar with New deal CTA + view links (Accounts / Leads / Reports) in actions slot.
 *   Hero KPI strip: Open value · Weighted forecast · Open deals · Closing this month.
 *   Pipeline kanban: bespoke column header with stage color, total value, count, drop zone.
 *   Cards: gradient accent stripe matching stage, deal name, account, value, owner, close chip.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3, Plus, DollarSign, TrendingUp, Layers, CalendarDays,
  Users, FileText, GripVertical,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

// ─── API shapes ──────────────────────────────────────────────
type ApiStage = {
  id: string;
  name: string;
  position: number;
  color?: string | null;
  isWon?: boolean | null;
  isLost?: boolean | null;
};

type ApiOpportunity = {
  id: string;
  name: string;
  amount?: number | string | null;
  currency?: string | null;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  isWon?: boolean | null;
  pipelineStageId?: string | null;
  pipelineStage?: ApiStage | null;
  account?: { id: string; name: string } | null;
  ownerId?: string | null;
};

// ─── Color resolution ─────────────────────────────────────────
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
  { hex: "#92400e", color: C.brown },
];
function stageColor(stage: ApiStage): string {
  if (stage.isWon) return C.green;
  if (stage.isLost) return C.red;
  if (!stage.color) return C.indigo;
  const t = parseInt(stage.color.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(t)) return C.indigo;
  const tr = (t >> 16) & 0xff, tg = (t >> 8) & 0xff, tb = t & 0xff;
  let best = PALETTE_BUCKETS[0];
  let bestDist = Infinity;
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

const AVATAR_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { initials: id.slice(0, 2).toUpperCase(), color: AVATAR_PALETTE[h % AVATAR_PALETTE.length] };
}

function dealAmount(d: ApiOpportunity): number {
  if (typeof d.amount === "string") {
    const n = parseFloat(d.amount);
    return isFinite(n) ? n : 0;
  }
  return d.amount ?? 0;
}

function fmtMoney(n: number, currency = "₹"): string {
  if (n >= 1_00_00_000) return `${currency}${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000) return `${currency}${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${currency}${(n / 1_000).toFixed(0)}k`;
  return `${currency}${n.toLocaleString()}`;
}

function dueChip(iso?: string | null): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((t - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `${-days}d overdue`, tone: "bad" };
  if (days === 0) return { label: "Today", tone: "warn" };
  if (days <= 7) return { label: `in ${days}d`, tone: "warn" };
  if (days <= 30) return { label: new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }), tone: "good" };
  return { label: new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }), tone: "muted" };
}

export default function CrmPage() {
  const [stages, setStages] = useState<ApiStage[] | null>(null);
  const [deals, setDeals] = useState<ApiOpportunity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverStageId, setHoverStageId] = useState<string | null>(null);
  const { rowVersion, bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [stagesRes, dealsRes] = await Promise.all([
        fetch("/api/crm/pipeline-stages"),
        fetch("/api/crm/opportunities"),
      ]);
      if (!stagesRes.ok) throw new Error(`stages: ${stagesRes.status}`);
      if (!dealsRes.ok) throw new Error(`deals: ${dealsRes.status}`);
      const s = await stagesRes.json();
      const d = await dealsRes.json();
      const stageList: ApiStage[] = s.stages ?? s.data ?? (Array.isArray(s) ? s : []);
      const dealList: ApiOpportunity[] = d.opportunities ?? d.data ?? (Array.isArray(d) ? d : []);
      setStages(stageList);
      setDeals(dealList);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const crmVersion = rowVersion("crm");
  useEffect(() => { if (crmVersion > 0) void load(); }, [crmVersion, load]);

  async function patchDeal(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/crm/opportunities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    bumpRowVersion("crm");
    return res.json();
  }

  async function addDeal(stageId: string) {
    try {
      const stage = stages?.find((s) => s.id === stageId);
      const body: Record<string, unknown> = { name: "Untitled deal" };
      if (stage && !stage.isWon && !stage.isLost) body.pipelineStageId = stage.id;
      const res = await fetch("/api/crm/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Deal added");
      void load();
    } catch {
      toast("Couldn't add deal");
    }
  }

  async function moveDeal(dealId: string, toStageId: string) {
    const current = deals?.find((d) => d.id === dealId);
    if (!current || current.pipelineStageId === toStageId) return;
    // Optimistic
    setDeals((prev) => prev?.map((d) => d.id === dealId ? { ...d, pipelineStageId: toStageId, pipelineStage: stages?.find((s) => s.id === toStageId) ?? d.pipelineStage } : d) ?? prev);
    try {
      await patchDeal(dealId, { pipelineStageId: toStageId });
      void load();
    } catch {
      toast("Couldn't move deal");
      void load();
    }
  }

  // ─── KPIs ─────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!deals || !stages) {
      return { openValue: 0, weighted: 0, openCount: 0, closingThisMonthCount: 0, closingThisMonthValue: 0 };
    }
    const totalStages = stages.length || 1;
    const openDeals = deals.filter((d) => !d.pipelineStage?.isWon && !d.pipelineStage?.isLost);
    const openValue = openDeals.reduce((acc, d) => acc + dealAmount(d), 0);
    const weighted = openDeals.reduce((acc, d) => {
      const stage = stages.find((s) => s.id === d.pipelineStageId);
      const prob = stage ? Math.min(0.95, (stage.position + 1) / totalStages) : 0.5;
      return acc + dealAmount(d) * prob;
    }, 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() + 86_399_999;
    const closingThisMonth = openDeals.filter((d) => {
      if (!d.expectedCloseDate) return false;
      const t = new Date(d.expectedCloseDate).getTime();
      return t >= monthStart && t <= monthEnd;
    });
    return {
      openValue,
      weighted,
      openCount: openDeals.length,
      closingThisMonthCount: closingThisMonth.length,
      closingThisMonthValue: closingThisMonth.reduce((acc, d) => acc + dealAmount(d), 0),
    };
  }, [deals, stages]);

  // ─── Pipeline columns ─────────────────────────────────────
  const columns = useMemo(() => {
    if (!stages || !deals) return [];
    const byStage = new Map<string, ApiOpportunity[]>();
    for (const d of deals) {
      const sid = d.pipelineStageId ?? "_unassigned";
      if (!byStage.has(sid)) byStage.set(sid, []);
      byStage.get(sid)!.push(d);
    }
    const cols = stages.map((s) => {
      const colDeals = byStage.get(s.id) ?? [];
      const totalValue = colDeals.reduce((acc, d) => acc + dealAmount(d), 0);
      return { stage: s, color: stageColor(s), deals: colDeals, totalValue };
    });
    const orphan = byStage.get("_unassigned");
    if (orphan && orphan.length > 0) {
      cols.push({
        stage: { id: "_unassigned", name: "No stage", position: 999, color: null, isWon: false, isLost: false },
        color: C.gray,
        deals: orphan,
        totalValue: orphan.reduce((acc, d) => acc + dealAmount(d), 0),
      });
    }
    return cols;
  }, [stages, deals]);

  return (
    <>
      <OsTitleBar
        title="CRM"
        Icon={BarChart3}
        iconGradient={GRAD.greenTeal}
        description={deals === null || stages === null
          ? "Loading pipeline…"
          : `${kpis.openCount} open · ${fmtMoney(kpis.openValue)} pipeline`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.pr]}
        morePeople={9}
        actions={
          <div className="crmp__head-actions">
            <Link href="/crm/accounts" className="crmp__nav-link"><Users /> Accounts</Link>
            <Link href="/crm/leads" className="crmp__nav-link"><FileText /> Leads</Link>
            <Link href="/crm/reports" className="crmp__nav-link"><BarChart3 /> Reports</Link>
            <button type="button" className="crmp__btn-primary" onClick={() => { if (columns[0]) void addDeal(columns[0].stage.id); }}>
              <Plus /> New deal
            </button>
          </div>
        }
      />

      <div className="crmp">
        {/* KPI strip */}
        <div className="crmp__kpis">
          <KpiTile
            accent="var(--os-c-green)"
            Icon={DollarSign}
            label="Open pipeline"
            value={fmtMoney(kpis.openValue)}
            sub={`${kpis.openCount} deal${kpis.openCount === 1 ? "" : "s"}`}
          />
          <KpiTile
            accent="var(--os-c-blue)"
            Icon={TrendingUp}
            label="Weighted forecast"
            value={fmtMoney(kpis.weighted)}
            sub="stage-probability adjusted"
          />
          <KpiTile
            accent="var(--os-c-purple)"
            Icon={Layers}
            label="Stages"
            value={`${stages?.length ?? 0}`}
            sub={`${(deals ?? []).filter((d) => d.pipelineStage?.isWon).length} won`}
          />
          <KpiTile
            accent="var(--os-c-orange)"
            Icon={CalendarDays}
            label="Closing this month"
            value={`${kpis.closingThisMonthCount}`}
            sub={kpis.closingThisMonthValue > 0 ? fmtMoney(kpis.closingThisMonthValue) : "no deals due"}
          />
        </div>

        {/* Pipeline */}
        {loadError ? (
          <OsEmptyView
            Icon={BarChart3}
            iconGradient={GRAD.redPink}
            title="Couldn't load pipeline"
            subtitle={`API error: ${loadError}.`}
            cta="Retry"
          />
        ) : stages === null || deals === null ? (
          <div className="crmp__loading">Loading pipeline…</div>
        ) : columns.length === 0 ? (
          <OsEmptyView
            Icon={BarChart3}
            iconGradient={GRAD.greenTeal}
            title="No stages configured"
            subtitle="Set up your pipeline stages in CRM Settings, then add your first deal."
            cta="Pipeline settings"
          />
        ) : (
          <div className="crmp__pipeline">
            {columns.map((col) => (
              <section
                key={col.stage.id}
                className={`crmp__col${hoverStageId === col.stage.id ? " is-drop" : ""}`}
                onDragOver={(e) => { e.preventDefault(); if (dragId) setHoverStageId(col.stage.id); }}
                onDragLeave={() => { if (hoverStageId === col.stage.id) setHoverStageId(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setHoverStageId(null);
                  if (dragId) void moveDeal(dragId, col.stage.id);
                  setDragId(null);
                }}
              >
                <header className="crmp__col-head" style={{ ["--col-c" as unknown as string]: col.color }}>
                  <span className="crmp__col-dot" aria-hidden="true" />
                  <span className="crmp__col-title">{col.stage.name}</span>
                  <span className="crmp__col-count">{col.deals.length}</span>
                  <span className="crmp__col-sum">{fmtMoney(col.totalValue)}</span>
                </header>

                <div className="crmp__col-body">
                  {col.deals.length === 0 ? (
                    <div className="crmp__col-empty">Drop a deal here</div>
                  ) : col.deals.map((d) => {
                    const amt = dealAmount(d);
                    const due = dueChip(d.expectedCloseDate);
                    const owner = d.ownerId ? avatarFor(d.ownerId) : null;
                    return (
                      <Link
                        key={d.id}
                        href={`/crm/${d.id}`}
                        className={`crmp__card${dragId === d.id ? " is-dragging" : ""}`}
                        draggable
                        onDragStart={(e) => {
                          setDragId(d.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => { setDragId(null); setHoverStageId(null); }}
                      >
                        <span className="crmp__card-accent" style={{ background: col.color }} aria-hidden="true" />
                        <span className="crmp__card-grip" aria-hidden="true"><GripVertical /></span>
                        <div className="crmp__card-title">{d.name}</div>
                        {d.account?.name && <div className="crmp__card-acct">{d.account.name}</div>}
                        <div className="crmp__card-foot">
                          {amt > 0 && <span className="crmp__card-amt">{fmtMoney(amt, d.currency ?? "₹")}</span>}
                          {due && <span className={`crmp__card-due crmp__card-due--${due.tone}`}>{due.label}</span>}
                          {owner && (
                            <span className="crmp__card-owner" style={{ background: owner.color }}>{owner.initials}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="crmp__col-add"
                  onClick={() => void addDeal(col.stage.id)}
                >
                  <Plus /> Add deal
                </button>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof DollarSign; label: string; value: string; sub: string }) {
  return (
    <div className="crmp__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="crmp__kpi-accent" aria-hidden="true" />
      <div className="crmp__kpi-row">
        <div className="crmp__kpi-icon"><Icon /></div>
        <div className="crmp__kpi-label">{label}</div>
      </div>
      <div className="crmp__kpi-value">{value}</div>
      <div className="crmp__kpi-sub">{sub}</div>
    </div>
  );
}
