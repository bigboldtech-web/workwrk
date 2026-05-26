"use client";

/* Real, persistent Timesheets page.
 *
 *  GET   /api/timesheets?scope=team|mine|approve|all
 *  POST  /api/timesheets               idempotent upsert for current week
 *  PATCH /api/timesheets/[id]          { action: submit | retract | decide }
 *
 *  Status enum: DRAFT | SUBMITTED | APPROVED | REJECTED
 *  Transitions (action-based):
 *    DRAFT → SUBMITTED                  { action: submit }
 *    SUBMITTED → DRAFT                  { action: retract }
 *    SUBMITTED → APPROVED | REJECTED    { action: decide, decision: APPROVE|REJECT }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type TsStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

type ApiTimesheet = {
  id: string;
  status: TsStatus;
  weekStartDate: string;
  totalMinutes?: number | null;
  submittedAt?: string | null;
  decisionAt?: string | null;
  user?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  _count?: { entries?: number };
};

const STATUS_TO_OS: Record<TsStatus, StatusValue> = {
  DRAFT: "planning", SUBMITTED: "pending", APPROVED: "done", REJECTED: "stuck",
};
const STATUS_LABELS: Record<TsStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Rejected",
};
const STATUS_COLORS: Record<TsStatus, string> = {
  DRAFT: C.indigo, SUBMITTED: C.yellow, APPROVED: C.green, REJECTED: C.red,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as TsStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }

const GROUP_ORDER: TsStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];

function tsToRow(t: ApiTimesheet): Row {
  const totalH = Math.round(((t.totalMinutes ?? 0) / 60) * 10) / 10;
  const weekStart = new Date(t.weekStartDate);
  const weekLabel = `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return {
    id: t.id,
    name: `${t.user ? `${t.user.firstName ?? ""} ${t.user.lastName ?? ""}`.trim() : "—"} · ${weekLabel}`,
    done: t.status === "APPROVED",
    cells: {
      status: { value: STATUS_TO_OS[t.status], label: STATUS_LABELS[t.status] },
      employee: t.user ? [{ initials: initials(t.user.firstName, t.user.lastName), color: avColor(t.user.id) }] : [],
      approver: t.approver ? [{ initials: initials(t.approver.firstName, t.approver.lastName), color: avColor(t.approver.id) }] : [],
      total: `${totalH}h`,
      entries: `${t._count?.entries ?? 0}`,
      week: { iso: t.weekStartDate },
    },
  };
}

function buildGroups(rows: ApiTimesheet[]): TableGroup[] {
  const buckets = new Map<TsStatus, ApiTimesheet[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const t of rows) {
    const b = buckets.get(t.status);
    if (b) b.push(t);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(tsToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "SUBMITTED");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Status",   type: "status" },
  { id: "employee", label: "Employee", type: "person" },
  { id: "approver", label: "Approver", type: "person" },
  { id: "total",    label: "Hours",    type: "text" },
  { id: "entries",  label: "Entries",  type: "text" },
  { id: "week",     label: "Week",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function TimesheetsPage() {
  const [rows, setRows] = useState<ApiTimesheet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      let res = await fetch("/api/timesheets?scope=team&limit=100");
      if (res.status === 403) {
        res = await fetch("/api/timesheets?scope=mine&limit=100");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("timesheets");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function transition(id: string, from: TsStatus, to: TsStatus): Promise<boolean> {
    if (from === to) return true;
    let body: Record<string, unknown> | null = null;
    if (from === "DRAFT" && to === "SUBMITTED") body = { action: "submit" };
    else if (from === "SUBMITTED" && to === "DRAFT") body = { action: "retract" };
    else if (from === "SUBMITTED" && to === "APPROVED") body = { action: "decide", decision: "APPROVE" };
    else if (from === "SUBMITTED" && to === "REJECTED") body = { action: "decide", decision: "REJECT" };
    if (!body) {
      toast(`Can't go from ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`);
      return false;
    }
    try {
      const res = await fetch(`/api/timesheets/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const r = (rows ?? []).find((x) => x.id === rowId);
      if (!r) return;
      const ok = await transition(rowId, r.status, value as TsStatus);
      if (!ok) throw new Error("illegal");
    },
    onAdd: async (_g: string) => {
      // Idempotent — upserts the current week's timesheet for the caller.
      const res = await fetch("/api/timesheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) { toast("Couldn't create"); throw new Error(`POST ${res.status}`); }
      const data = await res.json();
      const t: ApiTimesheet = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: t.id };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((r): CalendarEvent => ({
      id: r.id,
      title: `${r.user?.firstName ?? ""} · ${Math.round(((r.totalMinutes ?? 0) / 60) * 10) / 10}h`.trim(),
      date: r.weekStartDate,
      color: STATUS_COLORS[r.status],
      done: r.status === "APPROVED",
      payload: tsToRow(r).cells,
    })),
    [rows],
  );

  const pendingCount = (rows ?? []).filter((r) => r.status === "SUBMITTED").length;

  return (
    <>
      <OsTitleBar
        title="Timesheets"
        Icon={Clock}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading timesheets…" : `${rows.length} sheet${rows.length === 1 ? "" : "s"} · ${pendingCount} pending approval · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New entry" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Clock} iconGradient={GRAD.redPink} title="Couldn't load timesheets" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Clock} iconGradient={GRAD.indigoBlue} title="No timesheets yet" subtitle="Start your weekly timesheet with '+ New entry' below. Add hours via the web grid or clock in/out on Clock." chips={["Web entry", "Clock in/out", "Mobile", "Kiosk"]} cta="New entry" />
          ) : (
            <OsMainTable moduleId="timesheets" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="timesheets" events={calendarEvents} newLabel="New entry" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Clock} iconGradient={GRAD.indigoBlue} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
