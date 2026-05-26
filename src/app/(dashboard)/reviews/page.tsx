"use client";

/* Real, persistent Review Cycles page.
 *
 *  GET   /api/reviews             list cycles (paginated)
 *  POST  /api/reviews             { name, type, startDate, endDate }
 *  PATCH /api/reviews             { id, name?, type?, status?, startDate?, endDate? }
 *
 *  CycleStatus: DRAFT | ACTIVE | IN_CALIBRATION | COMPLETED | CANCELLED
 *  ReviewType:  MONTHLY_PULSE | QUARTERLY | ANNUAL | PROBATION | PIP_REVIEW
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type CycleStatus = "DRAFT" | "ACTIVE" | "IN_CALIBRATION" | "COMPLETED" | "CANCELLED";

type ApiCycle = {
  id: string;
  name: string;
  type: string;
  status: CycleStatus;
  startDate: string;
  endDate: string;
  reviews?: { id: string; status: string }[];
  _count?: { reviews?: number };
};

const STATUS_TO_OS: Record<CycleStatus, StatusValue> = {
  DRAFT: "planning", ACTIVE: "working", IN_CALIBRATION: "review",
  COMPLETED: "done", CANCELLED: "empty",
};
const STATUS_LABELS: Record<CycleStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", IN_CALIBRATION: "In calibration",
  COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<CycleStatus, string> = {
  DRAFT: C.indigo, ACTIVE: C.orange, IN_CALIBRATION: C.purple,
  COMPLETED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as CycleStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: CycleStatus[] = ["DRAFT", "ACTIVE", "IN_CALIBRATION", "COMPLETED"];

function cycleToRow(c: ApiCycle): Row {
  const reviews = c.reviews ?? [];
  const total = c._count?.reviews ?? reviews.length;
  const done = reviews.filter((r) => r.status === "COMPLETED").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return {
    id: c.id,
    name: c.name,
    done: c.status === "COMPLETED",
    cells: {
      status: { value: STATUS_TO_OS[c.status], label: STATUS_LABELS[c.status] },
      type: c.type.replace(/_/g, " "),
      progress: { pct, color: c.status === "COMPLETED" ? "green" : pct >= 70 ? "blue" : pct >= 30 ? "warning" : "danger" },
      reviewers: total > 0 ? `${done} / ${total}` : "—",
      start: c.startDate ? { iso: c.startDate } : undefined,
      end: c.endDate ? { iso: c.endDate } : undefined,
    },
  };
}

function buildGroups(cycles: ApiCycle[]): TableGroup[] {
  const buckets = new Map<CycleStatus, ApiCycle[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const c of cycles) {
    if (c.status === "CANCELLED") continue;
    const b = buckets.get(c.status);
    if (b) b.push(c);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(cycleToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "ACTIVE");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",   type: "status" },
  { id: "type",      label: "Type",     type: "text" },
  { id: "progress",  label: "Progress", type: "progress" },
  { id: "reviewers", label: "Reviews",  type: "text" },
  { id: "start",     label: "Starts",   type: "date" },
  { id: "end",       label: "Ends",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ReviewsPage() {
  const [cycles, setCycles] = useState<ApiCycle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiCycle[] = data?.data?.items ?? data?.data?.data ?? data?.items ?? (Array.isArray(data?.data) ? data.data : []) ?? (Array.isArray(data) ? data : []);
      setCycles(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("reviews");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(cycles ?? []), [cycles]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/reviews", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      await patch(rowId, { status: value });
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      await patch(rowId, { name });
    },
    onAdd: async (groupId: string) => {
      // Need name + type + startDate + endDate per the create schema
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const res = await fetch("/api/reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled review cycle",
          type: "QUARTERLY",
          startDate: now.toISOString(),
          endDate: end.toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const c: ApiCycle = data.data ?? data;
      if (groupId !== "DRAFT" && (GROUP_ORDER as string[]).includes(groupId)) {
        void patch(c.id, { status: groupId });
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
        color: STATUS_COLORS[c.status], done: c.status === "COMPLETED",
        payload: cycleToRow(c).cells,
      })),
    [cycles],
  );

  const activeCount = (cycles ?? []).filter((c) => c.status === "ACTIVE" || c.status === "IN_CALIBRATION").length;

  return (
    <>
      <OsTitleBar
        title="Performance reviews"
        Icon={Award}
        iconGradient={GRAD.purpleIndigo}
        description={cycles === null ? "Loading cycles…" : `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} · ${activeCount} active · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.pr]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New cycle" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Award} iconGradient={GRAD.redPink} title="Couldn't load cycles" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : cycles === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : cycles.length === 0 ? (
            <OsEmptyView Icon={Award} iconGradient={GRAD.purpleIndigo} title="No review cycles yet" subtitle="Plan your first review cycle using '+ Add cycle'. Pick monthly pulse, quarterly, annual, probation, or PIP." chips={["Monthly pulse", "Quarterly", "Annual", "Probation", "PIP"]} cta="New cycle" />
          ) : (
            <OsMainTable moduleId="reviews" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="reviews" events={calendarEvents} newLabel="New cycle" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Award} iconGradient={GRAD.purpleIndigo} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
