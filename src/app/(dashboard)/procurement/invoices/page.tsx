"use client";

/* Procurement · Invoices — AP queue with KPI strip + due-date buckets.
 *
 * GET   /api/invoices
 * PATCH /api/invoices/[id]   { status, paidAt? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Receipt, AlertTriangle, CheckCircle2, ExternalLink, DollarSign, Search,
  Building2, ShoppingCart, Hash, Clock, FileText, XCircle, Banknote, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "PENDING" | "APPROVED" | "REJECTED" | "PAID";
type ApiInvoice = {
  id: string; invoiceNumber: string;
  amount: number | string; currency: string;
  issueDate: string; dueDate: string;
  status: Status; paidAt?: string | null;
  vendor?: { id: string; name: string } | null;
  purchaseOrder?: { id: string; number: string } | null;
};

const STATUS_LABEL: Record<Status, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", PAID: "Paid" };
const STATUS_HUE: Record<Status, string> = {
  PENDING: "var(--os-c-orange)", APPROVED: "var(--os-c-blue)",
  REJECTED: "var(--os-c-red)", PAID: "var(--os-c-green)",
};
const STATUS_ICON: Record<Status, typeof Clock> = {
  PENDING: Clock, APPROVED: CheckCircle2, REJECTED: XCircle, PAID: Banknote,
};

function num(v?: number | string | null): number { if (v == null) return 0; return typeof v === "string" ? parseFloat(v) : v; }
function money(n: number, ccy = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n); }
  catch { return `${ccy} ${n.toFixed(0)}`; }
}

const MS_DAY = 86_400_000;
type Bucket = "overdue" | "thisWeek" | "later" | "paid";
function bucketFor(inv: ApiInvoice): Bucket {
  if (inv.status === "PAID") return "paid";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(inv.dueDate); due.setHours(0, 0, 0, 0);
  const diff = (due.getTime() - today.getTime()) / MS_DAY;
  if (diff < 0) return "overdue";
  if (diff <= 7) return "thisWeek";
  return "later";
}
const BUCKET_LABEL: Record<Bucket, string> = { overdue: "Overdue", thisWeek: "Due this week", later: "Later", paid: "Paid" };
const BUCKET_HUE: Record<Bucket, string> = { overdue: "var(--os-c-red)", thisWeek: "var(--os-c-orange)", later: "var(--os-c-indigo)", paid: "var(--os-c-green)" };
const BUCKET_ICON: Record<Bucket, typeof Clock> = { overdue: AlertTriangle, thisWeek: Clock, later: FileText, paid: CheckCircle2 };

type FilterKey = "all" | Status;

export default function InvoicesPage() {
  const [invs, setInvs] = useState<ApiInvoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvs(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function markPaid(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", paidAt: new Date().toISOString() }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Not allowed" : "Couldn't update"); return; }
      toast("Marked paid");
      void load();
    } catch { toast("Couldn't update"); }
    setBusyId(null);
  }

  const stats = useMemo(() => {
    const list = invs ?? [];
    const overdue = list.filter((i) => i.status !== "PAID" && bucketFor(i) === "overdue");
    const thisWeek = list.filter((i) => i.status !== "PAID" && bucketFor(i) === "thisWeek");
    const unpaid = list.filter((i) => i.status !== "PAID" && i.status !== "REJECTED");
    const paid = list.filter((i) => i.status === "PAID");
    return {
      total: list.length,
      unpaid: unpaid.length,
      overdue: overdue.length,
      thisWeek: thisWeek.length,
      paid: paid.length,
      overdueValue: overdue.reduce((a, i) => a + num(i.amount), 0),
      thisWeekValue: thisWeek.reduce((a, i) => a + num(i.amount), 0),
      unpaidValue: unpaid.reduce((a, i) => a + num(i.amount), 0),
      paidValue: paid.reduce((a, i) => a + num(i.amount), 0),
      cur: list[0]?.currency ?? "USD",
    };
  }, [invs]);

  const filtered = useMemo(() => {
    let list = invs ?? [];
    if (filter !== "all") list = list.filter((i) => i.status === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) =>
      i.invoiceNumber.toLowerCase().includes(q) ||
      (i.vendor?.name ?? "").toLowerCase().includes(q) ||
      (i.purchaseOrder?.number ?? "").toLowerCase().includes(q));
    return list;
  }, [invs, filter, search]);

  const grouped = useMemo(() => {
    const m = new Map<Bucket, ApiInvoice[]>();
    for (const b of ["overdue", "thisWeek", "later", "paid"] as Bucket[]) m.set(b, []);
    for (const i of filtered) m.get(bucketFor(i))?.push(i);
    return m;
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Vendor invoices"
        Icon={Receipt}
        iconGradient={GRAD.orangePink}
        description={invs === null ? "Loading…" : `${stats.unpaid} unpaid · ${money(stats.overdueValue, stats.cur)} overdue · ${money(stats.thisWeekValue, stats.cur)} due this week`}
        actions={
          <div className="inv__head-actions">
            <Link href="/procurement" className="inv__nav-link"><Hash /> Procurement</Link>
            <Link href="/procurement/pos" className="inv__nav-link"><ShoppingCart /> POs</Link>
            <Link href="/procurement/vendors" className="inv__nav-link"><Building2 /> Vendors</Link>
          </div>
        }
      />

      <div className="inv">
        <div className="inv__kpis">
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Overdue"       value={`${stats.overdue}`}  sub={money(stats.overdueValue, stats.cur)} />
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}         label="Due this week" value={`${stats.thisWeek}`} sub={money(stats.thisWeekValue, stats.cur)} />
          <KpiTile accent="var(--os-c-indigo)" Icon={FileText}      label="Total unpaid"  value={`${stats.unpaid}`}   sub={money(stats.unpaidValue, stats.cur)} />
          <KpiTile accent="var(--os-c-green)"  Icon={Banknote}      label="Paid YTD"      value={`${stats.paid}`}     sub={money(stats.paidValue, stats.cur)} />
        </div>

        {stats.overdueValue > 0 && (
          <div className="inv__banner">
            <AlertTriangle />
            <span>
              You have <strong>{money(stats.overdueValue, stats.cur)}</strong> across <strong>{stats.overdue} overdue invoice{stats.overdue === 1 ? "" : "s"}</strong>. Address them first.
            </span>
          </div>
        )}

        <div className="inv__toolbar">
          <div className="inv__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice #, vendor, PO…" />
          </div>
          <div className="inv__filters">
            <button type="button" className={`inv__filter${filter === "all" ? " is-active" : ""}`} onClick={() => setFilter("all")}>
              <Hash /> All <span>{(invs ?? []).length}</span>
            </button>
            {(["PENDING", "APPROVED", "PAID", "REJECTED"] as Status[]).map((s) => {
              const Icon = STATUS_ICON[s];
              return (
                <button
                  key={s}
                  type="button"
                  className={`inv__filter${filter === s ? " is-active" : ""}`}
                  style={{ ["--f-c" as unknown as string]: STATUS_HUE[s] }}
                  onClick={() => setFilter(s)}
                >
                  <Icon /> {STATUS_LABEL[s]}
                  <span>{(invs ?? []).filter((i) => i.status === s).length}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Receipt} iconGradient={GRAD.redPink} title="Couldn't load invoices" subtitle={loadError} cta="Retry" />
        ) : invs === null ? (
          <div className="inv__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Receipt}
            iconGradient={GRAD.orangePink}
            title="No vendor invoices yet"
            subtitle="Invoices appear here once a vendor sends one against an open PO."
            chips={["Pending", "Approved", "Paid"]}
          />
        ) : filtered.length === 0 ? (
          <div className="inv__no-match"><Search /> No invoices match the current filter.</div>
        ) : (
          <div className="inv__sections">
            {(["overdue", "thisWeek", "later", "paid"] as Bucket[]).map((b) => {
              const items = grouped.get(b) ?? [];
              if (items.length === 0) return null;
              const Icon = BUCKET_ICON[b];
              const total = items.reduce((a, i) => a + num(i.amount), 0);
              return (
                <section key={b} className="inv__section" style={{ ["--b-c" as unknown as string]: BUCKET_HUE[b] }}>
                  <header className="inv__section-head">
                    <span className="inv__section-tag"><Icon /> {BUCKET_LABEL[b]}</span>
                    <span className="inv__section-count">{items.length}</span>
                    <span className="inv__section-line" />
                    <span className="inv__section-total">{money(total, items[0]?.currency ?? stats.cur)}</span>
                  </header>
                  <div className="inv__list">
                    {items.map((i) => {
                      const due = new Date(i.dueDate);
                      const daysOverdue = Math.floor((Date.now() - due.getTime()) / MS_DAY);
                      const Icon = STATUS_ICON[i.status];
                      return (
                        <article key={i.id} className="inv__row" style={{ ["--s-c" as unknown as string]: STATUS_HUE[i.status] }}>
                          <div className="inv__row-vendor">
                            <div className="inv__row-vname">{i.vendor?.name ?? "—"}</div>
                            <div className="inv__row-num">#{i.invoiceNumber}</div>
                          </div>
                          {i.purchaseOrder ? (
                            <Link href={`/procurement/pos`} className="inv__row-po">
                              <ExternalLink /> PO #{i.purchaseOrder.number}
                            </Link>
                          ) : (
                            <span className="inv__row-po inv__row-po--none">no PO</span>
                          )}
                          <span className="inv__row-amt">{money(num(i.amount), i.currency)}</span>
                          <span className={`inv__row-due ${b === "overdue" ? "is-late" : b === "thisWeek" ? "is-soon" : ""}`}>
                            {b === "overdue" ? `${daysOverdue}d late` : b === "paid" ? "—" : `Due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                          </span>
                          <span className="inv__row-status"><Icon /> {STATUS_LABEL[i.status]}</span>
                          {i.status !== "PAID" && i.status !== "REJECTED" ? (
                            <button type="button" className="inv__row-pay" disabled={busyId === i.id} onClick={() => markPaid(i.id)}>
                              <DollarSign /> {busyId === i.id ? "…" : "Pay"}
                            </button>
                          ) : i.status === "PAID" && i.paidAt ? (
                            <span className="inv__row-paid"><CheckCircle2 /> {new Date(i.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          ) : (
                            <span className="inv__row-paid">—</span>
                          )}
                          <ChevronRight className="inv__row-arrow" />
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
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Receipt; label: string; value: string; sub: string }) {
  return (
    <div className="inv__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="inv__kpi-accent" aria-hidden="true" />
      <div className="inv__kpi-row">
        <div className="inv__kpi-icon"><Icon /></div>
        <div className="inv__kpi-label">{label}</div>
      </div>
      <div className="inv__kpi-value">{value}</div>
      <div className="inv__kpi-sub">{sub}</div>
    </div>
  );
}
