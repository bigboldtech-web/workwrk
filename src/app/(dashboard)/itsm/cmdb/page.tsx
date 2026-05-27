"use client";

/* ITSM · CMDB — configuration & asset inventory.
 *
 * Visual asset directory grouped by AssetType (LAPTOP / DESKTOP / PHONE /
 * MONITOR / NETWORK_DEVICE / SERVER / …). Each asset shows: name,
 * brand/model, serial tail, condition, current owner, warranty status.
 *
 * The deeper "dependency graph" view (which asset depends on which) is a
 * V2 because the schema doesn't carry edges yet — that needs a migration.
 *
 * Reads: GET /api/assets
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ServerCog, Laptop, Monitor, Smartphone, HardDrive, Box, AlertTriangle, Search } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type AssetCondition = "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
type AssetStatus = "AVAILABLE" | "ASSIGNED" | "MAINTENANCE" | "RETIRED";

type ApiAsset = {
  id: string;
  name: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiry?: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  notes?: string | null;
  assignedToId?: string | null;
  assignedTo?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  LAPTOP: Laptop, DESKTOP: Monitor, MONITOR: Monitor,
  PHONE: Smartphone, MOBILE_PHONE: Smartphone,
  SERVER: ServerCog, NETWORK_DEVICE: ServerCog,
  STORAGE: HardDrive,
};
const TYPE_HUE: Record<string, string> = {
  LAPTOP: "var(--os-c-blue)", DESKTOP: "var(--os-c-indigo)", MONITOR: "var(--os-c-purple)",
  PHONE: "var(--os-c-pink)", MOBILE_PHONE: "var(--os-c-pink)",
  SERVER: "var(--os-c-red)", NETWORK_DEVICE: "var(--os-c-orange)",
  STORAGE: "var(--os-c-teal)", DEFAULT: "var(--os-c-darkgray)",
};
function typeIcon(t: string) { return TYPE_ICON[t] ?? Box; }
function typeHue(t: string) { return TYPE_HUE[t] ?? TYPE_HUE.DEFAULT; }
function typeLabel(t: string) { return t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()); }

const COND_COLOR: Record<AssetCondition, string> = {
  EXCELLENT: "var(--os-c-green)", GOOD: "var(--os-c-teal)",
  FAIR: "var(--os-c-orange)", POOR: "var(--os-c-red)",
};
const STATUS_COLOR: Record<AssetStatus, string> = {
  AVAILABLE: "var(--os-c-green)", ASSIGNED: "var(--os-c-blue)",
  MAINTENANCE: "var(--os-c-orange)", RETIRED: "var(--os-c-darkgray)",
};

function warrantyState(iso?: string | null): { tone: "good" | "warn" | "expired" | "none"; label: string } {
  if (!iso) return { tone: "none", label: "No warranty info" };
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  if (days < 0) return { tone: "expired", label: `Expired ${Math.abs(days)}d ago` };
  if (days < 60) return { tone: "warn", label: `Expires in ${days}d` };
  return { tone: "good", label: `Covered (${days}d left)` };
}

export default function CmdbPage() {
  const [assets, setAssets] = useState<ApiAsset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assets ?? [];
    return (assets ?? []).filter((a) =>
      [a.name, a.brand, a.model, a.serialNumber, a.type]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q))
    );
  }, [assets, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiAsset[]>();
    for (const a of filtered) {
      if (!m.has(a.type)) m.set(a.type, []);
      m.get(a.type)!.push(a);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const totalCount = assets?.length ?? 0;
  const assignedCount = (assets ?? []).filter((a) => a.status === "ASSIGNED").length;
  const expiring = (assets ?? []).filter((a) => {
    if (!a.warrantyExpiry) return false;
    const days = (new Date(a.warrantyExpiry).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days < 60;
  }).length;

  return (
    <div className="cmdb">
      <header className="cmdb__head">
        <div className="cmdb__head-l">
          <div className="cmdb__icon"><ServerCog /></div>
          <div>
            <h1 className="cmdb__title">CMDB · Configuration items</h1>
            <div className="cmdb__sub">
              {assets === null ? "Loading…" : (
                <>{totalCount} asset{totalCount === 1 ? "" : "s"} · {assignedCount} assigned · {expiring} warranty expiring soon</>
              )}
            </div>
          </div>
        </div>
        <div className="cmdb__search">
          <Search />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, model, serial…"
          />
        </div>
      </header>

      {loadError ? (
        <div className="cmdb__error">Couldn&apos;t load: {loadError}</div>
      ) : assets === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="cmdb__empty">
          <Box />
          <div>
            <h3>{search ? "Nothing matches that search" : "No assets in CMDB yet"}</h3>
            <p>{search ? "Try a different name, brand, or serial." : "Once your IT team registers laptops, monitors, phones, and servers, they show up here grouped by type."}</p>
          </div>
        </div>
      ) : (
        <div className="cmdb__groups">
          {grouped.map(([type, items]) => {
            const Icon = typeIcon(type);
            const hue = typeHue(type);
            return (
              <section key={type} className="cmdb__group">
                <header className="cmdb__group-head" style={{ borderLeft: `4px solid ${hue}` }}>
                  <Icon />
                  <h2>{typeLabel(type)}</h2>
                  <span className="cmdb__group-count">{items.length}</span>
                </header>
                <div className="cmdb__cards">
                  {items.map((a) => {
                    const war = warrantyState(a.warrantyExpiry);
                    const ItemIcon = typeIcon(a.type);
                    return (
                      <article key={a.id} className="cmdb-card">
                        <div className="cmdb-card__head">
                          <span className="cmdb-card__type-pill" style={{ background: hue }}>
                            <ItemIcon />
                          </span>
                          <span className={`cmdb-card__status cmdb-card__status--${a.status.toLowerCase()}`} style={{ background: STATUS_COLOR[a.status] }}>
                            {a.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </div>
                        <h3 className="cmdb-card__name">{a.name}</h3>
                        <div className="cmdb-card__model">
                          {[a.brand, a.model].filter(Boolean).join(" ") || <em style={{ color: "var(--os-ink-3)" }}>No model info</em>}
                        </div>
                        {a.serialNumber ? (
                          <div className="cmdb-card__serial">S/N <code>{a.serialNumber.slice(-10)}</code></div>
                        ) : null}
                        <div className="cmdb-card__row">
                          <span>Owner</span>
                          <strong>{a.assignedTo ? `${a.assignedTo.firstName ?? ""} ${a.assignedTo.lastName ?? ""}`.trim() : <em style={{ color: "var(--os-ink-3)", fontWeight: 400 }}>unassigned</em>}</strong>
                        </div>
                        <div className="cmdb-card__row">
                          <span>Condition</span>
                          <strong style={{ color: COND_COLOR[a.condition] }}>{a.condition.toLowerCase()}</strong>
                        </div>
                        <div className={`cmdb-card__warranty cmdb-card__warranty--${war.tone}`}>
                          {war.tone === "expired" || war.tone === "warn" ? <AlertTriangle /> : null}
                          <span>{war.label}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
