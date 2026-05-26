"use client";

/* Real Process Runs page (checklist SOP executions).
 *
 *  GET    /api/process-runs        list
 *  POST   /api/process-runs        { sopId, title?, assigneeId?, dueDate? }
 *  PATCH  /api/process-runs        { id, action: complete_step | uncomplete_step | cancel, stepId? }
 *
 *  Status enum: ACTIVE | COMPLETED | OVERDUE | CANCELLED.
 *  PATCH is action-based — only "cancel" is exposed from the status picker.
 *  Step completion is done inside the run drawer / share link, not here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type PrStatus = "ACTIVE" | "COMPLETED" | "OVERDUE" | "CANCELLED";

type ApiProcessRun = {
  id: string;
  title: string;
  status: PrStatus;
  progress: number;
  dueDate?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  assigneeId?: string | null;
  sopId: string;
  sop?: { id: string; title: string; category?: string | null; sopType?: string } | null;
};

const STATUS_TO_OS: Record<PrStatus, StatusValue> = {
  ACTIVE: "working", COMPLETED: "done", OVERDUE: "stuck", CANCELLED: "empty",
};
const STATUS_LABELS: Record<PrStatus, string> = {
  ACTIVE: "Active", COMPLETED: "Completed", OVERDUE: "Overdue", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<PrStatus, string> = {
  ACTIVE: C.orange, COMPLETED: C.green, OVERDUE: C.red, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (["ACTIVE", "COMPLETED", "OVERDUE", "CANCELLED"] as PrStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: PrStatus[] = ["OVERDUE", "ACTIVE", "COMPLETED"];

function runToRow(r: ApiProcessRun): Row {
  const pct = typeof r.progress === "number" ? r.progress : 0;
  return {
    id: r.id,
    name: r.title,
    done: r.status === "COMPLETED",
    cells: {
      status: { value: STATUS_TO_OS[r.status], label: STATUS_LABELS[r.status] },
      sop: r.sop?.title ?? "—",
      category: r.sop?.category ?? "—",
      progress: { pct, color: pct >= 100 ? "green" : pct >= 50 ? "blue" : pct >= 25 ? "warning" : "danger" },
      due: r.dueDate ? { iso: r.dueDate, state: r.status === "OVERDUE" ? "stuck" : undefined } : undefined,
      started: { iso: r.createdAt },
      completed: r.completedAt ? { iso: r.completedAt, state: "done" } : undefined,
    },
  };
}

function buildGroups(rows: ApiProcessRun[]): TableGroup[] {
  const buckets = new Map<PrStatus, ApiProcessRun[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const b = buckets.get(r.status);
    if (b) b.push(r);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(runToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "ACTIVE");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",    type: "status" },
  { id: "sop",       label: "SOP",       type: "text" },
  { id: "category",  label: "Category",  type: "text" },
  { id: "progress",  label: "Progress",  type: "progress" },
  { id: "due",       label: "Due",       type: "date" },
  { id: "started",   label: "Started",   type: "date" },
  { id: "completed", label: "Completed", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ProcessRunsPage() {
  const [rows, setRows] = useState<ApiProcessRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/process-runs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("process-runs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      if (value !== "CANCELLED") {
        toast("Progress is driven by step completion — open the run to advance it");
        throw new Error("not supported");
      }
      const res = await fetch("/api/process-runs", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, action: "cancel" }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can cancel process runs");
        throw new Error(`PATCH ${res.status}`);
      }
      void load();
    },
    onAdd: async (_g: string) => {
      toast("Start a process run from the SOP itself — open a checklist SOP and click Start run");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? [])
      .filter((r) => r.dueDate || r.completedAt)
      .map((r): CalendarEvent => ({
        id: r.id,
        title: r.title,
        date: (r.completedAt ?? r.dueDate) as string,
        color: STATUS_COLORS[r.status],
        done: r.status === "COMPLETED",
        payload: runToRow(r).cells,
      })),
    [rows],
  );

  const activeCount = (rows ?? []).filter((r) => r.status === "ACTIVE").length;
  const overdueCount = (rows ?? []).filter((r) => r.status === "OVERDUE").length;

  return (
    <>
      <OsTitleBar
        title="Process runs"
        Icon={ListChecks}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading runs…" : `${rows.length} run${rows.length === 1 ? "" : "s"} · ${activeCount} active${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Start run" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={ListChecks} iconGradient={GRAD.redPink} title="Couldn't load process runs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={ListChecks} iconGradient={GRAD.orangePink} title="No process runs yet" subtitle="Process runs are instances of checklist SOPs. Open a checklist SOP and click Start run to assign it to someone." chips={["Checklist", "Assignee", "Due date", "Share link"]} cta="Browse SOPs" />
          ) : (
            <OsMainTable moduleId="process-runs" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="process-runs" events={calendarEvents} newLabel="Start run" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={ListChecks} iconGradient={GRAD.orangePink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
