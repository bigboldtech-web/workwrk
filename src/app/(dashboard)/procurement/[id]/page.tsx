"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ShoppingCart, Calendar as CalendarIcon } from "lucide-react";
import { OsItemDetail } from "@/components/layout/os/item-detail";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { useOsToast } from "@/components/layout/os/toast";
import { C, GRAD } from "@/components/layout/os/catalog";
import type { PickerOption } from "@/components/layout/os/picker-popover";

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
};

const STATUS_LABELS: Record<PoStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", SENT: "Sent", RECEIVED: "Received", CLOSED: "Closed",
};
const STATUS_COLORS: Record<PoStatus, string> = {
  DRAFT: C.indigo, SUBMITTED: C.yellow, APPROVED: C.blue,
  REJECTED: C.red, SENT: C.orange, RECEIVED: C.purple, CLOSED: C.green,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as PoStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

function actionFor(from: PoStatus, to: PoStatus): string | null {
  if (from === to) return null;
  if (from === "DRAFT"     && to === "SUBMITTED") return "submit";
  if (from === "SUBMITTED" && to === "DRAFT")     return "retract";
  if (from === "SUBMITTED" && to === "APPROVED")  return "approve";
  if (from === "SUBMITTED" && to === "REJECTED")  return "reject";
  if (from === "APPROVED"  && to === "SENT")      return "send";
  if (from === "SENT"      && to === "RECEIVED")  return "receive";
  if (from === "RECEIVED"  && to === "CLOSED")    return "close";
  if (from === "REJECTED"  && to === "CLOSED")    return "close";
  return null;
}

function fullName(u?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!u) return "—";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unknown";
}

export default function ProcurementDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { toast } = useOsToast();
  const [p, setP] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const po: PO = data.data ?? data;
      // Amount comes back as a Decimal-as-string in some shapes
      setP({ ...po, amount: typeof po.amount === "string" ? parseFloat(po.amount) : po.amount });
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function transition(to: PoStatus): Promise<boolean> {
    if (!p) return false;
    const action = actionFor(p.status, to);
    if (!action) {
      toast(`Can't go from ${STATUS_LABELS[p.status]} → ${STATUS_LABELS[to]}`);
      return false;
    }
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  async function patchField(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only DRAFT POs can be edited");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  if (loading) return (<>
    <OsTitleBar title="Loading PO…" Icon={ShoppingCart} iconGradient={GRAD.brownOrange} showActions={false} />
    <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
  </>);
  if (notFound || !p) return (<>
    <OsTitleBar title="PO not found" Icon={ShoppingCart} iconGradient={GRAD.redPink} showActions={false} />
    <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.redPink} title="We couldn't find that purchase order" subtitle="It may have been deleted." cta="Back to Procurement" />
  </>);

  return (
    <OsItemDetail
      backHref="/procurement" backLabel="Procurement"
      Icon={ShoppingCart} iconGradient={GRAD.brownOrange}
      moduleId="procurement" itemId={p.id} title={p.description}
      onRenameSave={(v) => patchField({ description: v })}
      status={{ label: STATUS_LABELS[p.status], color: STATUS_COLORS[p.status] }}
      statusOptions={STATUS_OPTIONS}
      activeStatusValue={p.status}
      onStatusPick={(v) => transition(v as PoStatus)}
      description={p.notes}
      fields={[
        { label: "PO #", value: <span style={{ fontWeight: 700, fontFamily: "var(--os-font)" }}>{p.number}</span> },
        { label: "Vendor", value: <span style={{ fontWeight: 600 }}>{p.vendor?.name ?? "—"}</span> },
        { label: "Amount", value: <span style={{ fontWeight: 700 }}>{p.currency} {p.amount.toLocaleString()}</span> },
        { label: "Requester", value: <span>{fullName(p.requester)}</span> },
        { label: "Approver", value: <span>{fullName(p.approver)}</span> },
        { label: "Delivery", value: p.expectedDeliveryDate ? (<>
          <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{new Date(p.expectedDeliveryDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
      ]}
    />
  );
}
