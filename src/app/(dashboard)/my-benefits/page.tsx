"use client";

/* My benefits — personal enrollment summary.
 *
 *  GET /api/benefit-enrollments?mine=true
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Gift, Heart, Activity, Eye, Shield, Wallet, Briefcase, Bus, Sparkles,
  Calendar as CalendarIcon, ChevronRight, CheckCircle2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type BType = "MEDICAL" | "DENTAL" | "VISION" | "LIFE" | "DISABILITY_SHORT" | "DISABILITY_LONG" | "RETIREMENT_401K" | "RETIREMENT_ROTH" | "HSA" | "FSA" | "COMMUTER" | "OTHER";

type ApiEnrollment = {
  id: string;
  status: "ACTIVE" | "PENDING" | "CANCELLED";
  electionDate: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  employeeContribution: number | string;
  employerContribution: number | string;
  tier?: string | null;
  plan: { id: string; name: string; type: BType; carrier?: string | null };
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
function fmtMoney(n: number): string { return `$${Math.round(n).toLocaleString()}`; }
function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MyBenefitsPage() {
  const [enrollments, setEnrollments] = useState<ApiEnrollment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/benefit-enrollments?mine=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEnrollments(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("benefits");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = enrollments ?? [];
    const active = list.filter((e) => e.status === "ACTIVE");
    const monthlyCost = active.reduce((acc, e) => acc + num(e.employeeContribution), 0);
    const employerContrib = active.reduce((acc, e) => acc + num(e.employerContribution), 0);
    const types = new Set(active.map((e) => e.plan.type));
    return { total: list.length, active: active.length, monthlyCost, employerContrib, types: types.size };
  }, [enrollments]);

  return (
    <>
      <OsTitleBar
        title="My benefits"
        Icon={Gift}
        iconGradient={GRAD.pinkPurple}
        description={enrollments === null ? "Loading…" : `${stats.active} active election${stats.active === 1 ? "" : "s"}`}
        actions={
          <div className="myb__head-actions">
            <Link href="/benefits/plans" className="myb__nav-link">Browse plans</Link>
            <Link href="/benefits/oe" className="myb__btn-primary"><CalendarIcon /> Open enrollment</Link>
          </div>
        }
      />

      <div className="myb">
        <div className="myb__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Active elections" value={`${stats.active}`} sub={`${stats.types} category${stats.types === 1 ? "y" : "ies"}`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Wallet} label="Your cost"  value={fmtMoney(stats.monthlyCost)} sub="per month" />
          <KpiTile accent="var(--os-c-purple)" Icon={Gift} label="Employer pays" value={fmtMoney(stats.employerContrib)} sub="monthly contribution" />
          <KpiTile accent="var(--os-c-orange)" Icon={Briefcase} label="Total value" value={fmtMoney(stats.monthlyCost + stats.employerContrib)} sub="combined monthly" />
        </div>

        {loadError ? (
          <OsEmptyView Icon={Gift} iconGradient={GRAD.redPink} title="Couldn't load benefits" subtitle={loadError} cta="Retry" />
        ) : enrollments === null ? (
          <div className="myb__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Gift}
            iconGradient={GRAD.pinkPurple}
            title="No enrollments yet"
            subtitle="Pick your medical, dental, vision, retirement and other benefits during open enrollment."
            chips={["Medical", "Dental", "401(k)", "HSA"]}
            cta="Browse plans"
          />
        ) : (
          <div className="myb__list">
            {enrollments.map((e) => {
              const Icon = TYPE_ICONS[e.plan.type];
              const color = TYPE_COLORS[e.plan.type];
              const isActive = e.status === "ACTIVE";
              return (
                <article key={e.id} className={`myb__row${isActive ? "" : " is-inactive"}`} style={{ ["--row-c" as unknown as string]: color }}>
                  <div className="myb__row-icon"><Icon /></div>
                  <div className="myb__row-main">
                    <div className="myb__row-head">
                      <span className="myb__row-type">{TYPE_LABELS[e.plan.type]}</span>
                      <span className={`myb__row-status myb__row-status--${e.status.toLowerCase()}`}>{e.status}</span>
                      {e.tier && <span className="myb__row-tier">{e.tier}</span>}
                    </div>
                    <div className="myb__row-name">{e.plan.name}</div>
                    {e.plan.carrier && <div className="myb__row-carrier">{e.plan.carrier}</div>}
                  </div>
                  <div className="myb__row-costs">
                    <div className="myb__row-cost"><span>Your cost</span><strong>{fmtMoney(num(e.employeeContribution))}<small>/mo</small></strong></div>
                    <div className="myb__row-cost"><span>Employer</span><strong>{fmtMoney(num(e.employerContribution))}<small>/mo</small></strong></div>
                  </div>
                  <div className="myb__row-dates">
                    <CalendarIcon />
                    <div>
                      <div>{fmtShortDate(e.effectiveFrom)}{e.effectiveTo && ` → ${fmtShortDate(e.effectiveTo)}`}</div>
                      <div className="myb__row-elected">Elected {fmtShortDate(e.electionDate)}</div>
                    </div>
                  </div>
                  <ChevronRight className="myb__row-arrow" />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Gift; label: string; value: string; sub: string }) {
  return (
    <div className="myb__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="myb__kpi-accent" aria-hidden="true" />
      <div className="myb__kpi-row">
        <div className="myb__kpi-icon"><Icon /></div>
        <div className="myb__kpi-label">{label}</div>
      </div>
      <div className="myb__kpi-value">{value}</div>
      <div className="myb__kpi-sub">{sub}</div>
    </div>
  );
}
