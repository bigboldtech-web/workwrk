"use client";

/* Procurement · Vendors — supplier directory.
 *
 * Vendor cards with PO + invoice counts, payment terms, contact info,
 * archived state. Quick-add via prompt. Hide archived by default.
 *
 * GET  /api/vendors
 * POST /api/vendors  { name, email?, contactName?, paymentTermsDays? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Mail, Phone, FileText, ShoppingCart, Search, Archive } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiVendor = {
  id: string; name: string;
  email?: string | null; contactName?: string | null; phone?: string | null;
  taxId?: string | null; paymentTermsDays: number; archived: boolean;
  _count?: { purchaseOrders?: number; invoices?: number };
  createdAt: string;
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function color(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(s: string) {
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<ApiVendor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendors");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVendors(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = window.prompt("Vendor name?")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/vendors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, paymentTermsDays: 30 }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't add vendor"); }
  }

  const filtered = useMemo(() => {
    let list = vendors ?? [];
    if (!showArchived) list = list.filter((v) => !v.archived);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        v.name.toLowerCase().includes(q) ||
        (v.email ?? "").toLowerCase().includes(q) ||
        (v.contactName ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [vendors, search, showArchived]);

  const total = vendors?.length ?? 0;
  const active = (vendors ?? []).filter((v) => !v.archived).length;
  const archived = total - active;

  return (
    <div className="vnd">
      <header className="vnd__head">
        <div className="vnd__head-l">
          <div className="vnd__icon"><Building2 /></div>
          <div>
            <h1 className="vnd__title">Vendor directory</h1>
            <div className="vnd__sub">
              {vendors === null ? "Loading…" : `${active} active${archived > 0 ? ` · ${archived} archived` : ""}`}
            </div>
          </div>
        </div>
        <div className="vnd__actions">
          <div className="vnd__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors…" />
          </div>
          <label className="vnd__archived">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button type="button" className="vnd__new" onClick={quickAdd}><Plus /> New vendor</button>
        </div>
      </header>

      {loadError ? (
        <div className="vnd__error">{loadError}</div>
      ) : vendors === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="vnd__empty">
          <Building2 />
          <div>
            <h3>{search ? "No vendors match that search." : "No vendors yet"}</h3>
            <p>{search ? "Try a different name or contact." : "Add suppliers to track POs and invoices against them."}</p>
          </div>
        </div>
      ) : (
        <div className="vnd__grid">
          {filtered.map((v) => (
            <article key={v.id} className={`vcard ${v.archived ? "is-archived" : ""}`}>
              <header className="vcard__head">
                <span className="vcard__av" style={{ background: color(v.id) }}>{initials(v.name)}</span>
                <div className="vcard__id">
                  <h3>{v.name}</h3>
                  {v.contactName && <div className="vcard__contact">{v.contactName}</div>}
                </div>
                {v.archived && <span className="vcard__archived-chip"><Archive /> Archived</span>}
              </header>
              <div className="vcard__meta">
                {v.email && (
                  <a href={`mailto:${v.email}`} className="vcard__email"><Mail /> {v.email}</a>
                )}
                {v.phone && <span className="vcard__phone"><Phone /> {v.phone}</span>}
                {v.taxId && <span className="vcard__tax">TAX {v.taxId}</span>}
              </div>
              <footer className="vcard__foot">
                <span className="vcard__terms">Net {v.paymentTermsDays}d</span>
                <span className="vcard__stat"><ShoppingCart /> {v._count?.purchaseOrders ?? 0} POs</span>
                <span className="vcard__stat"><FileText /> {v._count?.invoices ?? 0} invoices</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
