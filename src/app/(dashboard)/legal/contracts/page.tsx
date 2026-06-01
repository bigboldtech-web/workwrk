"use client";

/* Legal · Contracts — flexible library, not a fixed schema.
 *
 * Type is a free-form string (MSA / NDA / DPA / SOW / vendor /
 * customer / anything-the-org-uses). Cards group by user-defined type.
 * Type filter chips auto-populated from existing values. Quick-add
 * via prompts captures the bare minimum (title + counterparty + type)
 * — anything more goes in the detail editor.
 *
 * GET  /api/legal/contracts
 * POST /api/legal/contracts  { title, counterparty, type?, status? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSignature, Plus, Search, Calendar, ExternalLink, AlertTriangle, Hash, Lock, Shield } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "DRAFT" | "IN_REVIEW" | "IN_NEGOTIATION" | "AWAITING_SIGNATURE" | "SIGNED" | "ACTIVE" | "EXPIRED" | "TERMINATED";

type ApiContract = {
  id: string; title: string;
  counterparty: string; counterpartyType?: string | null;
  type?: string | null; status: Status;
  value?: number | string | null; currency: string;
  signedAt?: string | null; effectiveDate?: string | null; expiresAt?: string | null;
  autoRenew: boolean; renewalNoticeDays?: number | null;
  ownerId?: string | null;
  documentUrl?: string | null;
};

const STATUS_HUE: Record<Status, string> = {
  DRAFT: "var(--os-c-indigo)", IN_REVIEW: "var(--os-c-orange)",
  IN_NEGOTIATION: "var(--os-c-purple)", AWAITING_SIGNATURE: "var(--os-c-pink)",
  SIGNED: "var(--os-c-blue)", ACTIVE: "var(--os-c-green)",
  EXPIRED: "var(--os-c-darkgray)", TERMINATED: "var(--os-c-red)",
};
const STATUS_LABEL: Record<Status, string> = {
  DRAFT: "Draft", IN_REVIEW: "In review", IN_NEGOTIATION: "Negotiating",
  AWAITING_SIGNATURE: "Awaiting signature", SIGNED: "Signed", ACTIVE: "Active",
  EXPIRED: "Expired", TERMINATED: "Terminated",
};

function num(v?: number | string | null): number { if (v == null) return 0; return typeof v === "string" ? parseFloat(v) : v; }
function money(n: number, ccy = "USD"): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${ccy} ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${ccy} ${(n / 1_000).toFixed(0)}k`;
  return `${ccy} ${n.toFixed(0)}`;
}
const MS_DAY = 86_400_000;
function expiringSoon(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_DAY);
}

export default function ContractsLibrary() {
  const [items, setItems] = useState<ApiContract[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/legal/contracts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.contracts ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("legal");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Auto-suggest types from existing values
  const knownTypes = useMemo(() => {
    const s = new Set<string>();
    for (const c of items ?? []) if (c.type) s.add(c.type);
    return Array.from(s).sort();
  }, [items]);

  async function quickAdd() {
    const title = window.prompt("Contract title?")?.trim();
    if (!title) return;
    const counterparty = window.prompt("Counterparty (other party's name)?")?.trim();
    if (!counterparty) return;
    const typeSuggest = knownTypes.length > 0 ? ` (existing types: ${knownTypes.slice(0, 5).join(", ")})` : "";
    const type = window.prompt(`Contract type — free text${typeSuggest}`)?.trim() || undefined;
    try {
      const res = await fetch("/api/legal/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, counterparty, type, status: "DRAFT" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't add contract"); }
  }

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeType) list = list.filter((c) => (c.type ?? "Uncategorised") === activeType);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.counterparty.toLowerCase().includes(q) ||
        (c.type ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, activeType, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiContract[]>();
    for (const c of filtered) {
      const k = c.type ?? "Uncategorised";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const total = items?.length ?? 0;
  const active = (items ?? []).filter((c) => c.status === "ACTIVE" || c.status === "SIGNED").length;
  const expiringIn90 = (items ?? []).filter((c) => {
    const d = expiringSoon(c.expiresAt);
    return d != null && d >= 0 && d <= 90;
  }).length;

  return (<>
    <OsTitleBar
      title="Contracts"
      Icon={FileSignature}
      iconGradient={GRAD.purpleIndigo}
      description={items === null ? "Loading…" : `${total} contract${total === 1 ? "" : "s"} · ${active} active${expiringIn90 > 0 ? ` · ${expiringIn90} expiring in 90d` : ""}`}
      actions={
        <div className="lib__head-actions">
          <Link href="/legal" className="lib__nav-link"><Hash /> Legal</Link>
          <Link href="/legal/ip" className="lib__nav-link"><Lock /> IP</Link>
          <Link href="/legal/privacy" className="lib__nav-link"><Shield /> Privacy</Link>
          <button type="button" className="lib__btn-primary" onClick={quickAdd}><Plus /> Add contract</button>
        </div>
      }
    />

    <div className="lib">
      <div className="lib__toolbar">
        <div className="lib__search">
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contracts…" />
        </div>
      </div>

      {knownTypes.length > 0 && (
        <nav className="lib__types">
          <button type="button" className={!activeType ? "is-active" : ""} onClick={() => setActiveType(null)}>All <em>{total}</em></button>
          {knownTypes.map((t) => (
            <button key={t} type="button" className={activeType === t ? "is-active" : ""} onClick={() => setActiveType(t)}>
              {t} <em>{(items ?? []).filter((c) => c.type === t).length}</em>
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
          <FileSignature />
          <div>
            <h3>{search ? "Nothing matches that search." : "No contracts yet"}</h3>
            <p>Type is a free-text field — call them whatever your team calls them (MSA, vendor agreement, intern offer, …).</p>
          </div>
        </div>
      ) : (
        <div className="lib__sections">
          {grouped.map(([type, items]) => (
            <section key={type} className="lib__section">
              <header><h2>{type}</h2><span>{items.length}</span></header>
              <div className="lib__grid">
                {items.map((c) => {
                  const exp = expiringSoon(c.expiresAt);
                  const warn = exp != null && exp >= 0 && exp <= 90;
                  return (
                    <article key={c.id} className="lib-card">
                      <header className="lib-card__head">
                        <h3>{c.title}</h3>
                        <span className="lib-card__status" style={{ background: STATUS_HUE[c.status] }}>{STATUS_LABEL[c.status]}</span>
                      </header>
                      <div className="lib-card__sub">
                        <strong>{c.counterparty}</strong>
                        {c.counterpartyType && <em>· {c.counterpartyType}</em>}
                      </div>
                      <div className="lib-card__meta">
                        {num(c.value) > 0 && <span className="lib-card__val">{money(num(c.value), c.currency)}</span>}
                        {c.effectiveDate && <span><Calendar /> {new Date(c.effectiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                        {c.expiresAt && <span className={warn ? "is-warn" : ""}>{warn ? <AlertTriangle /> : <Calendar />} expires {exp}d</span>}
                      </div>
                      <footer className="lib-card__foot">
                        {c.autoRenew && <span className="lib-card__chip">Auto-renew</span>}
                        {c.documentUrl && (
                          <a href={c.documentUrl} target="_blank" rel="noopener" className="lib-card__link" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink /> Doc
                          </a>
                        )}
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
  </>);
}
