"use client";

/* Purchase Order detail — bespoke .pod layout.
 *
 *  GET   /api/purchase-orders/[id]
 *  PATCH /api/purchase-orders/[id]  { action: submit|retract|approve|reject|send|receive|close }
 *  PATCH /api/purchase-orders/[id]  { description?, notes? } (DRAFT-only)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ShoppingCart, Calendar as CalendarIcon, ChevronLeft, Building2, User as UserIcon,
  Hash, FileText, Truck, PackageCheck, CheckCircle2, XCircle, Send, Activity, Clock,
  AlertTriangle, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type PoStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SENT" | "RECEIVED" | "CLOSED";

type PO = {
  id: string;
  number: string;
  description: string;
  amount: number;
  currency: string;
  status: PoStatus;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  vendor?: { id: string; name: string } | null;
  requester?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  createdAt?: string;
  submittedAt?: string | null;
  decisionAt?: string | null;
  sentAt?: string | null;
  receivedAt?: string | null;
  closedAt?: string | null;
};

const STATUS_LABEL: Record<PoStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", SENT: "Sent", RECEIVED: "Received", CLOSED: "Closed",
};
const STATUS_COLOR: Record<PoStatus, string> = {
  DRAFT: "var(--os-c-indigo)", SUBMITTED: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", REJECTED: "var(--os-c-red)",
  SENT: "var(--os-c-purple)", RECEIVED: "var(--os-c-teal)",
  CLOSED: "var(--os-c-green)",
};
const STATUS_ICON: Record<PoStatus, typeof Clock> = {
  DRAFT: FileText, SUBMITTED: Clock, APPROVED: CheckCircle2,
  REJECTED: XCircle, SENT: Truck, RECEIVED: PackageCheck, CLOSED: CheckCircle2,
};

type Action = "submit" | "retract" | "approve" | "reject" | "send" | "receive" | "close";

const NEXT_ACTIONS: Record<PoStatus, { action: Action; label: string; color: string; Icon: typeof Activity }[]> = {
  DRAFT:     [{ action: "submit",  label: "Submit",   color: "var(--os-c-orange)", Icon: Send }],
  SUBMITTED: [
    { action: "approve", label: "Approve",   color: "var(--os-c-blue)",   Icon: CheckCircle2 },
    { action: "reject",  label: "Reject",    color: "var(--os-c-red)",    Icon: XCircle },
    { action: "retract", label: "Retract",   color: "var(--os-ink-3)",    Icon: Activity },
  ],
  APPROVED:  [{ action: "send",    label: "Send to vendor", color: "var(--os-c-purple)", Icon: Truck }],
  SENT:      [{ action: "receive", label: "Mark received",  color: "var(--os-c-teal)",   Icon: PackageCheck }],
  RECEIVED:  [{ action: "close",   label: "Close PO",       color: "var(--os-c-green)",  Icon: CheckCircle2 }],
  REJECTED:  [{ action: "close",   label: "Archive",        color: "var(--os-ink-3)",    Icon: CheckCircle2 }],
  CLOSED:    [],
};

const FLOW_STEPS: { key: PoStatus; label: string }[] = [
  { key: "DRAFT", label: "Draft" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "APPROVED", label: "Approved" },
  { key: "SENT", label: "Sent" },
  { key: "RECEIVED", label: "Received" },
  { key: "CLOSED", label: "Closed" },
];

function flowState(current: PoStatus, step: PoStatus): "past" | "current" | "future" {
  if (current === "REJECTED") {
    return step === "DRAFT" || step === "SUBMITTED" ? "past" : "future";
  }
  const order = FLOW_STEPS.map((s) => s.key);
  const ci = order.indexOf(current);
  const si = order.indexOf(step);
  if (si < ci) return "past";
  if (si === ci) return "current";
  return "future";
}

function fullName(u?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!u) return null;
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
}

function fmtMoney(amount: number, currency: string): string {
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  return `${sym}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)}`;
}

export default function ProcurementDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { toast } = useOsToast();
  const [p, setP] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const po: PO = data.data ?? data;
      setP({ ...po, amount: typeof po.amount === "string" ? parseFloat(po.amount) : po.amount });
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function runAction(action: Action) {
    setBusy(action);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Not allowed" : "Couldn't update"); return; }
      toast("Updated");
      void load();
    } catch { toast("Couldn't update"); }
    finally { setBusy(null); }
  }

  const overdue = useMemo(() => {
    if (!p?.expectedDeliveryDate) return false;
    if (p.status === "CLOSED" || p.status === "RECEIVED" || p.status === "REJECTED") return false;
    return new Date(p.expectedDeliveryDate).getTime() < Date.now();
  }, [p]);

  if (loading) {
    return (<>
      <OsTitleBar title="Loading PO…" Icon={ShoppingCart} iconGradient={GRAD.brownOrange} showInvite={false} />
      <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
    </>);
  }
  if (notFound || !p) {
    return (<>
      <OsTitleBar title="PO not found" Icon={ShoppingCart} iconGradient={GRAD.redPink} showInvite={false} />
      <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.redPink} title="We couldn't find that purchase order" subtitle="It may have been deleted." cta="Back to Procurement" />
    </>);
  }

  const statusColor = STATUS_COLOR[p.status];
  const StatusIcon = STATUS_ICON[p.status];
  const actions = NEXT_ACTIONS[p.status];

  return (
    <div className="pod" style={{ ["--s-c" as unknown as string]: statusColor }}>
      <section className="pod__hero">
        <span className="pod__hero-accent" aria-hidden="true" />
        <Link href="/procurement/pos" className="pod__back"><ChevronLeft /> All POs</Link>
        <div className="pod__hero-main">
          <div className="pod__hero-l">
            <div className="pod__hero-meta">
              <span className="pod__hero-status"><StatusIcon /> {STATUS_LABEL[p.status]}</span>
              <span className="pod__hero-num">{p.number}</span>
              {p.vendor && <span className="pod__hero-vendor"><Building2 /> {p.vendor.name}</span>}
            </div>
            <h1 className="pod__hero-title">{p.description}</h1>
            {p.expectedDeliveryDate && (
              <div className={`pod__hero-delivery${overdue ? " is-overdue" : ""}`}>
                <CalendarIcon /> Expected {new Date(p.expectedDeliveryDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                {overdue && <span><AlertTriangle /> overdue</span>}
              </div>
            )}
          </div>
          <div className="pod__hero-r">
            <div className="pod__hero-amt">{fmtMoney(p.amount, p.currency)}</div>
            <div className="pod__hero-amt-sub">total commitment</div>
          </div>
        </div>

        <div className="pod__flow">
          {p.status === "REJECTED" ? (
            <>
              <FlowStep label="Draft" state="past" color={STATUS_COLOR.DRAFT} />
              <FlowStep label="Submitted" state="past" color={STATUS_COLOR.SUBMITTED} />
              <FlowStep label="Rejected" state="current" color={STATUS_COLOR.REJECTED} last />
            </>
          ) : (
            FLOW_STEPS.map((s, i) => (
              <FlowStep
                key={s.key}
                label={s.label}
                state={flowState(p.status, s.key)}
                color={STATUS_COLOR[s.key]}
                last={i === FLOW_STEPS.length - 1}
              />
            ))
          )}
        </div>

        {actions.length > 0 && (
          <div className="pod__actions">
            {actions.map(({ action, label, color, Icon }) => (
              <button
                key={action}
                type="button"
                className="pod__action"
                style={{ ["--a-c" as unknown as string]: color }}
                disabled={busy !== null}
                onClick={() => runAction(action)}
              >
                <Icon /> {busy === action ? "Working…" : label}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="pod__grid">
        <section className="pod__card">
          <header className="pod__card-head"><h2><Hash /> Details</h2></header>
          <div className="pod__card-body">
            <DetailRow label="PO #" value={<code className="pod__code">{p.number}</code>} />
            <DetailRow label="Vendor" value={p.vendor ? <Link href={`/procurement/vendors/${p.vendor.id}`} className="pod__link">{p.vendor.name} <ChevronRight /></Link> : <span className="pod__muted">—</span>} />
            <DetailRow label="Amount" value={<strong>{fmtMoney(p.amount, p.currency)}</strong>} />
            <DetailRow label="Currency" value={<span>{p.currency}</span>} />
            <DetailRow label="Delivery" value={p.expectedDeliveryDate ? <span>{new Date(p.expectedDeliveryDate).toLocaleDateString()}</span> : <span className="pod__muted">—</span>} />
          </div>
        </section>

        <section className="pod__card">
          <header className="pod__card-head"><h2><UserIcon /> People</h2></header>
          <div className="pod__card-body">
            <DetailRow label="Requester" value={fullName(p.requester) ? <span>{fullName(p.requester)}</span> : <span className="pod__muted">—</span>} />
            <DetailRow label="Approver" value={fullName(p.approver) ? <span>{fullName(p.approver)}</span> : <span className="pod__muted">unassigned</span>} />
          </div>
        </section>

        {p.notes && (
          <section className="pod__card pod__card--span">
            <header className="pod__card-head"><h2><FileText /> Notes</h2></header>
            <div className="pod__card-body">
              <p className="pod__notes">{p.notes}</p>
            </div>
          </section>
        )}

        <section className="pod__card pod__card--span">
          <header className="pod__card-head"><h2><Activity /> Timeline</h2></header>
          <div className="pod__card-body">
            <ul className="pod__timeline">
              {p.createdAt && (
                <li className="pod__tl" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.DRAFT }}>
                  <FileText /><div><strong>Created</strong><span>{new Date(p.createdAt).toLocaleString()}</span></div>
                </li>
              )}
              {p.submittedAt && (
                <li className="pod__tl" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.SUBMITTED }}>
                  <Send /><div><strong>Submitted</strong><span>{new Date(p.submittedAt).toLocaleString()}</span></div>
                </li>
              )}
              {p.decisionAt && p.status !== "SUBMITTED" && (
                <li className="pod__tl" style={{ ["--tl-c" as unknown as string]: p.status === "REJECTED" ? STATUS_COLOR.REJECTED : STATUS_COLOR.APPROVED }}>
                  {p.status === "REJECTED" ? <XCircle /> : <CheckCircle2 />}
                  <div><strong>{p.status === "REJECTED" ? "Rejected" : "Approved"}{fullName(p.approver) ? ` by ${fullName(p.approver)}` : ""}</strong><span>{new Date(p.decisionAt).toLocaleString()}</span></div>
                </li>
              )}
              {p.sentAt && (
                <li className="pod__tl" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.SENT }}>
                  <Truck /><div><strong>Sent to vendor</strong><span>{new Date(p.sentAt).toLocaleString()}</span></div>
                </li>
              )}
              {p.receivedAt && (
                <li className="pod__tl" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.RECEIVED }}>
                  <PackageCheck /><div><strong>Received</strong><span>{new Date(p.receivedAt).toLocaleString()}</span></div>
                </li>
              )}
              {p.closedAt && (
                <li className="pod__tl" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.CLOSED }}>
                  <CheckCircle2 /><div><strong>Closed</strong><span>{new Date(p.closedAt).toLocaleString()}</span></div>
                </li>
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="pod__detail-row">
      <span className="pod__detail-label">{label}</span>
      <span className="pod__detail-val">{value}</span>
    </div>
  );
}

function FlowStep({ label, state, color, last }: { label: string; state: "past" | "current" | "future"; color: string; last?: boolean }) {
  return (
    <div className={`pod__flow-step pod__flow-step--${state}${last ? " is-last" : ""}`} style={{ ["--st-c" as unknown as string]: color }}>
      <span className="pod__flow-dot" />
      <span className="pod__flow-label">{label}</span>
      {!last && <span className="pod__flow-line" />}
    </div>
  );
}
