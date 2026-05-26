"use client";

/* Real, persistent Payroll page (pay runs).
 *
 *  GET  /api/pay-runs               list
 *  POST /api/pay-runs               { payGroupId, periodStart, periodEnd, payDate }
 *  PATCH /api/pay-runs/[id]         { action: calculate | post | cancel }
 *
 *  Status enum: DRAFT | CALCULATING | CALCULATED | POSTED | CANCELLED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDollarSign, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type PrStatus = "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";

type ApiPayRun = {
  id: string;
  status: PrStatus;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  totalGross?: number | string | null;
  totalNet?: number | string | null;
  totalTax?: number | string | null;
  totalDeductions?: number | string | null;
  payGroup?: { id: string; name: string } | null;
  _count?: { payslips?: number };
};

const STATUS_TO_OS: Record<PrStatus, StatusValue> = {
  DRAFT: "planning", CALCULATING: "working", CALCULATED: "review",
  POSTED: "done", CANCELLED: "empty",
};
const STATUS_LABELS: Record<PrStatus, string> = {
  DRAFT: "Draft", CALCULATING: "Calculating", CALCULATED: "Calculated",
  POSTED: "Posted", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<PrStatus, string> = {
  DRAFT: C.indigo, CALCULATING: C.orange, CALCULATED: C.purple,
  POSTED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (["DRAFT", "CALCULATED", "POSTED", "CANCELLED"] as PrStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

function num(v?: number | string | null) { if (v === null || v === undefined) return 0; return typeof v === "string" ? parseFloat(v) : v; }
function actionFor(from: PrStatus, to: PrStatus): string | null {
  if (from === to) return null;
  if (from === "DRAFT" && to === "CALCULATED") return "calculate";
  if (from === "CALCULATED" && to === "POSTED") return "post";
  if (to === "CANCELLED") return "cancel";
  return null;
}

const GROUP_ORDER: PrStatus[] = ["DRAFT", "CALCULATING", "CALCULATED", "POSTED"];

function runToRow(r: ApiPayRun): Row {
  const period = `${new Date(r.periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${new Date(r.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return {
    id: r.id,
    name: `${r.payGroup?.name ?? "Pay group"} · ${period}`,
    done: r.status === "POSTED",
    cells: {
      status: { value: STATUS_TO_OS[r.status], label: STATUS_LABELS[r.status] },
      group: r.payGroup?.name ?? "—",
      gross: num(r.totalGross),
      net: num(r.totalNet),
      payslips: `${r._count?.payslips ?? 0}`,
      payDate: { iso: r.payDate },
    },
  };
}

function buildGroups(runs: ApiPayRun[]): TableGroup[] {
  const buckets = new Map<PrStatus, ApiPayRun[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const r of runs) {
    if (r.status === "CANCELLED") continue;
    const b = buckets.get(r.status);
    if (b) b.push(r);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(runToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "CALCULATED");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Status",   type: "status" },
  { id: "group",    label: "Pay group", type: "text" },
  { id: "gross",    label: "Gross",    type: "number", currency: "₹" },
  { id: "net",      label: "Net",      type: "number", currency: "₹" },
  { id: "payslips", label: "Payslips", type: "text" },
  { id: "payDate",  label: "Pay date", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function PayrollPage() {
  const [runs, setRuns] = useState<ApiPayRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pay-runs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("payroll");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(runs ?? []), [runs]);

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const r = (runs ?? []).find((x) => x.id === rowId);
      if (!r) return;
      const action = actionFor(r.status, value as PrStatus);
      if (!action) {
        toast(`Can't go from ${STATUS_LABELS[r.status]} → ${STATUS_LABELS[value as PrStatus]}`);
        throw new Error("illegal");
      }
      const res = await fetch(`/api/pay-runs/${rowId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can move payroll");
        throw new Error(`PATCH ${res.status}`);
      }
      void load();
    },
    onAdd: async (_g: string) => {
      toast("New pay runs need a pay group + period — use the payroll setup flow");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (runs ?? []).map((r): CalendarEvent => ({
      id: r.id,
      title: `${r.payGroup?.name ?? "Pay run"} · ₹${num(r.totalNet).toLocaleString()}`,
      date: r.payDate,
      color: STATUS_COLORS[r.status],
      done: r.status === "POSTED",
      payload: runToRow(r).cells,
    })),
    [runs],
  );

  const draftCount = (runs ?? []).filter((r) => r.status === "DRAFT" || r.status === "CALCULATED").length;
  const totalNet = (runs ?? []).reduce((acc, r) => r.status === "POSTED" ? acc + num(r.totalNet) : acc, 0);

  return (
    <>
      <OsTitleBar
        title="Payroll"
        Icon={CircleDollarSign}
        iconGradient={GRAD.greenTeal}
        description={runs === null ? "Loading pay runs…" : `${runs.length} pay run${runs.length === 1 ? "" : "s"} · ${draftCount} in flight · ₹${totalNet.toLocaleString()} posted`}
        people={[PEOPLE.bb, PEOPLE.vn]}
        morePeople={2}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New pay run" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.redPink} title="Couldn't load pay runs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : runs === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : runs.length === 0 ? (
            <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.greenTeal} title="No pay runs yet" subtitle="Set up your first pay group, then run payroll. The picker moves a run through Draft → Calculated → Posted." chips={["Draft", "Calculate", "Post", "Cancel"]} cta="Configure payroll" />
          ) : (
            <OsMainTable moduleId="payroll" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="payroll" events={calendarEvents} newLabel="New pay run" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
