"use client";

/* Real, persistent Compensation Cycles page.
 *
 *  GET   /api/comp-cycles
 *  POST  /api/comp-cycles            { name, startDate, endDate, reportingCurrency?, budgetPct? }
 *  PATCH /api/comp-cycles/[id]       { name?, status?, startDate?, endDate?, budgetPct? }
 *
 *  Status enum: DRAFT | OPEN | CLOSED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type CycleStatus = "DRAFT" | "OPEN" | "CLOSED";

type ApiCycle = {
  id: string;
  name: string;
  description?: string | null;
  status: CycleStatus;
  startDate: string;
  endDate: string;
  budgetPct?: number | null;
  reportingCurrency: string;
  closedAt?: string | null;
  _count?: { decisions?: number };
};

const STATUS_TO_OS: Record<CycleStatus, StatusValue> = {
  DRAFT: "planning", OPEN: "working", CLOSED: "done",
};
const STATUS_LABELS: Record<CycleStatus, string> = {
  DRAFT: "Draft", OPEN: "Open", CLOSED: "Closed",
};
const STATUS_COLORS: Record<CycleStatus, string> = {
  DRAFT: C.indigo, OPEN: C.orange, CLOSED: C.green,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as CycleStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: CycleStatus[] = ["DRAFT", "OPEN", "CLOSED"];

function cycleToRow(c: ApiCycle): Row {
  return {
    id: c.id,
    name: c.name,
    done: c.status === "CLOSED",
    cells: {
      status: { value: STATUS_TO_OS[c.status], label: STATUS_LABELS[c.status] },
      decisions: `${c._count?.decisions ?? 0}`,
      budget: c.budgetPct !== null && c.budgetPct !== undefined ? `${c.budgetPct}%` : "—",
      currency: c.reportingCurrency,
      start: c.startDate ? { iso: c.startDate } : undefined,
      end: c.endDate ? { iso: c.endDate } : undefined,
    },
  };
}

function buildGroups(cycles: ApiCycle[]): TableGroup[] {
  const buckets = new Map<CycleStatus, ApiCycle[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const c of cycles) {
    const b = buckets.get(c.status);
    if (b) b.push(c);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(cycleToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "OPEN");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",     type: "status" },
  { id: "decisions", label: "Decisions",  type: "text" },
  { id: "budget",    label: "Budget %",   type: "text" },
  { id: "currency",  label: "Currency",   type: "text" },
  { id: "start",     label: "Starts",     type: "date" },
  { id: "end",       label: "Ends",       type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CompensationPage() {
  const [cycles, setCycles] = useState<ApiCycle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/comp-cycles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCycles(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("compensation");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(cycles ?? []), [cycles]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/comp-cycles/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can edit comp cycles");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      // Lifecycle is forward-only: DRAFT → OPEN → CLOSED. Picking
      // something illegal will 400 server-side; rollback handles it.
      const ok = await patch(rowId, { status: value });
      if (!ok) throw new Error("invalid");
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const ok = await patch(rowId, { name });
      if (!ok) throw new Error("rename failed");
    },
    onAdd: async (groupId: string) => {
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const res = await fetch("/api/comp-cycles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled cycle",
          startDate: now.toISOString(),
          endDate: end.toISOString(),
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can create comp cycles");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const c: ApiCycle = data.data ?? data;
      if (groupId === "OPEN" && c.status === "DRAFT") {
        void patch(c.id, { status: "OPEN" });
      }
      setTimeout(() => void load(), 200);
      return { id: c.id, name: c.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (cycles ?? [])
      .filter((c) => c.endDate)
      .map((c): CalendarEvent => ({
        id: c.id, title: c.name, date: c.endDate,
        color: STATUS_COLORS[c.status], done: c.status === "CLOSED",
        payload: cycleToRow(c).cells,
      })),
    [cycles],
  );

  const openCount = (cycles ?? []).filter((c) => c.status === "OPEN").length;

  return (
    <>
      <OsTitleBar
        title="Compensation"
        Icon={Wallet}
        iconGradient={GRAD.tealGreen}
        description={cycles === null ? "Loading cycles…" : `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} · ${openCount} open · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New cycle" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Wallet} iconGradient={GRAD.redPink} title="Couldn't load cycles" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : cycles === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : cycles.length === 0 ? (
            <OsEmptyView Icon={Wallet} iconGradient={GRAD.tealGreen} title="No comp cycles yet" subtitle="Plan your first comp cycle. Managers propose merit + bonus per direct report; HR finalizes." chips={["Annual", "Mid-year", "Bonus", "Promotion"]} cta="New cycle" />
          ) : (
            <OsMainTable moduleId="compensation" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="compensation" events={calendarEvents} newLabel="New cycle" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Wallet} iconGradient={GRAD.tealGreen} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
