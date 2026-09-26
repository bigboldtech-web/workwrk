"use client";

/* Asset register, finance lens.
 *
 * The org's fixed-asset register: every physical thing the org owns, with
 * purchase cost, depreciation lens, warranty state, current owner.
 *
 * Top: 4 stat tiles (Total value · Assigned % · Warranty expiring ·
 * In repair/lost). Below: filter chips by status, then a dense table with
 * a per-row "…" actions menu (edit / assign / status / delete).
 *
 * GET /api/assets · POST /api/assets · PATCH+DELETE /api/assets/[id]
 */

import { SkeletonRows } from "@/components/ui/skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Search, AlertTriangle, Calendar } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { apiFetch } from "@/lib/api-fetch";
import { useOrgCurrency } from "@/lib/org/use-org-currency";

import { useOsShell } from "@/components/layout/os/shell-context";
import {
  STATUS_HUE, STATUS_LABEL, CONDITION_HUE, typeLabel, personName,
  type ApiAsset, type AssetStatus,
} from "./types";
import { AssetFormDialog } from "./asset-form-dialog";
import { AssignDialog } from "./assign-dialog";
import { AssetRowMenu } from "./asset-row-menu";


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

  // Page-owned dialog state, the row menu asks the page to open these so
  // the dialogs don't live inside the (portalled) menu panel.
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ApiAsset | null>(null);
  const [assigning, setAssigning] = useState<ApiAsset | null>(null);

  // The org currency (settings.currency) instead of a hard-coded USD.
  const { format: fmtMoney } = useOrgCurrency();
  const load = useCallback(async () => {
    const r = await apiFetch<ApiAsset[] | { data?: ApiAsset[] }>("/api/assets", { cache: "no-store" });
    if (!r.ok) { setLoadError(r.error); return; }
    setLoadError(null);
    setAssets(Array.isArray(r.data) ? r.data : r.data.data ?? []);
  }, []);
  const v = rowVersion("assets");
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [v, load]);

  // The filter row's counts (the four stat tiles are gone, spec 2.2).
  const stats = useMemo(() => {
    const list = assets ?? [];
    const expiring = list.filter((a) => {
      const d = warrantyDays(a.warrantyExpiry);
      return d != null && d >= 0 && d < 60;
    }).length;
    return { expiring, total: list.length };
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

  return (<>
    <OsPageHeader
      title="Assets"
      primary={{ label: "Add asset", onClick: () => setCreateOpen(true) }}
    />


    <div className="ast">

      {loadError ? (
        <OsEmptyView variant="error" title="Couldn't load Assets" hint={loadError} action={{ label: "Try again", onClick: () => void load() }} />
      ) : assets === null ? (
        <SkeletonRows />
      ) : (
        <>

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
            <div className="ast__table ast__table--actions">
              <div className="ast__row ast__row--head">
                <span>Asset</span>
                <span>Type</span>
                <span>Owner</span>
                <span>Status</span>
                <span>Condition</span>
                <span>Warranty</span>
                <span>Value</span>
                <span aria-hidden="true" />
              </div>
              {filtered.map((a) => {
                const wDays = warrantyDays(a.warrantyExpiry);
                const wState = wDays == null ? "none" : wDays < 0 ? "expired" : wDays < 60 ? "warn" : "good";
                return (
                  <div key={a.id} className="ast__row">
                    <div>
                      <div className="ast__name">{a.name}</div>
                      <div className="ast__sub-line">{[a.brand, a.model].filter(Boolean).join(" ") || "No model"}{a.serialNumber && ` · S/N ${a.serialNumber.slice(-8)}`}</div>
                    </div>
                    <span className="ast__type">{typeLabel(a.type)}</span>
                    <span className="ast__owner">
                      {a.assignedTo ? (personName(a.assignedTo) || "assigned") : <em style={{ color: "var(--os-ink-3)" }}>unassigned</em>}
                    </span>
                    <span className="ast__status" style={{ background: STATUS_HUE[a.status] }}>{STATUS_LABEL[a.status]}</span>
                    <span className="ast__cond" style={{ color: CONDITION_HUE[a.condition] }}>{a.condition.toLowerCase()}</span>
                    <span className={`ast__warranty ast__warranty--${wState}`}>
                      {wState === "none" ? "No warranty" : wState === "expired" ? `expired ${-wDays!}d ago` : wState === "warn" ? `${wDays}d left` : <span><Calendar style={{ width: 11, height: 11 }} /> {wDays}d</span>}
                    </span>
                    <span className="ast__value">{a.purchaseCost != null ? fmtMoney(a.purchaseCost) : "No cost"}</span>
                    <div className="ast__row-actions">
                      <AssetRowMenu
                        asset={a}
                        onEdit={(x) => setEditing(x)}
                        onAssign={(x) => setAssigning(x)}
                        onChanged={() => void load()}
                      />
                    </div>
                  </div>
                );
              })}
              {/* The value line (spec-tools-misc 2.2): the stat tiles are gone
                  and the money lives here, for the rows in view. */}
              <div className="ast__foot">
                <span>Total records {filtered.length}</span>
                <span>Total value {fmtMoney(filtered.reduce((acc, x) => acc + (x.purchaseCost ?? 0), 0))}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>

    <AssetFormDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSaved={() => void load()}
    />
    <AssetFormDialog
      open={editing !== null}
      onOpenChange={(o) => { if (!o) setEditing(null); }}
      asset={editing}
      onSaved={() => void load()}
    />
    <AssignDialog
      open={assigning !== null}
      onOpenChange={(o) => { if (!o) setAssigning(null); }}
      asset={assigning}
      onSaved={() => void load()}
    />
  </>);
}
