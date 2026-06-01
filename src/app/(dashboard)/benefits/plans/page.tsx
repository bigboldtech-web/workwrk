"use client";

/* Benefits · Plans — full plan catalog with filtering. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Gift, Plus, Search, ArrowLeft, ChevronDown, Heart, Activity, Eye, Shield,
  Wallet, Briefcase, Bus, Sparkles, Calendar as CalendarIcon, Users, ArrowRight,
  Power, PowerOff,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

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
function fmtMoney(n: number): string { return `$${Math.round(n).toLocaleString()}`; }
function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type SortKey = "name" | "enroll" | "cost" | "effective";

export default function BenefitPlansPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<BType | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

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

  const filtered = useMemo(() => {
    let list = plans ?? [];
    if (!showInactive) list = list.filter((p) => p.active);
    if (typeFilter) list = list.filter((p) => p.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.carrier ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q));
    const sorted = list.slice();
    if (sortKey === "enroll") sorted.sort((a, b) => (b._count?.enrollments ?? 0) - (a._count?.enrollments ?? 0));
    else if (sortKey === "cost") sorted.sort((a, b) => num(b.employerCost) - num(a.employerCost));
    else if (sortKey === "effective") sorted.sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [plans, search, typeFilter, showInactive, sortKey]);

  const typeCounts = useMemo(() => {
    const map = new Map<BType, number>();
    for (const p of plans ?? []) map.set(p.type, (map.get(p.type) ?? 0) + 1);
    return map;
  }, [plans]);

  const total = plans?.length ?? 0;
  const active = (plans ?? []).filter((p) => p.active).length;

  return (
    <>
      <OsTitleBar
        title="Benefit plans"
        Icon={Gift}
        iconGradient={GRAD.pinkPurple}
        description={plans === null ? "Loading…" : `${total} plan${total === 1 ? "" : "s"} · ${active} active`}
        actions={
          <div className="bpl__head-actions">
            <button type="button" className="bpl__back" onClick={() => history.back()}>
              <ArrowLeft /> Benefits
            </button>
            <Link href="/benefits/oe" className="bpl__nav-link"><CalendarIcon /> Open enrollment</Link>
            <button type="button" className="bpl__btn-primary" onClick={() => toast("New plan needs admin role + carrier + effective dates — use HR onboarding flow")}>
              <Plus /> New plan
            </button>
          </div>
        }
      />

      <div className="bpl">
        <div className="bpl__toolbar">
          <div className="bpl__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plan, carrier, description…" />
          </div>
          <label className="bpl__inactive-toggle">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span>Show inactive</span>
          </label>
          <div className="bpl__sort">
            <span>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="bpl__sort-select">
              <option value="name">A–Z</option>
              <option value="enroll">Most enrolled</option>
              <option value="cost">Highest employer cost</option>
              <option value="effective">Most recent</option>
            </select>
            <ChevronDown />
          </div>
        </div>

        <div className="bpl__types">
          <button type="button" className={`bpl__type${typeFilter === null ? " is-active" : ""}`} onClick={() => setTypeFilter(null)}>
            All <span>{total}</span>
          </button>
          {(Object.keys(TYPE_LABELS) as BType[]).filter((t) => (typeCounts.get(t) ?? 0) > 0).map((t) => {
            const Icon = TYPE_ICONS[t];
            return (
              <button key={t} type="button" className={`bpl__type${typeFilter === t ? " is-active" : ""}`} style={{ ["--type-c" as unknown as string]: TYPE_COLORS[t] }} onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
                <Icon />
                {TYPE_LABELS[t]}
                <span>{typeCounts.get(t)}</span>
              </button>
            );
          })}
        </div>

        {loadError ? (
          <OsEmptyView Icon={Gift} iconGradient={GRAD.redPink} title="Couldn't load plans" subtitle={loadError} cta="Retry" />
        ) : plans === null ? (
          <div className="bpl__loading">Loading…</div>
        ) : total === 0 ? (
          <OsEmptyView Icon={Gift} iconGradient={GRAD.pinkPurple} title="No benefit plans" subtitle="Add medical, dental, vision, retirement, and more." chips={["Medical", "Dental", "Vision", "401(k)"]} cta="Add plan" />
        ) : filtered.length === 0 ? (
          <div className="bpl__empty">
            <Search />
            <div>No plans match.</div>
            <button type="button" className="bpl__empty-reset" onClick={() => { setSearch(""); setTypeFilter(null); setShowInactive(false); }}>Clear</button>
          </div>
        ) : (
          <div className="bpl__grid">
            {filtered.map((p) => {
              const Icon = TYPE_ICONS[p.type];
              const color = TYPE_COLORS[p.type];
              return (
                <article key={p.id} id={p.id} className={`bpl__plan${p.active ? "" : " is-inactive"}`} style={{ ["--plan-c" as unknown as string]: color }}>
                  <header className="bpl__plan-head">
                    <div className="bpl__plan-icon"><Icon /></div>
                    <div className="bpl__plan-title-wrap">
                      <span className="bpl__plan-type">{TYPE_LABELS[p.type]}</span>
                      <h3 className="bpl__plan-name">{p.name}</h3>
                      {p.carrier && <div className="bpl__plan-carrier">{p.carrier}</div>}
                    </div>
                    <span className={`bpl__plan-state${p.active ? "" : " is-off"}`} title={p.active ? "Active" : "Inactive"}>
                      {p.active ? <Power /> : <PowerOff />}
                    </span>
                  </header>
                  {p.description && <p className="bpl__plan-desc">{p.description}</p>}
                  <div className="bpl__plan-costs">
                    <div><span>Employee</span><strong>{fmtMoney(num(p.employeeCost))}<small>/mo</small></strong></div>
                    <div><span>Employer</span><strong>{fmtMoney(num(p.employerCost))}<small>/mo</small></strong></div>
                    <div><span>Tiers</span><strong>{p._count?.tiers ?? 0}</strong></div>
                  </div>
                  <footer className="bpl__plan-foot">
                    <span><CalendarIcon /> {fmtShortDate(p.effectiveFrom)}{p.effectiveTo && ` → ${fmtShortDate(p.effectiveTo)}`}</span>
                    <span className="bpl__plan-enroll">
                      <Users /> {p._count?.enrollments ?? 0}
                      <ArrowRight />
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
