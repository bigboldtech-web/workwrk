"use client";

/* Real, persistent ITSM Tickets page.
 *
 *  GET   /api/itsm/tickets
 *  POST  /api/itsm/tickets   { title, priority? }
 *  PATCH /api/itsm/tickets   { id, status?, priority?, title? }
 *
 *  Status enum:  OPEN | TRIAGED | IN_PROGRESS | WAITING_ON_USER |
 *                WAITING_ON_VENDOR | RESOLVED | CLOSED | CANCELLED
 *  Priority:     LOW | NORMAL | HIGH | URGENT | CRITICAL
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Server, ClipboardList, Boxes, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue, type PrioValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type ItsmStatus = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";
type ItsmPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";

type ApiTicket = {
  id: string;
  title: string;
  status: ItsmStatus;
  priority: ItsmPrio;
  category?: string | null;
  source?: string | null;
  requesterId?: string | null;
  assigneeId?: string | null;
  slaTier?: string | null;
  dueAt?: string | null;
  createdAt: string;
};

const STATUS_TO_OS: Record<ItsmStatus, StatusValue> = {
  OPEN: "planning", TRIAGED: "pending", IN_PROGRESS: "working",
  WAITING_ON_USER: "review", WAITING_ON_VENDOR: "hold",
  RESOLVED: "shipped", CLOSED: "done", CANCELLED: "empty",
};
const PRIO_TO_OS: Record<ItsmPrio, PrioValue> = {
  LOW: "low", NORMAL: "medium", HIGH: "high", URGENT: "critical", CRITICAL: "critical",
};

const STATUS_LABELS: Record<ItsmStatus, string> = {
  OPEN: "Open", TRIAGED: "Triaged", IN_PROGRESS: "In progress",
  WAITING_ON_USER: "Waiting on user", WAITING_ON_VENDOR: "Waiting on vendor",
  RESOLVED: "Resolved", CLOSED: "Closed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ItsmStatus, string> = {
  OPEN: C.indigo, TRIAGED: C.yellow, IN_PROGRESS: C.orange,
  WAITING_ON_USER: C.purple, WAITING_ON_VENDOR: C.brown,
  RESOLVED: C.sage, CLOSED: C.green, CANCELLED: C.gray,
};

const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as ItsmStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));
const PRIO_OPTIONS: PickerOption[] = [
  { value: "CRITICAL", label: "Critical", color: C.pink },
  { value: "URGENT",   label: "Urgent",   color: C.red },
  { value: "HIGH",     label: "High",     color: C.red },
  { value: "NORMAL",   label: "Medium",   color: C.yellow },
  { value: "LOW",      label: "Low",      color: C.teal },
];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return { initials: seed.slice(0, 2).toUpperCase(), color: AV_PALETTE[h % AV_PALETTE.length] };
}

const GROUP_ORDER: ItsmStatus[] = ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "WAITING_ON_VENDOR", "RESOLVED", "CLOSED"];

function ticketToRow(t: ApiTicket): Row {
  return {
    id: t.id,
    name: t.title,
    done: t.status === "RESOLVED" || t.status === "CLOSED",
    cells: {
      status: { value: STATUS_TO_OS[t.status], label: STATUS_LABELS[t.status] },
      prio: { value: PRIO_TO_OS[t.priority] },
      owner: t.assigneeId ? [avatarFor(t.assigneeId)] : [],
      category: t.category ?? "—",
      due: t.dueAt ? { iso: t.dueAt } : undefined,
      sla: t.slaTier ?? "—",
    },
  };
}

function buildGroups(tickets: ApiTicket[]): TableGroup[] {
  const buckets = new Map<ItsmStatus, ApiTicket[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const t of tickets) {
    if (t.status === "CANCELLED") continue;
    const b = buckets.get(t.status);
    if (b) b.push(t);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(ticketToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "OPEN" || g.id === "IN_PROGRESS");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Status",   type: "status" },
  { id: "prio",     label: "Priority", type: "priority" },
  { id: "owner",    label: "Assignee", type: "person" },
  { id: "category", label: "Category", type: "text" },
  { id: "sla",      label: "SLA",      type: "text" },
  { id: "due",      label: "Due",      type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "kanban",    label: "Kanban",     Icon: Boxes },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ItsmPage() {
  const [tickets, setTickets] = useState<ApiTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const itsmVersion = rowVersion("itsm");
  useEffect(() => { if (itsmVersion > 0) void load(); }, [itsmVersion, load]);

  const groups = useMemo(() => buildGroups(tickets ?? []), [tickets]);

  async function patchTicket(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/itsm/tickets", {
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
      await patchTicket(rowId, { title: name });
    },
    onAdd: async (groupId: string) => {
      const res = await fetch("/api/itsm/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled ticket", priority: "NORMAL" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const t: ApiTicket = data.ticket ?? data.data ?? data;
      if (groupId !== "OPEN" && (GROUP_ORDER as string[]).includes(groupId)) {
        void patchTicket(t.id, { status: groupId });
      }
      setTimeout(() => void load(), 200);
      return { id: t.id, name: t.title };
    },
  };

  const openCount = (tickets ?? []).filter((t) => t.status !== "RESOLVED" && t.status !== "CLOSED" && t.status !== "CANCELLED").length;

  return (
    <>
      <OsTitleBar
        title="ITSM"
        Icon={Server}
        iconGradient={GRAD.bluePurple}
        description={tickets === null ? "Loading tickets…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} · ${openCount} open · live-synced`}
        people={[PEOPLE.ak, PEOPLE.vn, PEOPLE.rj]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New ticket" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Server} iconGradient={GRAD.redPink} title="Couldn't load tickets" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : tickets === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <OsEmptyView Icon={Server} iconGradient={GRAD.bluePurple} title="No tickets yet" subtitle="File your first ticket using the '+ Add ticket' button at the bottom of any group." cta="New ticket" />
          ) : (
            <OsMainTable moduleId="itsm" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} prioOptions={PRIO_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar
          moduleId="itsm"
          events={(tickets ?? [])
            .filter((t) => t.dueAt)
            .map((t): CalendarEvent => ({
              id: t.id,
              title: t.title,
              date: t.dueAt as string,
              color: STATUS_COLORS[t.status],
              done: t.status === "RESOLVED" || t.status === "CLOSED",
              payload: ticketToRow(t).cells,
            }))}
          newLabel="New ticket"
        />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView
          Icon={Server}
          iconGradient={GRAD.bluePurple}
          title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`}
          subtitle="This view will share the same live data as Main table. Persistence already works there — try it."
          chips={["Live data", "Persistent edits"]}
          cta="Back to Main table"
        />
      )}
    </>
  );
}
