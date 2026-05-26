"use client";

/* Real, persistent Procurement page (Purchase Orders).
 *
 *  GET   /api/purchase-orders?scope=all
 *  PATCH /api/purchase-orders/[id]   { action: submit|retract|approve|reject|send|receive|close }
 *  PATCH /api/purchase-orders/[id]   { description?, amount? }  (DRAFT-only field edits)
 *
 *  Status enum: DRAFT | SUBMITTED | APPROVED | REJECTED | SENT | RECEIVED | CLOSED
 *
 *  Transitions are action-based, not direct-status. Status picker maps
 *  the chosen target status to the appropriate action; the API will
 *  reject 409 if the transition isn't legal from the current state and
 *  we'll roll back the optimistic update.
 *
 *  Adding requires a vendor — surface a toast pointing to /procurement
 *  with the vendor picker instead.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShoppingCart, ClipboardList, Boxes, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

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
  requester?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  _count?: { invoices?: number };
  createdAt: string;
  submittedAt?: string | null;
};

const STATUS_TO_OS: Record<PoStatus, StatusValue> = {
  DRAFT: "planning", SUBMITTED: "pending", APPROVED: "progress",
  REJECTED: "stuck", SENT: "working", RECEIVED: "review", CLOSED: "done",
};
const STATUS_LABELS: Record<PoStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", SENT: "Sent", RECEIVED: "Received", CLOSED: "Closed",
};
const STATUS_COLORS: Record<PoStatus, string> = {
  DRAFT: C.indigo, SUBMITTED: C.yellow, APPROVED: C.blue,
  REJECTED: C.red, SENT: C.orange, RECEIVED: C.purple, CLOSED: C.green,
};
const STATUS_OPTIONS: PickerOption[] = (["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SENT", "RECEIVED", "CLOSED"] as PoStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

// Resolve which `action` to send to PATCH /[id] for a (current → target) transition.
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
  return null; // illegal transition
}

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function initialsFor(first?: string | null, last?: string | null) {
  const f = (first ?? "")[0] ?? "";
  const l = (last ?? "")[0] ?? "";
  return ((f + l) || "?").toUpperCase();
}

const GROUP_ORDER: PoStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "SENT", "RECEIVED", "CLOSED", "REJECTED"];

function poToRow(p: ApiPO): Row {
  return {
    id: p.id,
    name: p.description,
    done: p.status === "CLOSED" || p.status === "RECEIVED",
    cells: {
      status: { value: STATUS_TO_OS[p.status], label: STATUS_LABELS[p.status] },
      number: p.number,
      vendor: p.vendor?.name ?? "—",
      amount: p.amount,
      requester: p.requester ? [{
        initials: initialsFor(p.requester.firstName, p.requester.lastName),
        color: avatarFor(p.requester.id),
      }] : [],
      approver: p.approver ? [{
        initials: initialsFor(p.approver.firstName, p.approver.lastName),
        color: avatarFor(p.approver.id),
      }] : [],
      delivery: p.expectedDeliveryDate ? { iso: p.expectedDeliveryDate } : undefined,
    },
  };
}

function buildGroups(pos: ApiPO[]): TableGroup[] {
  const buckets = new Map<PoStatus, ApiPO[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const p of pos) {
    const b = buckets.get(p.status);
    if (b) b.push(p);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(poToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "SUBMITTED");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",     type: "status" },
  { id: "number",    label: "PO #",       type: "text" },
  { id: "vendor",    label: "Vendor",     type: "text" },
  { id: "amount",    label: "Amount",     type: "number", currency: "₹" },
  { id: "requester", label: "Requester",  type: "person" },
  { id: "approver",  label: "Approver",   type: "person" },
  { id: "delivery",  label: "Delivery",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "kanban",    label: "Kanban",     Icon: Boxes },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ProcurementPage() {
  const [pos, setPos] = useState<ApiPO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/purchase-orders?scope=all");
      if (!res.ok) {
        // Fall back to "mine" if user isn't a manager
        if (res.status === 403) {
          const r2 = await fetch("/api/purchase-orders?scope=mine");
          if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
          const d2 = await r2.json();
          setPos(d2.data ?? (Array.isArray(d2) ? d2 : []));
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setPos(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("procurement");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(pos ?? []), [pos]);

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const po = (pos ?? []).find((p) => p.id === rowId);
      if (!po) return;
      const action = actionFor(po.status, value as PoStatus);
      if (!action) {
        toast(`Can't go from ${STATUS_LABELS[po.status]} → ${STATUS_LABELS[value as PoStatus]}`);
        throw new Error("illegal transition");
      }
      const res = await fetch(`/api/purchase-orders/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      // DRAFT-only field edit per the API. If the PO isn't DRAFT, the
      // API will 403 and we'll roll back.
      const res = await fetch(`/api/purchase-orders/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: name }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    },
    onAdd: async (_g: string) => {
      toast("New POs need a vendor — pick one from the Vendors page");
      throw new Error("vendor required");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (pos ?? [])
      .filter((p) => p.expectedDeliveryDate)
      .map((p): CalendarEvent => ({
        id: p.id,
        title: `${p.number} · ${p.vendor?.name ?? "—"} · ${p.currency}${p.amount.toLocaleString()}`,
        date: p.expectedDeliveryDate as string,
        color: STATUS_COLORS[p.status],
        done: p.status === "CLOSED" || p.status === "RECEIVED",
        payload: poToRow(p).cells,
      })),
    [pos],
  );

  const openCount = (pos ?? []).filter((p) => p.status !== "CLOSED" && p.status !== "REJECTED").length;
  const openValue = (pos ?? []).reduce((acc, p) => p.status !== "CLOSED" && p.status !== "REJECTED" ? acc + p.amount : acc, 0);

  return (
    <>
      <OsTitleBar
        title="Procurement"
        Icon={ShoppingCart}
        iconGradient={GRAD.brownOrange}
        description={pos === null ? "Loading POs…" : `${pos.length} PO${pos.length === 1 ? "" : "s"} · ${openCount} open · ₹${openValue.toLocaleString()} pending`}
        people={[PEOPLE.bb, PEOPLE.vn]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New PO" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.redPink} title="Couldn't load POs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : pos === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : pos.length === 0 ? (
            <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.brownOrange} title="No purchase orders yet" subtitle="Create your first PO via the Vendors page — pick a vendor, set an amount, submit for approval." chips={["DRAFT", "SUBMITTED", "APPROVED"]} cta="Browse vendors" />
          ) : (
            <OsMainTable moduleId="procurement" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="procurement" events={calendarEvents} newLabel="New PO" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={ShoppingCart} iconGradient={GRAD.brownOrange} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares the same live data as Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
