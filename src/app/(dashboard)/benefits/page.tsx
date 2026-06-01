"use client";

/* Benefits — hub with plan tiles + OE link.
 *
 *  GET /api/benefit-plans
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Gift, Plus, Heart, Activity, Eye, Shield, Wallet, Briefcase,
  Bus, Sparkles, Calendar as CalendarIcon, ChevronRight, Users, ArrowRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type BType = "MEDICAL" | "DENTAL" | "VISION" | "LIFE" | "DISABILITY_SHORT" | "DISABILITY_LONG" | "RETIREMENT_401K" | "RETIREMENT_ROTH" | "HSA" | "FSA" | "COMMUTER" | "OTHER";

type ApiPlan = {
  id: string;
  name: string;
  type: BType;
  carrier?: string | null;
  description?: string | null;
  employeeCost: number | string;
  employerCost: number | string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  active: boolean;
  _count?: { enrollments?: number; tiers?: number };
};

const TYPE_LABELS: Record<BType, string> = {
  MEDICAL: "Medical", DENTAL: "Dental", VISION: "Vision", LIFE: "Life",
  DISABILITY_SHORT: "Disability (short)", DISABILITY_LONG: "Disability (long)",
  RETIREMENT_401K: "401(k)", RETIREMENT_ROTH: "Roth 401(k)",
  HSA: "HSA", FSA: "FSA", COMMUTER: "Commuter", OTHER: "Other",
};
const TYPE_ICONS: Record<BType, typeof Gift> = {
  MEDICAL: Heart, DENTAL: Activity, VISION: Eye, LIFE: Shield,
  DISABILITY_SHORT: Shield, DISABILITY_LONG: Shield,
  RETIREMENT_401K: Wallet, RETIREMENT_ROTH: Wallet,
  HSA: Briefcase, FSA: Briefcase, COMMUTER: Bus, OTHER: Sparkles,
};
const TYPE_COLORS: Record<BType, string> = {
  MEDICAL: C.pink, DENTAL: C.blue, VISION: C.teal, LIFE: C.purple,
  DISABILITY_SHORT: C.orange, DISABILITY_LONG: C.brown,
  RETIREMENT_401K: C.green, RETIREMENT_ROTH: C.sage,
  HSA: C.indigo, FSA: C.yellow, COMMUTER: C.red, OTHER: C.gray,
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export default function BenefitsPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/benefit-plans");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("benefits");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = plans ?? [];
    const active = list.filter((p) => p.active);
    const types = new Set(list.map((p) => p.type));
    const enrollments = list.reduce((acc, p) => acc + (p._count?.enrollments ?? 0), 0);
    const employerSpend = list.reduce((acc, p) => acc + num(p.employerCost) * (p._count?.enrollments ?? 0), 0);
    return { total: list.length, active: active.length, types: types.size, enrollments, employerSpend };
  }, [plans]);

  const byType = useMemo(() => {
    const list = (plans ?? []).filter((p) => p.active);
    const map = new Map<BType, ApiPlan[]>();
    for (const p of list) {
      if (!map.has(p.type)) map.set(p.type, []);
      map.get(p.type)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => TYPE_LABELS[a].localeCompare(TYPE_LABELS[b]));
  }, [plans]);

  return (
    <>
      <OsTitleBar
        title="Benefits"
        Icon={Gift}
        iconGradient={GRAD.pinkPurple}
        description={plans === null ? "Loading…" : `${stats.active} active plan${stats.active === 1 ? "" : "s"} · ${stats.types} type${stats.types === 1 ? "" : "s"} · ${stats.enrollments} enrolled`}
        actions={
          <div className="bnf__head-actions">
            <Link href="/benefits/plans" className="bnf__nav-link">All plans</Link>
            <Link href="/benefits/oe" className="bnf__nav-link"><CalendarIcon /> Open enrollment</Link>
            <Link href="/my-benefits" className="bnf__btn-primary">My benefits <ArrowRight /></Link>
          </div>
        }
      />

      <div className="bnf">
        <div className="bnf__kpis">
          <KpiTile accent="var(--os-c-pink)"   Icon={Gift}     label="Active plans" value={`${stats.active}`}     sub={`${stats.total} total`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Users}    label="Enrolled"     value={`${stats.enrollments}`} sub="employees on plans" />
          <KpiTile accent="var(--os-c-green)"  Icon={Wallet}   label="Employer spend" value={fmtMoney(stats.employerSpend)} sub="monthly est." />
          <KpiTile accent="var(--os-c-purple)" Icon={Sparkles} label="Benefit types" value={`${stats.types}`}     sub="categories offered" />
        </div>

        {loadError ? (
          <OsEmptyView Icon={Gift} iconGradient={GRAD.redPink} title="Couldn't load benefits" subtitle={loadError} cta="Retry" />
        ) : plans === null ? (
          <div className="bnf__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Gift}
            iconGradient={GRAD.pinkPurple}
            title="No benefit plans yet"
            subtitle="Add medical, dental, vision, retirement, and more. Each plan has its own tiers and effective dates."
            chips={["Medical", "Dental", "Vision", "401(k)"]}
            cta="Add plan"
          />
        ) : (
          byType.map(([type, items]) => {
            const Icon = TYPE_ICONS[type];
            const color = TYPE_COLORS[type];
            return (
              <section key={type} className="bnf__section" style={{ ["--sec-c" as unknown as string]: color }}>
                <header className="bnf__section-head">
                  <div className="bnf__section-icon"><Icon /></div>
                  <h2>{TYPE_LABELS[type]}</h2>
                  <span className="bnf__section-count">{items.length} plan{items.length === 1 ? "" : "s"}</span>
                  <span className="bnf__section-line" />
                </header>
                <div className="bnf__plans">
                  {items.map((p) => (
                    <Link key={p.id} href={`/benefits/plans#${p.id}`} className="bnf__plan">
                      <div className="bnf__plan-head">
                        <h3>{p.name}</h3>
                        {p.carrier && <span className="bnf__plan-carrier">{p.carrier}</span>}
                      </div>
                      {p.description && <p className="bnf__plan-desc">{p.description}</p>}
                      <div className="bnf__plan-costs">
                        <div className="bnf__plan-cost"><span>Employee</span><strong>{fmtMoney(num(p.employeeCost))}<small>/mo</small></strong></div>
                        <div className="bnf__plan-cost"><span>Employer</span><strong>{fmtMoney(num(p.employerCost))}<small>/mo</small></strong></div>
                        <div className="bnf__plan-cost"><span>Enrolled</span><strong>{p._count?.enrollments ?? 0}</strong></div>
                      </div>
                      <div className="bnf__plan-foot">
                        <CalendarIcon /> Effective {new Date(p.effectiveFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {p.effectiveTo && ` → ${new Date(p.effectiveTo).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`}
                        <ChevronRight className="bnf__plan-arrow" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Gift; label: string; value: string; sub: string }) {
  return (
    <div className="bnf__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="bnf__kpi-accent" aria-hidden="true" />
      <div className="bnf__kpi-row">
        <div className="bnf__kpi-icon"><Icon /></div>
        <div className="bnf__kpi-label">{label}</div>
      </div>
      <div className="bnf__kpi-value">{value}</div>
      <div className="bnf__kpi-sub">{sub}</div>
    </div>
  );
}
