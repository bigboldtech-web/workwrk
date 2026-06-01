"use client";

/* Time-off policies — catalog with accrual config.
 *
 *  GET /api/time-off-policies
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Plus, Search, ArrowLeft, Plane, Activity, Heart, Baby, Coffee,
  Clock, ChevronRight, Power, PowerOff, Users,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PolicyType = "PTO" | "SICK" | "PERSONAL" | "BEREAVEMENT" | "PARENTAL" | "UNPAID" | "OTHER";

type ApiPolicy = {
  id: string;
  name: string;
  type: PolicyType;
  description?: string | null;
  color?: string | null;
  active: boolean;
  accrualRate?: number | string | null;
  accrualPeriod?: string | null;
  maxBalance?: number | string | null;
  carryoverMax?: number | string | null;
  waitingDays?: number | null;
  _count?: { requests?: number; assignments?: number };
};

const TYPE_LABELS: Record<PolicyType, string> = {
  PTO: "PTO", SICK: "Sick", PERSONAL: "Personal", BEREAVEMENT: "Bereavement",
  PARENTAL: "Parental", UNPAID: "Unpaid", OTHER: "Other",
};
const TYPE_ICONS: Record<PolicyType, typeof Plane> = {
  PTO: Plane, SICK: Activity, PERSONAL: Heart, BEREAVEMENT: Heart,
  PARENTAL: Baby, UNPAID: Coffee, OTHER: FileText,
};
const TYPE_COLORS: Record<PolicyType, string> = {
  PTO: C.blue, SICK: C.red, PERSONAL: C.purple, BEREAVEMENT: C.gray,
  PARENTAL: C.pink, UNPAID: C.brown, OTHER: C.indigo,
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}

export default function TimeOffPoliciesPage() {
  const [policies, setPolicies] = useState<ApiPolicy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/time-off-policies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPolicies(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("timeoff");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const filtered = useMemo(() => {
    let list = policies ?? [];
    if (!showInactive) list = list.filter((p) => p.active);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q));
    return list;
  }, [policies, search, showInactive]);

  const stats = useMemo(() => {
    const list = policies ?? [];
    const active = list.filter((p) => p.active).length;
    const totalReqs = list.reduce((acc, p) => acc + (p._count?.requests ?? 0), 0);
    const totalAssigned = list.reduce((acc, p) => acc + (p._count?.assignments ?? 0), 0);
    return { total: list.length, active, totalReqs, totalAssigned };
  }, [policies]);

  return (
    <>
      <OsTitleBar
        title="Time-off policies"
        Icon={FileText}
        iconGradient={GRAD.indigoBlue}
        description={policies === null ? "Loading…" : `${stats.total} policy · ${stats.active} active`}
        actions={
          <div className="topl__head-actions">
            <button type="button" className="topl__back" onClick={() => history.back()}>
              <ArrowLeft /> Time off
            </button>
            <button type="button" className="topl__btn-primary" onClick={() => toast("New policy needs accrual config — use admin setup")}>
              <Plus /> New policy
            </button>
          </div>
        }
      />

      <div className="topl">
        <div className="topl__toolbar">
          <div className="topl__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policy…" />
          </div>
          <label className="topl__inactive">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span>Show inactive</span>
          </label>
        </div>

        {loadError ? (
          <OsEmptyView Icon={FileText} iconGradient={GRAD.redPink} title="Couldn't load policies" subtitle={loadError} cta="Retry" />
        ) : policies === null ? (
          <div className="topl__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView Icon={FileText} iconGradient={GRAD.indigoBlue} title="No time-off policies" subtitle="Define PTO, sick, parental, and bereavement policies with accrual rules." chips={["PTO", "Sick", "Parental", "Bereavement"]} cta="New policy" />
        ) : filtered.length === 0 ? (
          <div className="topl__empty">
            <Search />
            <div>No policies match.</div>
          </div>
        ) : (
          <div className="topl__grid">
            {filtered.map((p) => {
              const Icon = TYPE_ICONS[p.type];
              const color = p.color || TYPE_COLORS[p.type];
              return (
                <article key={p.id} className={`topl__card${p.active ? "" : " is-inactive"}`} style={{ ["--card-c" as unknown as string]: color }}>
                  <header className="topl__card-head">
                    <div className="topl__card-icon"><Icon /></div>
                    <div className="topl__card-title-wrap">
                      <span className="topl__card-type">{TYPE_LABELS[p.type]}</span>
                      <h3 className="topl__card-name">{p.name}</h3>
                    </div>
                    <span className={`topl__card-state${p.active ? "" : " is-off"}`}>
                      {p.active ? <Power /> : <PowerOff />}
                    </span>
                  </header>
                  {p.description && <p className="topl__card-desc">{p.description}</p>}
                  <div className="topl__card-stats">
                    {p.accrualRate !== null && p.accrualRate !== undefined && (
                      <div className="topl__stat">
                        <span>Accrual</span>
                        <strong>{num(p.accrualRate)} hrs/{p.accrualPeriod?.toLowerCase() ?? "period"}</strong>
                      </div>
                    )}
                    {p.maxBalance !== null && p.maxBalance !== undefined && (
                      <div className="topl__stat">
                        <span>Max balance</span>
                        <strong>{num(p.maxBalance)} hrs</strong>
                      </div>
                    )}
                    {p.carryoverMax !== null && p.carryoverMax !== undefined && (
                      <div className="topl__stat">
                        <span>Carryover</span>
                        <strong>{num(p.carryoverMax)} hrs</strong>
                      </div>
                    )}
                    {p.waitingDays !== null && p.waitingDays !== undefined && p.waitingDays > 0 && (
                      <div className="topl__stat">
                        <span>Waiting</span>
                        <strong>{p.waitingDays}d</strong>
                      </div>
                    )}
                  </div>
                  <footer className="topl__card-foot">
                    <span><Users /> {p._count?.assignments ?? 0} assigned</span>
                    <span><Clock /> {p._count?.requests ?? 0} requests</span>
                    <ChevronRight className="topl__card-arrow" />
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
