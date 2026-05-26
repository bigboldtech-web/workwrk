"use client";

/* Real, persistent Expenses page.
 *
 *  GET   /api/expenses?scope=mine|approve|all
 *  POST  /api/expenses           { description, amount, currency, category, expenseDate, submit? }
 *  PATCH /api/expenses/[id]      { description?, amount?, ..., submit? } (DRAFT-only fields)
 *  POST  /api/expenses/[id]/decision  { decision: APPROVE | REJECT | REIMBURSE }  (manager+)
 *
 *  Status enum: DRAFT | SUBMITTED | APPROVED | REJECTED | REIMBURSED
 *
 *  Transitions:
 *    DRAFT → SUBMITTED                 PATCH { submit: true }
 *    SUBMITTED → APPROVED              POST /decision { decision: APPROVE }
 *    SUBMITTED → REJECTED              POST /decision { decision: REJECT }
 *    APPROVED → REIMBURSED             POST /decision { decision: REIMBURSE }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type ExpStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "REIMBURSED";

type ApiExpense = {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  status: ExpStatus;
  expenseDate?: string | null;
  submittedAt?: string | null;
  decisionAt?: string | null;
  receiptUrl?: string | null;
  reporter?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STATUS_TO_OS: Record<ExpStatus, StatusValue> = {
  DRAFT: "planning", SUBMITTED: "pending", APPROVED: "progress",
  REJECTED: "stuck", REIMBURSED: "done",
};
const STATUS_LABELS: Record<ExpStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", REIMBURSED: "Reimbursed",
};
const STATUS_COLORS: Record<ExpStatus, string> = {
  DRAFT: C.indigo, SUBMITTED: C.yellow, APPROVED: C.blue,
  REJECTED: C.red, REIMBURSED: C.green,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as ExpStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { initials: ((s)[0] ?? "?").toUpperCase(), color: AV_PALETTE[h % AV_PALETTE.length] };
}
function initialsFor(first?: string | null, last?: string | null) {
  const f = (first ?? "")[0] ?? "";
  const l = (last ?? "")[0] ?? "";
  return ((f + l) || "?").toUpperCase();
}

const GROUP_ORDER: ExpStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"];

function expToRow(e: ApiExpense): Row {
  return {
    id: e.id,
    name: e.description,
    done: e.status === "REIMBURSED",
    cells: {
      status: { value: STATUS_TO_OS[e.status], label: STATUS_LABELS[e.status] },
      category: e.category.replace(/_/g, " "),
      amount: e.amount,
      reporter: e.reporter ? [{
        initials: initialsFor(e.reporter.firstName, e.reporter.lastName),
        color: avatarFor(e.reporter.id).color,
      }] : [],
      approver: e.approver ? [{
        initials: initialsFor(e.approver.firstName, e.approver.lastName),
        color: avatarFor(e.approver.id).color,
      }] : [],
      date: e.expenseDate ? { iso: e.expenseDate } : undefined,
      receipt: e.receiptUrl ? "yes" : "—",
    },
  };
}

function buildGroups(exps: ApiExpense[]): TableGroup[] {
  const buckets = new Map<ExpStatus, ApiExpense[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const e of exps) {
    const b = buckets.get(e.status);
    if (b) b.push(e);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(expToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "SUBMITTED");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Status",    type: "status" },
  { id: "category", label: "Category",  type: "text" },
  { id: "amount",   label: "Amount",    type: "number", currency: "₹" },
  { id: "reporter", label: "Reporter",  type: "person" },
  { id: "approver", label: "Approver",  type: "person" },
  { id: "date",     label: "Date",      type: "date" },
  { id: "receipt",  label: "Receipt",   type: "text" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ExpensesPage() {
  const [exps, setExps] = useState<ApiExpense[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      // Try "all" first (manager view); fall back to "mine" if forbidden
      let res = await fetch("/api/expenses?scope=all&limit=200");
      if (res.status === 403) {
        res = await fetch("/api/expenses?scope=mine&limit=200");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiExpense[] = data?.data?.items ?? data?.items ?? (Array.isArray(data?.data) ? data.data : []) ?? (Array.isArray(data) ? data : []);
      setExps(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("expenses");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(exps ?? []), [exps]);

  // Map (from → to) onto either a PATCH submit flag or a /decision call.
  async function transition(id: string, from: ExpStatus, to: ExpStatus): Promise<boolean> {
    if (from === to) return true;
    if (from === "DRAFT" && to === "SUBMITTED") {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submit: true }),
      });
      if (!res.ok) return false;
      return true;
    }
    let decision: "APPROVE" | "REJECT" | "REIMBURSE" | null = null;
    if (from === "SUBMITTED" && to === "APPROVED") decision = "APPROVE";
    else if (from === "SUBMITTED" && to === "REJECTED") decision = "REJECT";
    else if (from === "APPROVED" && to === "REIMBURSED") decision = "REIMBURSE";
    if (!decision) {
      toast(`Can't go from ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`);
      return false;
    }
    const res = await fetch(`/api/expenses/${id}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) return false;
    return true;
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const exp = (exps ?? []).find((e) => e.id === rowId);
      if (!exp) return;
      const ok = await transition(rowId, exp.status, value as ExpStatus);
      if (!ok) throw new Error("illegal transition");
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const res = await fetch(`/api/expenses/${rowId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: name }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only DRAFT expenses can be renamed");
        throw new Error(`PATCH ${res.status}`);
      }
    },
    onAdd: async (groupId: string) => {
      const res = await fetch("/api/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Untitled expense",
          amount: 0,
          currency: "INR",
          category: "OTHER",
          expenseDate: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const e: ApiExpense = data.data ?? data;
      if (groupId === "SUBMITTED" && e.status === "DRAFT") {
        void fetch(`/api/expenses/${e.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submit: true }),
        });
      }
      setTimeout(() => void load(), 200);
      return { id: e.id, name: e.description };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (exps ?? [])
      .filter((e) => e.expenseDate)
      .map((e): CalendarEvent => ({
        id: e.id, title: `${e.description} · ₹${e.amount.toLocaleString()}`,
        date: e.expenseDate as string,
        color: STATUS_COLORS[e.status], done: e.status === "REIMBURSED",
        payload: expToRow(e).cells,
      })),
    [exps],
  );

  const pendingCount = (exps ?? []).filter((e) => e.status === "SUBMITTED").length;
  const reimbursedValue = (exps ?? []).reduce((acc, e) => e.status === "REIMBURSED" ? acc + e.amount : acc, 0);

  return (
    <>
      <OsTitleBar
        title="Expenses"
        Icon={Receipt}
        iconGradient={GRAD.brownOrange}
        description={exps === null ? "Loading expenses…" : `${exps.length} expense${exps.length === 1 ? "" : "s"} · ${pendingCount} pending approval · ₹${reimbursedValue.toLocaleString()} reimbursed`}
        people={[PEOPLE.bb, PEOPLE.vn]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New expense" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Receipt} iconGradient={GRAD.redPink} title="Couldn't load expenses" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : exps === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : exps.length === 0 ? (
            <OsEmptyView Icon={Receipt} iconGradient={GRAD.brownOrange} title="No expenses yet" subtitle="Submit your first expense using '+ Add expense'. Upload a receipt and we'll route it to your manager." chips={["Travel", "Meals", "Lodging", "Supplies", "Subscription"]} cta="New expense" />
          ) : (
            <OsMainTable moduleId="expenses" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="expenses" events={calendarEvents} newLabel="New expense" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Receipt} iconGradient={GRAD.brownOrange} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
