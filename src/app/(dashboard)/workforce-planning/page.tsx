"use client";

/* Real Workforce Planning page (headcount plans per department).
 *
 *  GET  /api/headcount-plans         list plans visible to me (manager+)
 *  POST /api/headcount-plans         { period, departmentId?, plannedHeadcount, plannedBudget?, ... }
 *
 *  One row per (department, period). Org-wide plans have departmentId=null.
 *  Editing is admin-only at the API level — toast on 403.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPlan = {
  id: string;
  period: string;
  departmentId: string | null;
  plannedHeadcount: number;
  plannedBudget: number | null;
  budgetCurrency: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  department?: { id: string; name: string } | null;
};

function planToRow(p: ApiPlan): Row {
  return {
    id: p.id,
    name: p.department?.name ?? "Org-wide",
    cells: {
      period: p.period,
      headcount: `${p.plannedHeadcount}`,
      budget: p.plannedBudget == null ? "—" : `${p.budgetCurrency} ${p.plannedBudget.toLocaleString()}`,
      currency: p.budgetCurrency,
      notes: p.notes ? (p.notes.length > 60 ? p.notes.slice(0, 60) + "…" : p.notes) : "—",
      updated: { iso: p.updatedAt },
    },
  };
}

function buildGroups(rows: ApiPlan[]): TableGroup[] {
  const byPeriod = new Map<string, ApiPlan[]>();
  for (const p of rows) {
    if (!byPeriod.has(p.period)) byPeriod.set(p.period, []);
    byPeriod.get(p.period)!.push(p);
  }
  const palette = [C.indigo, C.purple, C.blue, C.teal, C.green, C.orange, C.pink];
  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([period, items], idx) => ({
      id: period, title: period,
      color: palette[idx % palette.length],
      rows: items.map(planToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "period",    label: "Period",    type: "text" },
  { id: "headcount", label: "Headcount", type: "text" },
  { id: "budget",    label: "Budget",    type: "text" },
  { id: "currency",  label: "Currency",  type: "text" },
  { id: "notes",     label: "Notes",     type: "text" },
  { id: "updated",   label: "Updated",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function WorkforcePlanningPage() {
  const [rows, setRows] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/headcount-plans");
      if (res.status === 403) {
        setLoadError("Workforce planning requires manager-level access.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("workforce-planning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (groupId: string) => {
      const period = groupId || currentPeriod();
      const res = await fetch("/api/headcount-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, plannedHeadcount: 0, budgetCurrency: "USD" }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can create headcount plans");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const p: ApiPlan = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: p.id, name: p.department?.name ?? "Org-wide" };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((p): CalendarEvent => ({
      id: p.id,
      title: `${p.department?.name ?? "Org-wide"} · ${p.plannedHeadcount} planned`,
      date: p.updatedAt,
      color: C.indigo,
      payload: planToRow(p).cells,
    })),
    [rows],
  );

  const totalHeadcount = (rows ?? []).reduce((acc, p) => acc + p.plannedHeadcount, 0);
  const totalBudget = (rows ?? []).reduce((acc, p) => acc + (p.plannedBudget ?? 0), 0);
  const currency = (rows ?? [])[0]?.budgetCurrency ?? "USD";

  return (
    <>
      <OsTitleBar
        title="Workforce planning"
        Icon={LineChart}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading plans…" : `${rows.length} plan${rows.length === 1 ? "" : "s"} · ${totalHeadcount} planned headcount${totalBudget > 0 ? ` · ${currency} ${totalBudget.toLocaleString()}` : ""}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New plan" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={LineChart} iconGradient={GRAD.redPink} title="Couldn't load plans" subtitle={loadError} cta="Back" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={LineChart} iconGradient={GRAD.indigoBlue} title="No headcount plans yet" subtitle="Set planned headcount and salary budget per department, per period. Track variance vs actual hires." chips={["Per-department", "Per-period", "Budget", "Variance"]} cta="New plan" />
          ) : (
            <OsMainTable moduleId="workforce-planning" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="workforce-planning" events={calendarEvents} newLabel="New plan" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={LineChart} iconGradient={GRAD.indigoBlue} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
