"use client";

/* Procurement · Purchase Orders — approval queue + pipeline columns.
 *
 * GET   /api/purchase-orders
 * PATCH /api/purchase-orders/[id]   { action: submit|approve|reject|send|receive|close }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ShoppingCart, Check, X, Plus, Truck, FileText, Ban, Building2, Search,
  Clock, CheckCircle2, PackageCheck, AlertTriangle, Hash, Activity, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SENT" | "RECEIVED" | "CANCELLED" | "CLOSED";
type ApiPO = {
  id: string; number: string; description: string;
  amount: number | string; currency: string;
  status: Status; expectedDeliveryDate?: string | null;
  submittedAt?: string | null; receivedAt?: string | null;
  vendor?: { id: string; name: string } | null;
  requester?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  createdAt: string;
  _count?: { invoices?: number };
};

const STATUS_LABEL: Record<Status, string> = {
  DRAFT: "Draft", SUBMITTED: "Awaiting", APPROVED: "Approved",
  REJECTED: "Rejected", SENT: "Sent", RECEIVED: "Received",
  CANCELLED: "Cancelled", CLOSED: "Closed",
};
const STATUS_HUE: Record<Status, string> = {
  DRAFT: "var(--os-c-indigo)", SUBMITTED: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", REJECTED: "var(--os-c-red)",
  SENT: "var(--os-c-purple)", RECEIVED: "var(--os-c-teal)",
  CANCELLED: "var(--os-ink-3)", CLOSED: "var(--os-c-green)",
};
const STATUS_ICON: Record<Status, typeof Clock> = {
  DRAFT: FileText, SUBMITTED: Clock, APPROVED: CheckCircle2,
  REJECTED: X, SENT: Truck, RECEIVED: PackageCheck,
  CANCELLED: Ban, CLOSED: CheckCircle2,
};
const PIPELINE_ORDER: Status[] = ["DRAFT", "APPROVED", "SENT", "RECEIVED", "CLOSED"];

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}
function money(n: number, ccy = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n); }
  catch { return `${ccy} ${n.toFixed(0)}`; }
}

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<ApiPO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeVendor, setActiveVendor] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/purchase-orders?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPos(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Not allowed" : "Couldn't update"); return; }
      toast(action === "approve" ? "PO approved" : "PO rejected");
      void load();
    } catch { toast("Couldn't update"); }
    setBusyId(null);
  }

  const stats = useMemo(() => {
    const list = pos ?? [];
    const pendingValue = list.filter((p) => p.status === "SUBMITTED").reduce((a, p) => a + num(p.amount), 0);
    const openValue = list.filter((p) => p.status === "APPROVED" || p.status === "SENT").reduce((a, p) => a + num(p.amount), 0);
    const overdue = list.filter((p) => p.expectedDeliveryDate && (p.status === "APPROVED" || p.status === "SENT") && new Date(p.expectedDeliveryDate).getTime() < Date.now()).length;
    return {
      total: list.length,
      pending: list.filter((p) => p.status === "SUBMITTED").length,
      open: list.filter((p) => p.status === "APPROVED" || p.status === "SENT").length,
      closed: list.filter((p) => p.status === "CLOSED" || p.status === "RECEIVED").length,
      pendingValue, openValue, overdue,
      cur: list[0]?.currency ?? "USD",
    };
  }, [pos]);

  const vendors = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const p of pos ?? []) {
      if (!p.vendor) continue;
      const cur = m.get(p.vendor.id);
      if (cur) cur.count += 1;
      else m.set(p.vendor.id, { id: p.vendor.id, name: p.vendor.name, count: 1 });
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 12);
  }, [pos]);

  const filtered = useMemo(() => {
    let list = pos ?? [];
    if (activeVendor) list = list.filter((p) => p.vendor?.id === activeVendor);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.number.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.vendor?.name ?? "").toLowerCase().includes(q));
    return list;
  }, [pos, search, activeVendor]);

  const pending = useMemo(() =>
    filtered.filter((p) => p.status === "SUBMITTED")
      .sort((a, b) => new Date(b.submittedAt ?? b.createdAt).getTime() - new Date(a.submittedAt ?? a.createdAt).getTime()),
    [filtered]);

  const pipeline = useMemo(() => {
    const m = new Map<Status, ApiPO[]>();
    for (const s of PIPELINE_ORDER) m.set(s, []);
    for (const p of filtered) {
      if (p.status === "SUBMITTED" || p.status === "REJECTED" || p.status === "CANCELLED") continue;
      m.get(p.status)?.push(p);
    }
    return m;
  }, [filtered]);

  const archived = filtered.filter((p) => p.status === "REJECTED" || p.status === "CANCELLED");

  return (
    <>
      <OsTitleBar
        title="Purchase orders"
        Icon={ShoppingCart}
        iconGradient={GRAD.brownOrange}
        description={pos === null ? "Loading…" : `${stats.total} PO${stats.total === 1 ? "" : "s"} · ${stats.pending} awaiting · ${stats.open} open · ${money(stats.openValue, stats.cur)} committed`}
        actions={
          <div className="pos__head-actions">
            <Link href="/procurement" className="pos__nav-link"><Hash /> Procurement</Link>
            <Link href="/procurement/vendors" className="pos__nav-link"><Building2 /> Vendors</Link>
            <Link href="/procurement/invoices" className="pos__nav-link"><FileText /> Invoices</Link>
            <button type="button" className="pos__btn-primary" onClick={() => toast("Pick a vendor in Vendors to start a PO")}>
              <Plus /> New PO
            </button>
          </div>
        }
      />

      <div className="pos">
        <div className="pos__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}        label="Awaiting approval" value={`${stats.pending}`} sub={money(stats.pendingValue, stats.cur)} />
          <KpiTile accent="var(--os-c-blue)"   Icon={CheckCircle2} label="Open commitments"  value={`${stats.open}`}    sub={money(stats.openValue, stats.cur)} />
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Overdue delivery"  value={`${stats.overdue}`} sub="past expected date" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Closed"            value={`${stats.closed}`}  sub={`${stats.total} total`} />
        </div>

        <div className="pos__toolbar">
          <div className="pos__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO #, description, vendor…" />
          </div>
          {(search.trim() || activeVendor) && (
            <button type="button" className="pos__clear" onClick={() => { setSearch(""); setActiveVendor(null); }}>Clear</button>
          )}
        </div>

        {vendors.length > 0 && (
          <div className="pos__vendors">
            <button type="button" className={`pos__vendor${activeVendor === null ? " is-active" : ""}`} onClick={() => setActiveVendor(null)}>
              <Hash /> All vendors
            </button>
            {vendors.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`pos__vendor${activeVendor === v.id ? " is-active" : ""}`}
                onClick={() => setActiveVendor(activeVendor === v.id ? null : v.id)}
              >
                {v.name}
                <span>{v.count}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.redPink} title="Couldn't load POs" subtitle={loadError} cta="Retry" />
        ) : pos === null ? (
          <div className="pos__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={ShoppingCart}
            iconGradient={GRAD.brownOrange}
            title="No purchase orders yet"
            subtitle="Pick a vendor in Vendors to start a PO. The system routes it to your approval chain."
            chips={["Draft", "Approved", "Sent", "Received"]}
            cta="Browse vendors"
          />
        ) : (
          <>
            {pending.length > 0 && (
              <section className="pos__pending">
                <header className="pos__pending-head">
                  <span className="pos__pending-tag"><Clock /> Awaiting your approval</span>
                  <span className="pos__pending-count">{pending.length}</span>
                  <span className="pos__pending-line" />
                  <span className="pos__pending-total">{money(pending.reduce((a, p) => a + num(p.amount), 0), pending[0]?.currency ?? stats.cur)}</span>
                </header>
                <div className="pos__pending-list">
                  {pending.map((p) => (
                    <article key={p.id} className="pos__pcard">
                      <header className="pos__pcard-head">
                        <span className="pos__pcard-num">#{p.number}</span>
                        <span className="pos__pcard-amt">{money(num(p.amount), p.currency)}</span>
                      </header>
                      <Link href={`/procurement/${p.id}`} className="pos__pcard-title">{p.description}</Link>
                      <div className="pos__pcard-meta">
                        {p.vendor && <span><Building2 /> {p.vendor.name}</span>}
                        {p.requester && <span>{[p.requester.firstName, p.requester.lastName].filter(Boolean).join(" ")}</span>}
                        {p.expectedDeliveryDate && <span>due {new Date(p.expectedDeliveryDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                      </div>
                      <footer className="pos__pcard-actions">
                        <button type="button" className="pos__pcard-btn pos__pcard-btn--approve" disabled={busyId === p.id} onClick={() => decide(p.id, "approve")}>
                          <Check /> Approve
                        </button>
                        <button type="button" className="pos__pcard-btn pos__pcard-btn--reject" disabled={busyId === p.id} onClick={() => decide(p.id, "reject")}>
                          <X /> Reject
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="pos__pipeline">
              <header className="pos__pipeline-head">
                <h2><Activity /> Pipeline</h2>
                <span className="pos__pipeline-line" />
              </header>
              <div className="pos__columns">
                {PIPELINE_ORDER.map((s) => {
                  const items = pipeline.get(s) ?? [];
                  const Icon = STATUS_ICON[s];
                  return (
                    <div key={s} className="pos__column" style={{ ["--col-c" as unknown as string]: STATUS_HUE[s] }}>
                      <header className="pos__column-head">
                        <span className="pos__column-icon"><Icon /></span>
                        <h3>{STATUS_LABEL[s]}</h3>
                        <span className="pos__column-count">{items.length}</span>
                      </header>
                      {items.length === 0 ? (
                        <div className="pos__column-empty">—</div>
                      ) : items.slice(0, 12).map((p) => (
                        <Link key={p.id} href={`/procurement/${p.id}`} className="pos__porow">
                          <div className="pos__porow-num">#{p.number}</div>
                          <div className="pos__porow-main">
                            <div className="pos__porow-desc">{p.description}</div>
                            {p.vendor && <div className="pos__porow-vendor">{p.vendor.name}</div>}
                          </div>
                          <div className="pos__porow-amt">{money(num(p.amount), p.currency)}</div>
                          <ChevronRight className="pos__porow-arrow" />
                        </Link>
                      ))}
                      {items.length > 12 && <div className="pos__column-more">+{items.length - 12} more</div>}
                    </div>
                  );
                })}
              </div>
            </section>

            {archived.length > 0 && (
              <details className="pos__archive">
                <summary>Rejected / cancelled · {archived.length}</summary>
                <div className="pos__archive-list">
                  {archived.slice(0, 24).map((p) => {
                    const Icon = STATUS_ICON[p.status];
                    return (
                      <Link key={p.id} href={`/procurement/${p.id}`} className="pos__archived">
                        <Icon />
                        <span className="pos__archived-num">#{p.number}</span>
                        <span className="pos__archived-desc">{p.description}</span>
                        <span className="pos__archived-amt">{money(num(p.amount), p.currency)}</span>
                        <span className="pos__archived-status" style={{ color: STATUS_HUE[p.status] }}>{STATUS_LABEL[p.status]}</span>
                      </Link>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Clock; label: string; value: string; sub: string }) {
  return (
    <div className="pos__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="pos__kpi-accent" aria-hidden="true" />
      <div className="pos__kpi-row">
        <div className="pos__kpi-icon"><Icon /></div>
        <div className="pos__kpi-label">{label}</div>
      </div>
      <div className="pos__kpi-value">{value}</div>
      <div className="pos__kpi-sub">{sub}</div>
    </div>
  );
}

