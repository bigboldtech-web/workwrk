"use client";

/* Procurement · Invoices — AP queue.
 *
 * Banner: overdue total. Below: filter chips by status, then a dense
 * table grouped by due-date bucket (Overdue / Due this week / Later /
 * Paid). Each row: vendor, invoice #, PO link, amount, due chip,
 * status pill, quick "Mark paid" action.
 *
 * GET   /api/invoices
 * PATCH /api/invoices/[id]   { status, paidAt? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Receipt, AlertTriangle, CheckCircle2, ExternalLink, DollarSign } from "lucide-react";
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

type FilterKey = "all" | Status;

export default function InvoicesPage() {
  const [invs, setInvs] = useState<ApiInvoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvs(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const filtered = useMemo(() => {
    const list = invs ?? [];
    if (filter === "all") return list;
    return list.filter((i) => i.status === filter);
  }, [invs, filter]);

  const grouped = useMemo(() => {
    const m = new Map<Bucket, ApiInvoice[]>();
    for (const b of ["overdue", "thisWeek", "later", "paid"] as Bucket[]) m.set(b, []);
    for (const i of filtered) m.get(bucketFor(i))?.push(i);
    return m;
  }, [filtered]);

  async function markPaid(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", paidAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast("Marked paid");
      void load();
    } catch { toast("Couldn't update"); }
    setBusyId(null);
  }

  const overdueValue = (grouped.get("overdue") ?? []).reduce((a, i) => a + num(i.amount), 0);
  const thisWeekValue = (grouped.get("thisWeek") ?? []).reduce((a, i) => a + num(i.amount), 0);
  const totalUnpaid = (invs ?? []).filter((i) => i.status !== "PAID" && i.status !== "REJECTED").length;

  return (
    <div className="inv">
      <header className="inv__head">
        <div className="inv__head-l">
          <div className="inv__icon"><Receipt /></div>
          <div>
            <h1 className="inv__title">Vendor invoices</h1>
            <div className="inv__sub">
              {invs === null ? "Loading…" : `${totalUnpaid} unpaid · ${money(overdueValue)} overdue · ${money(thisWeekValue)} due this week`}
            </div>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="inv__error">{loadError}</div>
      ) : invs === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {overdueValue > 0 && (
            <div className="inv__banner">
              <AlertTriangle />
              <span>You have <strong>{money(overdueValue)}</strong> in overdue invoices. Address them first.</span>
            </div>
          )}

          <nav className="inv__filters">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <em>{invs.length}</em></button>
            {(["PENDING", "APPROVED", "PAID", "REJECTED"] as Status[]).map((s) => (
              <button key={s} type="button" className={filter === s ? "is-active" : ""} onClick={() => setFilter(s)}>
                <span className="inv__filter-dot" style={{ background: STATUS_HUE[s] }} />
                {STATUS_LABEL[s]} <em>{invs.filter((i) => i.status === s).length}</em>
              </button>
            ))}
          </nav>

          <div className="inv__sections">
            {(["overdue", "thisWeek", "later", "paid"] as Bucket[]).map((b) => {
              const items = grouped.get(b) ?? [];
              if (items.length === 0) return null;
              return (
                <section key={b} className="inv__section">
                  <header style={{ borderLeft: `4px solid ${BUCKET_HUE[b]}` }}>
                    <h2>{BUCKET_LABEL[b]}</h2>
                    <span>{items.length} · {money(items.reduce((a, i) => a + num(i.amount), 0))}</span>
                  </header>
                  <div className="inv__list">
                    {items.map((i) => {
                      const due = new Date(i.dueDate);
                      const daysOverdue = Math.floor((Date.now() - due.getTime()) / MS_DAY);
                      return (
                        <article key={i.id} className="inv-row">
                          <div className="inv-row__vendor">
                            <div className="inv-row__vendor-name">{i.vendor?.name ?? "—"}</div>
                            <div className="inv-row__num">#{i.invoiceNumber}</div>
                          </div>
                          {i.purchaseOrder ? (
                            <Link href={`/procurement/pos`} className="inv-row__po">
                              <ExternalLink /> PO #{i.purchaseOrder.number}
                            </Link>
                          ) : (
                            <span className="inv-row__po inv-row__po--none">no PO</span>
                          )}
                          <span className="inv-row__amount">{money(num(i.amount), i.currency)}</span>
                          <span className={`inv-row__due ${b === "overdue" ? "is-late" : b === "thisWeek" ? "is-soon" : ""}`}>
                            {b === "overdue" ? `${daysOverdue}d late` : `Due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                          </span>
                          <span className="inv-row__status" style={{ background: STATUS_HUE[i.status] }}>{STATUS_LABEL[i.status]}</span>
                          {i.status !== "PAID" && i.status !== "REJECTED" && (
                            <button type="button" className="inv-row__pay" disabled={busyId === i.id} onClick={() => markPaid(i.id)}>
                              <DollarSign /> Pay
                            </button>
                          )}
                          {i.status === "PAID" && i.paidAt && (
                            <span className="inv-row__paid"><CheckCircle2 /> {new Date(i.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
