"use client";

/* Procurement · Purchase Orders — approval queue + history.
 *
 * Two zones:
 *   Pending approval (top, prominent) — POs in SUBMITTED status with
 *   one-click Approve / Reject from the row.
 *   Active POs (below) grouped by status — Draft / Approved / Sent /
 *   Received / Rejected / Cancelled.
 *
 * GET   /api/purchase-orders
 * PATCH /api/purchase-orders/[id]   { status, decisionNote? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShoppingCart, Check, X, Plus, ChevronRight, Truck, FileText, Ban } from "lucide-react";
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
  DRAFT: "Draft", SUBMITTED: "Awaiting approval", APPROVED: "Approved",
  REJECTED: "Rejected", SENT: "Sent to vendor", RECEIVED: "Received", CANCELLED: "Cancelled", CLOSED: "Closed",
};
const STATUS_HUE: Record<Status, string> = {
  DRAFT: "var(--os-c-indigo)", SUBMITTED: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", REJECTED: "var(--os-c-red)",
  SENT: "var(--os-c-purple)", RECEIVED: "var(--os-c-green)",
  CANCELLED: "var(--os-c-darkgray)", CLOSED: "var(--os-c-darkgray)",
};
const ACTIVE_ORDER: Status[] = ["DRAFT", "APPROVED", "SENT", "RECEIVED"];

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}
function money(n: number, ccy = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n); }
  catch { return `${ccy} ${n.toFixed(0)}`; }
}

const MS_DAY = 86_400_000;

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<ApiPO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/purchase-orders?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPos(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision === "approve" ? "APPROVED" : "REJECTED" }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(decision === "approve" ? "PO approved" : "PO rejected");
      void load();
    } catch { toast("Couldn't update PO"); }
    setBusyId(null);
  }

  const pending = useMemo(() => (pos ?? []).filter((p) => p.status === "SUBMITTED").sort((a, b) => new Date(b.submittedAt ?? b.createdAt).getTime() - new Date(a.submittedAt ?? a.createdAt).getTime()), [pos]);
  const activeGrouped = useMemo(() => {
    const m = new Map<Status, ApiPO[]>();
    for (const s of ACTIVE_ORDER) m.set(s, []);
    for (const p of pos ?? []) {
      if (p.status === "SUBMITTED" || p.status === "REJECTED" || p.status === "CANCELLED" || p.status === "CLOSED") continue;
      m.get(p.status)?.push(p);
    }
    return m;
  }, [pos]);
  const rejected = (pos ?? []).filter((p) => p.status === "REJECTED");
  const cancelled = (pos ?? []).filter((p) => p.status === "CANCELLED" || p.status === "CLOSED");

  const pendingValue = pending.reduce((a, p) => a + num(p.amount), 0);
  const totalOpen = (pos ?? []).filter((p) => p.status === "APPROVED" || p.status === "SENT").length;

  return (
    <div className="pos">
      <header className="pos__head">
        <div className="pos__head-l">
          <div className="pos__icon"><ShoppingCart /></div>
          <div>
            <h1 className="pos__title">Purchase orders</h1>
            <div className="pos__sub">
              {pos === null ? "Loading…" : `${pending.length} awaiting approval · ${totalOpen} open · ${money(pendingValue)} in pending value`}
            </div>
          </div>
        </div>
        <button type="button" className="pos__new"><Plus /> New PO</button>
      </header>

      {loadError ? (
        <div className="pos__error">{loadError}</div>
      ) : pos === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="pos__section pos__section--alert">
              <header><h2>Awaiting your approval</h2><span>{pending.length}</span></header>
              <div className="pos__pending-list">
                {pending.map((p) => (
                  <article key={p.id} className="po-pending">
                    <header>
                      <span className="po-pending__num">PO #{p.number}</span>
                      <span className="po-pending__amount">{money(num(p.amount), p.currency)}</span>
                    </header>
                    <div className="po-pending__desc">{p.description}</div>
                    <div className="po-pending__meta">
                      <span>Vendor: <strong>{p.vendor?.name ?? "—"}</strong></span>
                      <span>Requester: {[p.requester?.firstName, p.requester?.lastName].filter(Boolean).join(" ") || "—"}</span>
                      {p.expectedDeliveryDate && (
                        <span>Expected: {new Date(p.expectedDeliveryDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      )}
                    </div>
                    <footer>
                      <button type="button" className="po-pending__btn po-pending__btn--approve" disabled={busyId === p.id} onClick={() => decide(p.id, "approve")}>
                        <Check /> Approve
                      </button>
                      <button type="button" className="po-pending__btn po-pending__btn--reject" disabled={busyId === p.id} onClick={() => decide(p.id, "reject")}>
                        <X /> Reject
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="pos__section">
            <header><h2>Active POs</h2><span>{totalOpen}</span></header>
            <div className="pos__columns">
              {ACTIVE_ORDER.map((s) => {
                const items = activeGrouped.get(s) ?? [];
                return (
                  <div key={s} className="pos__column" style={{ ["--col-hue" as string]: STATUS_HUE[s] }}>
                    <header>
                      <span className="pos__column-dot" />
                      <h3>{STATUS_LABEL[s]}</h3>
                      <span className="pos__column-count">{items.length}</span>
                    </header>
                    {items.length === 0 ? (
                      <div className="pos__column-empty">—</div>
                    ) : items.slice(0, 10).map((p) => (
                      <article key={p.id} className="po-row">
                        <div className="po-row__num">#{p.number}</div>
                        <div className="po-row__main">
                          <div className="po-row__desc">{p.description.length > 60 ? p.description.slice(0, 60) + "…" : p.description}</div>
                          <div className="po-row__vendor">{p.vendor?.name ?? "—"}</div>
                        </div>
                        <div className="po-row__amt">{money(num(p.amount), p.currency)}</div>
                      </article>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          {(rejected.length + cancelled.length) > 0 && (
            <details className="pos__archive">
              <summary>Rejected / cancelled · {rejected.length + cancelled.length}</summary>
              <div className="pos__archive-list">
                {[...rejected, ...cancelled].slice(0, 12).map((p) => (
                  <div key={p.id} className="po-archived">
                    {p.status === "REJECTED" ? <X /> : <Ban />}
                    <span>#{p.number}</span>
                    <span className="po-archived__desc">{p.description}</span>
                    <span>{money(num(p.amount), p.currency)}</span>
                    <span style={{ color: STATUS_HUE[p.status] }}>{STATUS_LABEL[p.status]}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
