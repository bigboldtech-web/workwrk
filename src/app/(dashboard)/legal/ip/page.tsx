"use client";

/* Legal · IP — flexible IP register (trademarks / copyrights / patents / etc.).
 *
 * IP type chip is grouped by; jurisdiction tags surface as chips on each
 * card; renewal date with warning when within 90d. Search by mark, reg#,
 * jurisdiction.
 *
 * GET  /api/legal/trademarks
 * POST /api/legal/trademarks  { mark, type?, status? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Plus, Search, AlertTriangle, Calendar } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiIp = {
  id: string; mark: string; type: string;
  status: string;
  jurisdictions?: unknown; classes?: unknown;
  registrationNumber?: string | null; applicationNumber?: string | null;
  filedAt?: string | null; registeredAt?: string | null;
  expiresAt?: string | null; renewalDueAt?: string | null;
  externalCounselFirm?: string | null;
  notes?: string | null;
};

const STATUS_HUE: Record<string, string> = {
  PROPOSED: "var(--os-c-indigo)", APPLIED: "var(--os-c-orange)",
  PUBLISHED: "var(--os-c-purple)", REGISTERED: "var(--os-c-green)",
  REFUSED: "var(--os-c-red)", LAPSED: "var(--os-c-darkgray)",
  ABANDONED: "var(--os-c-darkgray)", CANCELLED: "var(--os-c-darkgray)",
};
function statusHue(s: string) { return STATUS_HUE[s] ?? "var(--os-c-blue)"; }

const TYPE_HUE: Record<string, string> = {
  WORD_MARK: "var(--os-c-blue)", LOGO_MARK: "var(--os-c-purple)",
  COPYRIGHT: "var(--os-c-pink)", PATENT: "var(--os-c-orange)",
  TRADE_SECRET: "var(--os-c-red)", DOMAIN: "var(--os-c-teal)",
};
function typeHue(t: string) { return TYPE_HUE[t] ?? "var(--os-c-indigo)"; }
function typeLabel(t: string) { return t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()); }

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

const MS_DAY = 86_400_000;
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_DAY);
}

export default function IpLibrary() {
  const [items, setItems] = useState<ApiIp[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/legal/trademarks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.trademarks ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("legal");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const mark = window.prompt("Mark / title?")?.trim();
    if (!mark) return;
    try {
      const res = await fetch("/api/legal/trademarks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark, type: "WORD_MARK", status: "PROPOSED" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't add IP item"); }
  }

  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeType) list = list.filter((i) => i.type === activeType);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.mark.toLowerCase().includes(q) ||
        (i.registrationNumber ?? "").toLowerCase().includes(q) ||
        (i.applicationNumber ?? "").toLowerCase().includes(q) ||
        listOf(i.jurisdictions).join(" ").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, activeType, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiIp[]>();
    for (const i of filtered) {
      if (!m.has(i.type)) m.set(i.type, []);
      m.get(i.type)!.push(i);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const total = items?.length ?? 0;
  const registered = (items ?? []).filter((i) => i.status === "REGISTERED").length;
  const renewing = (items ?? []).filter((i) => {
    const d = daysUntil(i.renewalDueAt ?? i.expiresAt);
    return d != null && d >= 0 && d <= 90;
  }).length;

  return (
    <div className="lib">
      <header className="lib__head">
        <div className="lib__head-l">
          <div className="lib__icon" style={{ background: "linear-gradient(135deg, var(--os-c-purple), var(--os-c-pink))" }}><Lock /></div>
          <div>
            <h1 className="lib__title">IP register</h1>
            <div className="lib__sub">
              {items === null ? "Loading…" : `${total} item${total === 1 ? "" : "s"} · ${registered} registered${renewing > 0 ? ` · ${renewing} need renewal in 90d` : ""}`}
            </div>
          </div>
        </div>
        <div className="lib__actions">
          <div className="lib__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search marks, reg #, jurisdiction…" />
          </div>
          <button type="button" className="lib__new" onClick={quickAdd}><Plus /> Add IP item</button>
        </div>
      </header>

      {types.length > 0 && (
        <nav className="lib__types">
          <button type="button" className={!activeType ? "is-active" : ""} onClick={() => setActiveType(null)}>All <em>{total}</em></button>
          {types.map(([t, n]) => (
            <button key={t} type="button" className={activeType === t ? "is-active" : ""} onClick={() => setActiveType(t)}>
              <span className="lib__type-dot" style={{ background: typeHue(t) }} />
              {typeLabel(t)} <em>{n}</em>
            </button>
          ))}
        </nav>
      )}

      {loadError ? (
        <div className="lib__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="lib__empty">
          <Lock />
          <div>
            <h3>{search ? "Nothing matches that search." : "No IP items yet"}</h3>
            <p>Add trademarks, copyrights, patent filings, even trade-secret documentation. Type is flexible.</p>
          </div>
        </div>
      ) : (
        <div className="lib__sections">
          {grouped.map(([type, items]) => (
            <section key={type} className="lib__section">
              <header><h2>{typeLabel(type)}</h2><span>{items.length}</span></header>
              <div className="lib__grid">
                {items.map((i) => {
                  const renewalDays = daysUntil(i.renewalDueAt ?? i.expiresAt);
                  const warn = renewalDays != null && renewalDays >= 0 && renewalDays <= 90;
                  const jurs = listOf(i.jurisdictions);
                  return (
                    <article key={i.id} className="lib-card">
                      <header className="lib-card__head">
                        <h3>{i.mark}</h3>
                        <span className="lib-card__status" style={{ background: statusHue(i.status) }}>{i.status.toLowerCase()}</span>
                      </header>
                      <div className="lib-card__sub">
                        <span className="lib-card__type" style={{ color: typeHue(i.type) }}>{typeLabel(i.type)}</span>
                        {i.registrationNumber && <em>· Reg #{i.registrationNumber}</em>}
                        {!i.registrationNumber && i.applicationNumber && <em>· App #{i.applicationNumber}</em>}
                      </div>
                      {jurs.length > 0 && (
                        <div className="lib-card__chips">
                          {jurs.slice(0, 5).map((j) => <span key={j} className="lib-card__chip">{j}</span>)}
                          {jurs.length > 5 && <span className="lib-card__chip">+{jurs.length - 5}</span>}
                        </div>
                      )}
                      <footer className="lib-card__foot">
                        {(i.renewalDueAt || i.expiresAt) && (
                          <span className={warn ? "is-warn" : ""}>
                            {warn ? <AlertTriangle /> : <Calendar />}
                            {warn ? `${renewalDays}d to renew` : `Renews in ${renewalDays}d`}
                          </span>
                        )}
                        {i.externalCounselFirm && <span className="lib-card__chip">via {i.externalCounselFirm}</span>}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
