"use client";

/* Real, persistent Helpdesk page.
 *
 *  GET   /api/helpdesk/tickets   { tickets: [...] (incl. customer) }
 *  POST  /api/helpdesk/tickets   { subject, customerEmail, priority? }
 *  PATCH /api/helpdesk/tickets   { id, status?, priority?, subject? }
 *
 *  Status enum: NEW | OPEN | PENDING_CUSTOMER | PENDING_INTERNAL | RESOLVED | CLOSED | SPAM
 *  Priority:    LOW | NORMAL | HIGH | URGENT
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Headphones, ClipboardList, Boxes, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue, type PrioValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type HdStatus = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM";
type HdPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiSupportTicket = {
  id: string;
  subject: string;
  status: HdStatus;
  priority: HdPrio;
  channel?: string | null;
  category?: string | null;
  slaTier?: string | null;
  csatScore?: number | null;
  firstResponseDueAt?: string | null;
  resolvedAt?: string | null;
  customer?: { id: string; name?: string | null; email?: string | null; companyName?: string | null } | null;
  assigneeId?: string | null;
  createdAt: string;
};

const STATUS_TO_OS: Record<HdStatus, StatusValue> = {
  NEW: "pending", OPEN: "working", PENDING_CUSTOMER: "review",
  PENDING_INTERNAL: "hold", RESOLVED: "shipped", CLOSED: "done", SPAM: "empty",
};
const PRIO_TO_OS: Record<HdPrio, PrioValue> = {
  LOW: "low", NORMAL: "medium", HIGH: "high", URGENT: "critical",
};

const STATUS_LABELS: Record<HdStatus, string> = {
  NEW: "New", OPEN: "Open", PENDING_CUSTOMER: "Pending customer",
  PENDING_INTERNAL: "Pending internal", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
const STATUS_COLORS: Record<HdStatus, string> = {
  NEW: C.indigo, OPEN: C.orange, PENDING_CUSTOMER: C.purple,
  PENDING_INTERNAL: C.brown, RESOLVED: C.sage, CLOSED: C.green, SPAM: C.gray,
};

const STATUS_OPTIONS: PickerOption[] = (["NEW", "OPEN", "PENDING_CUSTOMER", "PENDING_INTERNAL", "RESOLVED", "CLOSED", "SPAM"] as HdStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));
const PRIO_OPTIONS: PickerOption[] = [
  { value: "URGENT", label: "Urgent", color: C.pink },
  { value: "HIGH",   label: "High",   color: C.red },
  { value: "NORMAL", label: "Medium", color: C.yellow },
  { value: "LOW",    label: "Low",    color: C.teal },
];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return { initials: seed.slice(0, 2).toUpperCase(), color: AV_PALETTE[h % AV_PALETTE.length] };
}

const GROUP_ORDER: HdStatus[] = ["NEW", "OPEN", "PENDING_CUSTOMER", "PENDING_INTERNAL", "RESOLVED", "CLOSED"];

function ticketToRow(t: ApiSupportTicket): Row {
  const custLabel = t.customer
    ? (t.customer.companyName || t.customer.name || t.customer.email || "—")
    : "—";
  return {
    id: t.id,
    name: t.subject,
    done: t.status === "RESOLVED" || t.status === "CLOSED",
    cells: {
      status: { value: STATUS_TO_OS[t.status], label: STATUS_LABELS[t.status] },
      prio: { value: PRIO_TO_OS[t.priority] },
      customer: custLabel,
      channel: t.channel ?? "—",
      sla: t.slaTier ?? "—",
      owner: t.assigneeId ? [avatarFor(t.assigneeId)] : [],
      csat: t.csatScore !== null && t.csatScore !== undefined ? `${t.csatScore} / 5` : "—",
      due: t.firstResponseDueAt ? { iso: t.firstResponseDueAt } : undefined,
    },
  };
}

function buildGroups(tickets: ApiSupportTicket[]): TableGroup[] {
  const buckets = new Map<HdStatus, ApiSupportTicket[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const t of tickets) {
    if (t.status === "SPAM") continue;
    const b = buckets.get(t.status);
    if (b) b.push(t);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(ticketToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "NEW" || g.id === "OPEN");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Status",   type: "status" },
  { id: "prio",     label: "Priority", type: "priority" },
  { id: "customer", label: "Customer", type: "text" },
  { id: "channel",  label: "Channel",  type: "text" },
  { id: "sla",      label: "SLA tier", type: "text" },
  { id: "owner",    label: "Assignee", type: "person" },
  { id: "csat",     label: "CSAT",     type: "text" },
  { id: "due",      label: "1st reply by", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "kanban",    label: "Kanban",     Icon: Boxes },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<ApiSupportTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("helpdesk");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(tickets ?? []), [tickets]);

  async function patchTicket(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/helpdesk/tickets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      await patchTicket(rowId, { status: value });
      void load();
    },
    onPrioChange: async (rowId: string, _g: string, value: string) => {
      await patchTicket(rowId, { priority: value });
    },
    onToggleDone: async (rowId: string, _g: string, done: boolean) => {
      await patchTicket(rowId, { status: done ? "RESOLVED" : "OPEN" });
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      await patchTicket(rowId, { subject: name });
    },
    onAdd: async (_groupId: string) => {
      // Helpdesk requires a customer email — block client-side adds for
      // now and instruct the user to file from email or the customer
      // portal. Returning void from onAdd cancels the optimistic row.
      toast("Helpdesk tickets need a customer email — use the inbox or portal");
      throw new Error("customer required");
    },
  };

  const openCount = (tickets ?? []).filter((t) => t.status !== "RESOLVED" && t.status !== "CLOSED" && t.status !== "SPAM").length;

  return (
    <>
      <OsTitleBar
        title="Helpdesk"
        Icon={Headphones}
        iconGradient={GRAD.orangePink}
        description={tickets === null ? "Loading tickets…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} · ${openCount} open · live-synced`}
        people={[PEOPLE.pr, PEOPLE.mk, PEOPLE.sc]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New ticket" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Headphones} iconGradient={GRAD.redPink} title="Couldn't load tickets" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : tickets === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <OsEmptyView Icon={Headphones} iconGradient={GRAD.orangePink} title="No customer tickets yet" subtitle="Tickets show up here automatically when customers email support, fill the portal form, or open chat." chips={["Email", "Portal", "Chat", "API"]} cta="Set up email forwarding" />
          ) : (
            <OsMainTable moduleId="helpdesk" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} prioOptions={PRIO_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar
          moduleId="helpdesk"
          events={(tickets ?? [])
            .filter((t) => t.firstResponseDueAt)
            .map((t): CalendarEvent => ({
              id: t.id,
              title: t.subject,
              date: t.firstResponseDueAt as string,
              color: STATUS_COLORS[t.status],
              done: t.status === "RESOLVED" || t.status === "CLOSED",
              payload: ticketToRow(t).cells,
            }))}
          newLabel="New ticket"
        />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView
          Icon={Headphones}
          iconGradient={GRAD.orangePink}
          title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`}
          subtitle="This view will share the same live data as Main table. Persistence already works there."
          chips={["Live data", "Persistent edits"]}
          cta="Back to Main table"
        />
      )}
    </>
  );
}
