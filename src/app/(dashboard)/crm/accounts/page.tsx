"use client";

/* Real CRM Accounts page (companies).
 *
 *  GET  /api/crm/accounts          list this org's accounts
 *  POST /api/crm/accounts          { name, type?, industry?, ... }
 *
 *  Type enum: PROSPECT | CUSTOMER | PARTNER | CHURNED | COMPETITOR
 *  Groups by type. No PATCH endpoint at the route level — rename
 *  routes through the [id] handler if present.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type AccountType = "PROSPECT" | "CUSTOMER" | "PARTNER" | "CHURNED" | "COMPETITOR";

type ApiAccount = {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  phone?: string | null;
  description?: string | null;
  type: AccountType;
  ownerId?: string | null;
  _count?: { opportunities?: number };
  createdAt: string;
  updatedAt: string;
};

const TYPE_TO_OS: Record<AccountType, StatusValue> = {
  PROSPECT: "planning", CUSTOMER: "done", PARTNER: "review",
  CHURNED: "empty", COMPETITOR: "stuck",
};
const TYPE_LABELS: Record<AccountType, string> = {
  PROSPECT: "Prospect", CUSTOMER: "Customer", PARTNER: "Partner",
  CHURNED: "Churned", COMPETITOR: "Competitor",
};
const TYPE_COLORS: Record<AccountType, string> = {
  PROSPECT: C.indigo, CUSTOMER: C.green, PARTNER: C.purple,
  CHURNED: C.gray, COMPETITOR: C.red,
};
const TYPE_OPTIONS: PickerOption[] = (Object.keys(TYPE_LABELS) as AccountType[]).map((s) => ({
  value: s, label: TYPE_LABELS[s], color: TYPE_COLORS[s],
}));

const GROUP_ORDER: AccountType[] = ["PROSPECT", "CUSTOMER", "PARTNER", "CHURNED", "COMPETITOR"];

function accountToRow(a: ApiAccount): Row {
  return {
    id: a.id,
    name: a.name,
    cells: {
      type: { value: TYPE_TO_OS[a.type], label: TYPE_LABELS[a.type] },
      industry: a.industry ?? "—",
      size: a.size ?? "—",
      domain: a.domain ?? a.website ?? "—",
      phone: a.phone ?? "—",
      deals: `${a._count?.opportunities ?? 0}`,
      created: { iso: a.createdAt },
    },
  };
}

function buildGroups(rows: ApiAccount[]): TableGroup[] {
  const buckets = new Map<AccountType, ApiAccount[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const a of rows) {
    const b = buckets.get(a.type);
    if (b) b.push(a);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: TYPE_LABELS[s], color: TYPE_COLORS[s],
      rows: (buckets.get(s) ?? []).map(accountToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "PROSPECT" || g.id === "CUSTOMER");
}

const COLUMNS: Column[] = [
  { id: "type",     label: "Type",     type: "status" },
  { id: "industry", label: "Industry", type: "text" },
  { id: "size",     label: "Size",     type: "text" },
  { id: "domain",   label: "Domain",   type: "text" },
  { id: "phone",    label: "Phone",    type: "text" },
  { id: "deals",    label: "Open deals", type: "text" },
  { id: "created",  label: "Created",  type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CrmAccountsPage() {
  const [rows, setRows] = useState<ApiAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/accounts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.accounts ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/accounts");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (groupId: string) => {
      const type = (GROUP_ORDER as string[]).includes(groupId) ? groupId : "PROSPECT";
      const res = await fetch("/api/crm/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled account", type }),
      });
      if (!res.ok) {
        if (res.status === 409) toast("An account with that name already exists");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const a: ApiAccount = data.account ?? data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: a.id, name: a.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((a): CalendarEvent => ({
      id: a.id,
      title: a.name,
      date: a.createdAt,
      color: TYPE_COLORS[a.type],
      payload: accountToRow(a).cells,
    })),
    [rows],
  );

  const customerCount = (rows ?? []).filter((a) => a.type === "CUSTOMER").length;
  const prospectCount = (rows ?? []).filter((a) => a.type === "PROSPECT").length;

  return (
    <>
      <OsTitleBar
        title="CRM · Accounts"
        Icon={Building2}
        iconGradient={GRAD.greenTeal}
        description={rows === null ? "Loading accounts…" : `${rows.length} account${rows.length === 1 ? "" : "s"} · ${customerCount} customer${customerCount === 1 ? "" : "s"} · ${prospectCount} prospect${prospectCount === 1 ? "" : "s"}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New account" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Building2} iconGradient={GRAD.redPink} title="Couldn't load accounts" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Building2} iconGradient={GRAD.greenTeal} title="No accounts yet" subtitle="Track the companies you sell to. Tag them as prospects, customers, partners — and link every opportunity back." chips={["Prospect", "Customer", "Partner", "Industry"]} cta="New account" />
          ) : (
            <OsMainTable moduleId="crm/accounts" columns={COLUMNS} groups={groups} statusOptions={TYPE_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="crm/accounts" events={calendarEvents} newLabel="New account" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Building2} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
