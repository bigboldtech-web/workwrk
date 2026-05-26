"use client";

/* Real CRM Leads page.
 *
 *  GET   /api/crm/leads             list this org's leads
 *  POST  /api/crm/leads             { firstName, lastName?, email?, company?, ... }
 *  PATCH /api/crm/leads             { id, status?, ownerId?, ... }
 *
 *  Status enum: NEW | CONTACTED | QUALIFIED | UNQUALIFIED | CONVERTED | DISQUALIFIED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED";

type ApiLead = {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
  status: LeadStatus;
  source?: string | null;
  ownerId?: string | null;
  convertedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TO_OS: Record<LeadStatus, StatusValue> = {
  NEW: "planning", CONTACTED: "working", QUALIFIED: "review",
  CONVERTED: "done", UNQUALIFIED: "empty", DISQUALIFIED: "stuck",
};
const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New", CONTACTED: "Contacted", QUALIFIED: "Qualified",
  UNQUALIFIED: "Unqualified", CONVERTED: "Converted", DISQUALIFIED: "Disqualified",
};
const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: C.indigo, CONTACTED: C.orange, QUALIFIED: C.purple,
  UNQUALIFIED: C.gray, CONVERTED: C.green, DISQUALIFIED: C.red,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"];

function leadToRow(l: ApiLead): Row {
  const name = `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() || "Unknown";
  return {
    id: l.id,
    name,
    done: l.status === "CONVERTED",
    cells: {
      status: { value: STATUS_TO_OS[l.status], label: STATUS_LABELS[l.status] },
      company: l.company ?? "—",
      title: l.title ?? "—",
      email: l.email ?? "—",
      phone: l.phone ?? "—",
      source: l.source ?? "—",
      created: { iso: l.createdAt },
    },
  };
}

function buildGroups(rows: ApiLead[]): TableGroup[] {
  const buckets = new Map<LeadStatus, ApiLead[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const l of rows) {
    if (l.status === "UNQUALIFIED" || l.status === "DISQUALIFIED") continue;
    const b = buckets.get(l.status);
    if (b) b.push(l);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(leadToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "NEW");
}

const COLUMNS: Column[] = [
  { id: "status",  label: "Status",  type: "status" },
  { id: "company", label: "Company", type: "text" },
  { id: "title",   label: "Title",   type: "text" },
  { id: "email",   label: "Email",   type: "text" },
  { id: "phone",   label: "Phone",   type: "text" },
  { id: "source",  label: "Source",  type: "text" },
  { id: "created", label: "Created", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CrmLeadsPage() {
  const [rows, setRows] = useState<ApiLead[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/leads");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.leads ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/leads");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/crm/leads", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("You don't have permission to edit this lead");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const ok = await patch(rowId, { status: value });
      if (!ok) throw new Error("save failed");
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const [first, ...rest] = name.split(/\s+/);
      const ok = await patch(rowId, { firstName: first, lastName: rest.join(" ") || null });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (_g: string) => {
      const res = await fetch("/api/crm/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "New lead" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const l: ApiLead = data.lead ?? data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: l.id, name: `${l.firstName} ${l.lastName ?? ""}`.trim() };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((l): CalendarEvent => ({
      id: l.id,
      title: `${l.firstName} ${l.lastName ?? ""}`.trim(),
      date: l.createdAt,
      color: STATUS_COLORS[l.status],
      done: l.status === "CONVERTED",
      payload: leadToRow(l).cells,
    })),
    [rows],
  );

  const newCount = (rows ?? []).filter((l) => l.status === "NEW").length;
  const qualifiedCount = (rows ?? []).filter((l) => l.status === "QUALIFIED").length;

  return (
    <>
      <OsTitleBar
        title="CRM · Leads"
        Icon={UserPlus}
        iconGradient={GRAD.greenTeal}
        description={rows === null ? "Loading leads…" : `${rows.length} lead${rows.length === 1 ? "" : "s"} · ${newCount} new · ${qualifiedCount} qualified`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New lead" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={UserPlus} iconGradient={GRAD.redPink} title="Couldn't load leads" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={UserPlus} iconGradient={GRAD.greenTeal} title="No leads yet" subtitle="Capture inbound interest, then move leads through New → Contacted → Qualified → Converted." chips={["New", "Contacted", "Qualified", "Converted"]} cta="New lead" />
          ) : (
            <OsMainTable moduleId="crm/leads" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="crm/leads" events={calendarEvents} newLabel="New lead" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={UserPlus} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
