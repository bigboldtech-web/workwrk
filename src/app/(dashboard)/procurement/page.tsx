"use client";

/* Procurement hub — overview of POs, invoices, vendors with KPI strip.
 *
 *  GET /api/purchase-orders
 *  GET /api/vendors
 *  GET /api/vendor-invoices
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ShoppingCart, Plus, FileText, Building2, ChevronRight, Coins, Clock,
  CheckCircle2, Truck, PackageCheck, AlertTriangle, TrendingUp, Hash, Activity,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type PoStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SENT" | "RECEIVED" | "CLOSED";
type ApiPO = {
  id: string;
  number: string;
  description: string;
  amount: number;
  currency: string;
  status: PoStatus;
  expectedDeliveryDate?: string | null;
  vendor?: { id: string; name: string } | null;
  createdAt: string;
};
type ApiVendor = { id: string; name: string; status?: string };
type ApiInvoice = { id: string; total?: number; amount?: number; status?: string; dueDate?: string | null };

const STATUS_COLOR: Record<PoStatus, string> = {
  DRAFT: "var(--os-c-indigo)", SUBMITTED: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", REJECTED: "var(--os-c-red)",
  SENT: "var(--os-c-purple)", RECEIVED: "var(--os-c-teal)",
  CLOSED: "var(--os-c-green)",
};
const STATUS_LABEL: Record<PoStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", SENT: "Sent", RECEIVED: "Received", CLOSED: "Closed",
};
const STATUS_ICON: Record<PoStatus, typeof Clock> = {
  DRAFT: FileText, SUBMITTED: Clock, APPROVED: CheckCircle2,
  REJECTED: AlertTriangle, SENT: Truck, RECEIVED: PackageCheck, CLOSED: CheckCircle2,
};

function fmtMoney(n: number, cur = "INR"): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const sym = cur === "INR" ? "₹" : cur === "USD" ? "$" : cur === "EUR" ? "€" : "";
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`;
  return `${sym}${Math.round(n)}`;
}

export default function ProcurementHubPage() {
  const [pos, setPos] = useState<ApiPO[] | null>(null);
  const [vendors, setVendors] = useState<ApiVendor[] | null>(null);
  const [invoices, setInvoices] = useState<ApiInvoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [p, v, i] = await Promise.all([
        fetch("/api/purchase-orders?limit=200").catch(() => null),
        fetch("/api/vendors").catch(() => null),
        fetch("/api/vendor-invoices?limit=200").catch(() => null),
      ]);
      const unwrap = async (r: Response | null) => {
        if (!r || !r.ok) return [];
        const d = await r.json();
        return d.data?.items ?? d.data ?? (Array.isArray(d) ? d : []);
      };
      setPos(await unwrap(p));
      setVendors(await unwrap(v));
      setInvoices(await unwrap(i));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const poList = pos ?? [];
    const open = poList.filter((p) => p.status !== "CLOSED" && p.status !== "REJECTED");
    const sent = poList.filter((p) => p.status === "SENT");
    const openValue = open.reduce((acc, p) => acc + p.amount, 0);
    const cur = poList[0]?.currency ?? "INR";
    const counts: Record<PoStatus, number> = {
      DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, SENT: 0, RECEIVED: 0, CLOSED: 0,
    };
    for (const p of poList) counts[p.status] = (counts[p.status] ?? 0) + 1;
    const activeVendors = (vendors ?? []).filter((v) => !v.status || v.status === "ACTIVE").length;
    const inv = invoices ?? [];
    const openInvoices = inv.filter((i) => i.status !== "PAID" && i.status !== "VOID");
    const dueSoon = openInvoices.filter((i) => {
      if (!i.dueDate) return false;
      const d = new Date(i.dueDate).getTime() - Date.now();
      return d > 0 && d < 1000 * 60 * 60 * 24 * 14;
    });
    const invoiceValue = openInvoices.reduce((a, i) => a + (i.total ?? i.amount ?? 0), 0);
    return {
      totalPos: poList.length, open: open.length, sent: sent.length, openValue, cur,
      counts,
      vendors: vendors?.length ?? 0, activeVendors,
      invoices: inv.length, openInvoices: openInvoices.length, dueSoon: dueSoon.length, invoiceValue,
    };
  }, [pos, vendors, invoices]);

  const recentPos = useMemo(() => {
    return (pos ?? []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6);
  }, [pos]);

  const loading = pos === null && vendors === null && invoices === null;

  return (
    <>
      <OsTitleBar
        title="Procurement"
        Icon={ShoppingCart}
        iconGradient={GRAD.brownOrange}
        description={loading ? "Loading procurement…" : `${stats.totalPos} PO${stats.totalPos === 1 ? "" : "s"} · ${stats.open} open · ${fmtMoney(stats.openValue, stats.cur)} pending`}
        actions={
          <div className="proc__head-actions">
            <Link href="/procurement/vendors" className="proc__nav-link"><Building2 /> Vendors</Link>
            <Link href="/procurement/invoices" className="proc__nav-link"><FileText /> Invoices</Link>
            <Link href="/procurement/pos" className="proc__btn-primary"><Plus /> New PO</Link>
          </div>
        }
      />

      <div className="proc">
        {loadError ? (
          <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.redPink} title="Couldn't load procurement" subtitle={loadError} cta="Retry" />
        ) : (
          <>
            <div className="proc__kpis">
              <KpiTile accent="var(--os-c-orange)" Icon={Clock}      label="Open POs"        value={`${stats.open}`}                       sub={fmtMoney(stats.openValue, stats.cur)} />
              <KpiTile accent="var(--os-c-purple)" Icon={Truck}      label="Sent to vendor"  value={`${stats.sent}`}                       sub="awaiting receipt" />
              <KpiTile accent="var(--os-c-blue)"   Icon={FileText}   label="Open invoices"   value={`${stats.openInvoices}`}               sub={`${stats.dueSoon} due within 14d`} />
              <KpiTile accent="var(--os-c-green)"  Icon={Building2}  label="Active vendors"  value={`${stats.activeVendors}`}              sub={`${stats.vendors} total`} />
            </div>

            {/* Status mix bar */}
            <section className="proc__statusbar">
              <header><h2><Activity /> Status mix</h2></header>
              <div className="proc__bar">
                {(Object.keys(STATUS_LABEL) as PoStatus[]).map((s) => {
                  const n = stats.counts[s] ?? 0;
                  if (n === 0 || !stats.totalPos) return null;
                  const pct = (n / stats.totalPos) * 100;
                  return (
                    <span
                      key={s}
                      className="proc__bar-seg"
                      style={{ width: `${pct}%`, background: STATUS_COLOR[s] }}
                      title={`${STATUS_LABEL[s]} · ${n} (${pct.toFixed(0)}%)`}
                    />
                  );
                })}
              </div>
              <div className="proc__bar-legend">
                {(Object.keys(STATUS_LABEL) as PoStatus[]).map((s) => stats.counts[s] > 0 && (
                  <span key={s} className="proc__bar-legend-item" style={{ ["--l-c" as unknown as string]: STATUS_COLOR[s] }}>
                    <span className="proc__bar-dot" /> {STATUS_LABEL[s]} <strong>{stats.counts[s]}</strong>
                  </span>
                ))}
              </div>
            </section>

            <section className="proc__section">
              <header className="proc__section-head">
                <h2><Hash /> Workspaces</h2>
                <span className="proc__section-line" />
              </header>
              <div className="proc__grid">
                <HubTile href="/procurement/pos" Icon={ShoppingCart} hue="var(--os-c-brown)"
                  title="Purchase orders" stat={`${stats.totalPos}`} sub={`${stats.open} open`} />
                <HubTile href="/procurement/invoices" Icon={FileText} hue="var(--os-c-blue)"
                  title="Vendor invoices" stat={`${stats.openInvoices}`} sub={`${stats.dueSoon} due soon`} />
                <HubTile href="/procurement/vendors" Icon={Building2} hue="var(--os-c-teal)"
                  title="Vendors" stat={`${stats.activeVendors}`} sub={`of ${stats.vendors} total`} />
                <HubTile href="/financials" Icon={Coins} hue="var(--os-c-green)"
                  title="Finance" stat="Books & reports" sub="GL · statements · variance" />
              </div>
            </section>

            {recentPos.length > 0 && (
              <section className="proc__section">
                <header className="proc__section-head">
                  <h2><TrendingUp /> Recent POs</h2>
                  <span className="proc__section-line" />
                  <Link href="/procurement/pos" className="proc__section-more">all <ChevronRight /></Link>
                </header>
                <div className="proc__recent">
                  {recentPos.map((p) => {
                    const Icon = STATUS_ICON[p.status];
                    return (
                      <Link key={p.id} href={`/procurement/${p.id}`} className="proc__po" style={{ ["--p-c" as unknown as string]: STATUS_COLOR[p.status] }}>
                        <span className="proc__po-status"><Icon /> {STATUS_LABEL[p.status]}</span>
                        <div className="proc__po-main">
                          <div className="proc__po-title">{p.description}</div>
                          <div className="proc__po-meta">
                            <span className="proc__po-num">{p.number}</span>
                            {p.vendor && <span>{p.vendor.name}</span>}
                            {p.expectedDeliveryDate && <span className="proc__po-delivery">due {new Date(p.expectedDeliveryDate).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <div className="proc__po-amt">{fmtMoney(p.amount, p.currency)}</div>
                        <ChevronRight className="proc__po-arrow" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof ShoppingCart; label: string; value: string; sub: string }) {
  return (
    <div className="proc__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="proc__kpi-accent" aria-hidden="true" />
      <div className="proc__kpi-row">
        <div className="proc__kpi-icon"><Icon /></div>
        <div className="proc__kpi-label">{label}</div>
      </div>
      <div className="proc__kpi-value">{value}</div>
      <div className="proc__kpi-sub">{sub}</div>
    </div>
  );
}

function HubTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof ShoppingCart; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="proc__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="proc__tile-icon"><Icon /></span>
      <div className="proc__tile-body">
        <div className="proc__tile-title">{title}</div>
        <div className="proc__tile-stat">{stat}</div>
        <div className="proc__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="proc__tile-chev" />
    </Link>
  );
}
