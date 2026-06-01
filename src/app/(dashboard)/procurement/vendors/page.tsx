"use client";

/* Procurement · Vendors — supplier directory with KPI strip + cards.
 *
 * GET  /api/vendors
 * POST /api/vendors  { name, email?, contactName?, paymentTermsDays? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2, Plus, Mail, Phone, FileText, ShoppingCart, Search, Archive, Hash,
  CheckCircle2, ChevronRight, Receipt, Clock, BadgeCheck,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
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

type SortKey = "name" | "pos" | "invoices" | "terms";

export default function VendorsPage() {
  const [vendors, setVendors] = useState<ApiVendor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendors");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVendors(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
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
      if (!res.ok) { toast(res.status === 403 ? "Not allowed" : "Couldn't add vendor"); return; }
      toast("Vendor added");
      void load();
    } catch { toast("Couldn't add vendor"); }
  }

  const stats = useMemo(() => {
    const list = vendors ?? [];
    const active = list.filter((v) => !v.archived).length;
    const totalPos = list.reduce((a, v) => a + (v._count?.purchaseOrders ?? 0), 0);
    const totalInv = list.reduce((a, v) => a + (v._count?.invoices ?? 0), 0);
    const avgTerms = list.length ? Math.round(list.reduce((a, v) => a + v.paymentTermsDays, 0) / list.length) : 0;
    return { total: list.length, active, archived: list.length - active, totalPos, totalInv, avgTerms };
  }, [vendors]);

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
    const sorted = list.slice();
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "pos") sorted.sort((a, b) => (b._count?.purchaseOrders ?? 0) - (a._count?.purchaseOrders ?? 0));
    if (sort === "invoices") sorted.sort((a, b) => (b._count?.invoices ?? 0) - (a._count?.invoices ?? 0));
    if (sort === "terms") sorted.sort((a, b) => a.paymentTermsDays - b.paymentTermsDays);
    return sorted;
  }, [vendors, search, showArchived, sort]);

  return (
    <>
      <OsTitleBar
        title="Vendor directory"
        Icon={Building2}
        iconGradient={GRAD.indigoBlue}
        description={vendors === null ? "Loading…" : `${stats.active} active${stats.archived > 0 ? ` · ${stats.archived} archived` : ""} · ${stats.totalPos} POs · ${stats.totalInv} invoices`}
        actions={
          <div className="vnd__head-actions">
            <Link href="/procurement" className="vnd__nav-link"><Hash /> Procurement</Link>
            <Link href="/procurement/pos" className="vnd__nav-link"><ShoppingCart /> POs</Link>
            <Link href="/procurement/invoices" className="vnd__nav-link"><FileText /> Invoices</Link>
            <button type="button" className="vnd__btn-primary" onClick={quickAdd}>
              <Plus /> New vendor
            </button>
          </div>
        }
      />

      <div className="vnd">
        <div className="vnd__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={Building2}    label="Active vendors" value={`${stats.active}`}    sub={`${stats.total} total`} />
          <KpiTile accent="var(--os-c-brown)"  Icon={ShoppingCart} label="POs on file"    value={`${stats.totalPos}`}  sub="across all suppliers" />
          <KpiTile accent="var(--os-c-orange)" Icon={Receipt}      label="Invoices"       value={`${stats.totalInv}`}  sub="lifetime" />
          <KpiTile accent="var(--os-c-green)"  Icon={Clock}        label="Avg terms"      value={`Net ${stats.avgTerms}d`} sub="payment window" />
        </div>

        <div className="vnd__toolbar">
          <div className="vnd__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors, contacts, emails…" />
          </div>
          <div className="vnd__sort">
            <span className="vnd__sort-label">Sort</span>
            {(["name", "pos", "invoices", "terms"] as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`vnd__sort-btn${sort === k ? " is-active" : ""}`}
                onClick={() => setSort(k)}
              >
                {k === "name" ? "A–Z" : k === "pos" ? "Most POs" : k === "invoices" ? "Most invoices" : "Shortest terms"}
              </button>
            ))}
          </div>
          <label className="vnd__archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <Archive /> Show archived
          </label>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Building2} iconGradient={GRAD.redPink} title="Couldn't load vendors" subtitle={loadError} cta="Retry" />
        ) : vendors === null ? (
          <div className="vnd__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Building2}
            iconGradient={GRAD.indigoBlue}
            title="No vendors yet"
            subtitle="Add suppliers to track POs and invoices against them."
            chips={["Active", "Archived"]}
            cta="Add vendor"
          />
        ) : filtered.length === 0 ? (
          <div className="vnd__no-match"><Search /> No vendors match your search.</div>
        ) : (
          <div className="vnd__grid">
            {filtered.map((v) => (
              <article key={v.id} className={`vnd__card${v.archived ? " is-archived" : ""}`} style={{ ["--av-c" as unknown as string]: color(v.id) }}>
                <header className="vnd__card-head">
                  <span className="vnd__card-av">{initials(v.name)}</span>
                  <div className="vnd__card-id">
                    <h3>{v.name}</h3>
                    {v.contactName && <div className="vnd__card-contact">{v.contactName}</div>}
                  </div>
                  {v.archived ? (
                    <span className="vnd__card-arch"><Archive /> Archived</span>
                  ) : (
                    <span className="vnd__card-active"><CheckCircle2 /> Active</span>
                  )}
                </header>
                <div className="vnd__card-meta">
                  {v.email && (
                    <a href={`mailto:${v.email}`} className="vnd__card-email"><Mail /> {v.email}</a>
                  )}
                  {v.phone && <span className="vnd__card-phone"><Phone /> {v.phone}</span>}
                  {v.taxId && <span className="vnd__card-tax"><BadgeCheck /> Tax {v.taxId}</span>}
                </div>
                <footer className="vnd__card-foot">
                  <span className="vnd__card-terms">Net {v.paymentTermsDays}d</span>
                  <span className="vnd__card-stat"><ShoppingCart /> {v._count?.purchaseOrders ?? 0}</span>
                  <span className="vnd__card-stat"><FileText /> {v._count?.invoices ?? 0}</span>
                  <ChevronRight className="vnd__card-arrow" />
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Building2; label: string; value: string; sub: string }) {
  return (
    <div className="vnd__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="vnd__kpi-accent" aria-hidden="true" />
      <div className="vnd__kpi-row">
        <div className="vnd__kpi-icon"><Icon /></div>
        <div className="vnd__kpi-label">{label}</div>
      </div>
      <div className="vnd__kpi-value">{value}</div>
      <div className="vnd__kpi-sub">{sub}</div>
    </div>
  );
}
