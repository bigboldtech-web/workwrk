"use client";

/* Finance · Budget Plans — directory of plans with status + scenarios.
 *
 * Each plan is a quarterly/annual budget or forecast against a fiscal
 * year. Cards show plan type, fiscal year, version, status (Draft /
 * Active / Archived), number of scenarios, and line count. Clicking a
 * plan deep-links to its detail page where the actual line-item matrix
 * lives.
 *
 * Reads: GET /api/budget-plans
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollText, Plus, ChevronRight, Layers } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type PlanType = "BUDGET" | "FORECAST" | "STRATEGIC" | "WHAT_IF";
type PlanStatus = "DRAFT" | "ACTIVE" | "ARCHIVED" | "PUBLISHED";

type ApiPlan = {
  id: string;
  name: string;
  type: PlanType;
  status: PlanStatus;
  version: number;
  description?: string | null;
  publishedAt?: string | null;
  updatedAt: string;
  fiscalYear?: { id: string; label: string } | null;
  scenarios?: { id: string; name: string; isDefault: boolean }[];
  _count?: { lines?: number };
};

const TYPE_HUE: Record<PlanType, string> = {
  BUDGET: "var(--os-c-indigo)", FORECAST: "var(--os-c-blue)",
  STRATEGIC: "var(--os-c-purple)", WHAT_IF: "var(--os-c-orange)",
};
const TYPE_LABEL: Record<PlanType, string> = {
  BUDGET: "Budget", FORECAST: "Forecast", STRATEGIC: "Strategic", WHAT_IF: "What-if",
};
const STATUS_LABEL: Record<PlanStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived", PUBLISHED: "Published",
};
const STATUS_HUE: Record<PlanStatus, string> = {
  DRAFT: "var(--os-c-orange)", ACTIVE: "var(--os-c-green)",
  PUBLISHED: "var(--os-c-blue)", ARCHIVED: "var(--os-c-darkgray)",
};

export default function BudgetPlansPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/budget-plans");
      if (res.status === 403) { setLoadError("Org-admin access required to view budget plans."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("planning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiPlan[]>();
    for (const p of plans ?? []) {
      const k = p.fiscalYear?.label ?? "No fiscal year";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [plans]);

  const total = plans?.length ?? 0;
  const activeCount = (plans ?? []).filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;

  return (
    <div className="plans">
      <header className="plans__head">
        <div className="plans__head-l">
          <div className="plans__icon"><ScrollText /></div>
          <div>
            <h1 className="plans__title">Budget plans</h1>
            <div className="plans__sub">{plans === null ? "Loading…" : `${total} plan${total === 1 ? "" : "s"} · ${activeCount} active · ${grouped.length} fiscal year${grouped.length === 1 ? "" : "s"}`}</div>
          </div>
        </div>
        <button type="button" className="plans__new" onClick={() => alert("Plan creation flow requires selecting a fiscal year — coming soon")}>
          <Plus /> New plan
        </button>
      </header>

      {loadError ? (
        <div className="plans__error">{loadError}</div>
      ) : plans === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : plans.length === 0 ? (
        <div className="plans__empty">
          <ScrollText />
          <div>
            <h3>No budget plans yet</h3>
            <p>Set up a fiscal year first, then create a Budget / Forecast / Strategic plan against it. Each plan has versions and one or more scenarios.</p>
          </div>
        </div>
      ) : (
        <div className="plans__groups">
          {grouped.map(([fyLabel, items]) => (
            <section key={fyLabel} className="plans__group">
              <header className="plans__group-head">
                <h2>{fyLabel}</h2>
                <span>{items.length} plan{items.length === 1 ? "" : "s"}</span>
              </header>
              <div className="plans__grid">
                {items.map((p) => (
                  <article key={p.id} className="plan-card" style={{ borderTop: `4px solid ${TYPE_HUE[p.type]}` }}>
                    <header className="plan-card__head">
                      <span className="plan-card__type">{TYPE_LABEL[p.type]}</span>
                      <span className="plan-card__status" style={{ background: STATUS_HUE[p.status] }}>{STATUS_LABEL[p.status]}</span>
                    </header>
                    <h3 className="plan-card__name">{p.name}</h3>
                    {p.description ? <p className="plan-card__desc">{p.description}</p> : null}
                    <div className="plan-card__meta">
                      <span><Layers /> v{p.version}</span>
                      <span>{p.scenarios?.length ?? 0} scenario{(p.scenarios?.length ?? 0) === 1 ? "" : "s"}</span>
                      <span>{p._count?.lines ?? 0} line{(p._count?.lines ?? 0) === 1 ? "" : "s"}</span>
                    </div>
                    <a href={`/planning/${p.id}`} className="plan-card__cta">
                      Open plan <ChevronRight />
                    </a>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
