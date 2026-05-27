"use client";

/* Asset register — finance lens.
 *
 * Different from /itsm/cmdb (IT configuration items). This is the
 * org's fixed-asset register: every physical thing the org owns, with
 * purchase cost, depreciation lens, warranty state, current owner.
 *
 * Top: 4 stat tiles (Total value · Assigned % · Warranty expiring ·
 * In repair/lost). Below: filter chips by status, then a dense table.
 *
 * GET /api/assets
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Search, AlertTriangle, Plus, ChevronRight, Calendar } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";
type AssetStatus = "AVAILABLE" | "ASSIGNED" | "IN_REPAIR" | "RETIRED" | "LOST";

type ApiAsset = {
  id: string; name: string; type: string;
  brand?: string | null; model?: string | null; serialNumber?: string | null;
  purchaseDate?: string | null; purchaseCost?: number | null;
  warrantyExpiry?: string | null;
  condition: AssetCondition; status: AssetStatus;
  notes?: string | null;
  assignedTo?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STATUS_HUE: Record<AssetStatus, string> = {
  AVAILABLE: "var(--os-c-green)", ASSIGNED: "var(--os-c-blue)",
  IN_REPAIR: "var(--os-c-orange)", RETIRED: "var(--os-c-darkgray)", LOST: "var(--os-c-red)",
};
const STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: "Available", ASSIGNED: "Assigned", IN_REPAIR: "In repair", RETIRED: "Retired", LOST: "Lost",
};
const CONDITION_HUE: Record<AssetCondition, string> = {
  NEW: "var(--os-c-green)", GOOD: "var(--os-c-teal)",
  FAIR: "var(--os-c-orange)", POOR: "var(--os-c-red)", DAMAGED: "var(--os-c-red)",
};

function fmtMoney(n: number, ccy = "USD"): string {
  if (n >= 1_000_000) return `${ccy} ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${ccy} ${(n / 1_000).toFixed(1)}k`;
  return `${ccy} ${n.toFixed(0)}`;
}
function typeLabel(t: string) { return t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()); }

const MS_DAY = 86_400_000;
function warrantyDays(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_DAY);
}

type FilterKey = "all" | AssetStatus | "warranty-expiring";

export default function AssetsPage() {
  const [assets, setAssets] = useState<ApiAsset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/assets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAssets(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("assets");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const list = assets ?? [];
    const totalValue = list.reduce((acc, a) => acc + (a.purchaseCost ?? 0), 0);
    const assigned = list.filter((a) => a.status === "ASSIGNED").length;
    const expiring = list.filter((a) => {
      const d = warrantyDays(a.warrantyExpiry);
      return d != null && d >= 0 && d < 60;
    }).length;
    const broken = list.filter((a) => a.status === "IN_REPAIR" || a.status === "LOST").length;
    const total = list.length;
    return { totalValue, assigned, expiring, broken, total };
  }, [assets]);

  const filtered = useMemo(() => {
    let list = assets ?? [];
    if (filter === "warranty-expiring") {
      list = list.filter((a) => {
        const d = warrantyDays(a.warrantyExpiry);
        return d != null && d >= 0 && d < 60;
      });
    } else if (filter !== "all") {
      list = list.filter((a) => a.status === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (a.brand ?? "").toLowerCase().includes(q) ||
        (a.model ?? "").toLowerCase().includes(q) ||
        (a.serialNumber ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [assets, filter, search]);

  return (
    <div className="ast">
      <header className="ast__head">
        <div className="ast__head-l">
          <div className="ast__icon"><Box /></div>
          <div>
            <h1 className="ast__title">Asset register</h1>
            <div className="ast__sub">
              {assets === null ? "Loading…" : `${stats.total} asset${stats.total === 1 ? "" : "s"} on the books${stats.totalValue > 0 ? ` · ${fmtMoney(stats.totalValue)} total value` : ""}`}
            </div>
          </div>
        </div>
        <div className="ast__actions">
          <Link href="/itsm/cmdb" className="ast__link">CMDB view →</Link>
          <button type="button" className="ast__new"><Plus /> Add asset</button>
        </div>
      </header>

      {loadError ? (
        <div className="ast__error">{loadError}</div>
      ) : assets === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <section className="ast__stats">
            <div className="ast-stat">
              <span>Total value</span>
              <strong>{fmtMoney(stats.totalValue)}</strong>
            </div>
            <div className="ast-stat">
              <span>Assigned</span>
              <strong>{stats.assigned}<small>/{stats.total}</small></strong>
            </div>
            <div className={`ast-stat ${stats.expiring > 0 ? "is-warn" : ""}`}>
              <span>Warranty expiring &lt;60d</span>
              <strong>{stats.expiring}</strong>
            </div>
            <div className={`ast-stat ${stats.broken > 0 ? "is-alert" : ""}`}>
              <span>In repair / lost</span>
              <strong>{stats.broken}</strong>
            </div>
          </section>

          <div className="ast__toolbar">
            <div className="ast__search">
              <Search />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name / brand / serial…" />
            </div>
            <nav className="ast__filters">
              <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <em>{stats.total}</em></button>
              {(["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"] as AssetStatus[]).map((s) => (
                <button key={s} type="button" className={filter === s ? "is-active" : ""} onClick={() => setFilter(s)}>
                  <span className="ast__filter-dot" style={{ background: STATUS_HUE[s] }} />
                  {STATUS_LABEL[s]} <em>{(assets ?? []).filter((a) => a.status === s).length}</em>
                </button>
              ))}
              <button type="button" className={filter === "warranty-expiring" ? "is-active" : ""} onClick={() => setFilter("warranty-expiring")}>
                <AlertTriangle style={{ width: 12, height: 12 }} /> Warranty soon <em>{stats.expiring}</em>
              </button>
            </nav>
          </div>

          {filtered.length === 0 ? (
            <div className="ast__empty">
              <Box />
              <div>
                <h3>{search ? "Nothing matches that search." : "No assets in this view"}</h3>
                <p>{search ? "Try a different search term." : "Add assets to start tracking depreciation, warranties, and assignment."}</p>
              </div>
            </div>
          ) : (
            <div className="ast__table">
              <div className="ast__row ast__row--head">
                <span>Asset</span>
                <span>Type</span>
                <span>Owner</span>
                <span>Status</span>
                <span>Condition</span>
                <span>Warranty</span>
                <span>Value</span>
              </div>
              {filtered.map((a) => {
                const wDays = warrantyDays(a.warrantyExpiry);
                const wState = wDays == null ? "none" : wDays < 0 ? "expired" : wDays < 60 ? "warn" : "good";
                return (
                  <div key={a.id} className="ast__row">
                    <div>
                      <div className="ast__name">{a.name}</div>
                      <div className="ast__sub-line">{[a.brand, a.model].filter(Boolean).join(" ") || "—"}{a.serialNumber && ` · S/N ${a.serialNumber.slice(-8)}`}</div>
                    </div>
                    <span className="ast__type">{typeLabel(a.type)}</span>
                    <span className="ast__owner">
                      {a.assignedTo ? [a.assignedTo.firstName, a.assignedTo.lastName].filter(Boolean).join(" ") : <em style={{ color: "var(--os-ink-3)" }}>unassigned</em>}
                    </span>
                    <span className="ast__status" style={{ background: STATUS_HUE[a.status] }}>{STATUS_LABEL[a.status]}</span>
                    <span className="ast__cond" style={{ color: CONDITION_HUE[a.condition] }}>{a.condition.toLowerCase()}</span>
                    <span className={`ast__warranty ast__warranty--${wState}`}>
                      {wState === "none" ? "—" : wState === "expired" ? `expired ${-wDays!}d ago` : wState === "warn" ? `${wDays}d left` : <span><Calendar style={{ width: 11, height: 11 }} /> {wDays}d</span>}
                    </span>
                    <span className="ast__value">{a.purchaseCost != null ? fmtMoney(a.purchaseCost) : "—"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
