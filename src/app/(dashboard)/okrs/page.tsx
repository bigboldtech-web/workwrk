"use client";

/* Real, persistent OKRs page.
 *
 *  GET   /api/okrs              list
 *  POST  /api/okrs              { title, level }
 *  PATCH /api/okrs              { id, status, title, progress, ... }
 *
 *  Status values (string field, not enum): ON_TRACK | AT_RISK | BEHIND | COMPLETED
 *  Levels: COMPANY | TEAM | INDIVIDUAL
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type OkrStatus = "ON_TRACK" | "AT_RISK" | "BEHIND" | "COMPLETED";

type ApiOkr = {
  id: string;
  title: string;
  description?: string | null;
  level: "COMPANY" | "TEAM" | "INDIVIDUAL";
  status: OkrStatus;
  progress: number;
  startDate?: string | null;
  endDate?: string | null;
  quarter?: string | null;
  ownerId?: string | null;
  keyResults?: { id: string; title: string }[];
};

const STATUS_TO_OS: Record<OkrStatus, StatusValue> = {
  ON_TRACK: "working",
  AT_RISK: "pending",
  BEHIND: "stuck",
  COMPLETED: "done",
};
const STATUS_LABELS: Record<OkrStatus, string> = {
  ON_TRACK: "On track", AT_RISK: "At risk", BEHIND: "Behind", COMPLETED: "Completed",
};
const STATUS_COLORS: Record<OkrStatus, string> = {
  ON_TRACK: C.green, AT_RISK: C.yellow, BEHIND: C.red, COMPLETED: C.sage,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as OkrStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const LEVEL_COLORS: Record<ApiOkr["level"], string> = {
  COMPANY: C.purple, TEAM: C.blue, INDIVIDUAL: C.teal,
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { initials: s.slice(0, 2).toUpperCase(), color: AV_PALETTE[h % AV_PALETTE.length] };
}

const GROUP_ORDER: ApiOkr["level"][] = ["COMPANY", "TEAM", "INDIVIDUAL"];
const LEVEL_LABELS: Record<ApiOkr["level"], string> = {
  COMPANY: "Company OKRs", TEAM: "Team OKRs", INDIVIDUAL: "Individual OKRs",
};

function okrToRow(o: ApiOkr): Row {
  return {
    id: o.id,
    name: o.title,
    done: o.status === "COMPLETED",
    cells: {
      status: { value: STATUS_TO_OS[o.status], label: STATUS_LABELS[o.status] },
      owner: o.ownerId ? [avatarFor(o.ownerId)] : [],
      progress: { pct: Math.max(0, Math.min(100, o.progress)), color: o.status === "COMPLETED" ? "green" : o.status === "AT_RISK" ? "warning" : o.status === "BEHIND" ? "danger" : "green" },
      quarter: o.quarter ?? "—",
      krs: o.keyResults && o.keyResults.length > 0 ? `${o.keyResults.length} KRs` : "—",
      end: o.endDate ? { iso: o.endDate } : undefined,
    },
  };
}

function buildGroups(okrs: ApiOkr[]): TableGroup[] {
  const buckets = new Map<ApiOkr["level"], ApiOkr[]>();
  for (const l of GROUP_ORDER) buckets.set(l, []);
  for (const o of okrs) {
    const b = buckets.get(o.level);
    if (b) b.push(o);
  }
  return GROUP_ORDER
    .map((l) => ({
      id: l, title: LEVEL_LABELS[l], color: LEVEL_COLORS[l],
      rows: (buckets.get(l) ?? []).map(okrToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "INDIVIDUAL");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Health",   type: "status" },
  { id: "owner",    label: "Owner",    type: "person" },
  { id: "progress", label: "Progress", type: "progress" },
  { id: "quarter",  label: "Quarter",  type: "text" },
  { id: "krs",      label: "Key results", type: "text" },
  { id: "end",      label: "Ends",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function OkrsPage() {
  const [okrs, setOkrs] = useState<ApiOkr[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/okrs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOkrs(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("okrs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(okrs ?? []), [okrs]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/okrs", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const prog = value === "COMPLETED" ? 100 : undefined;
      await patch(rowId, { status: value, ...(prog !== undefined ? { progress: prog } : {}) });
      void load();
    },
    onToggleDone: async (rowId: string, _g: string, done: boolean) => {
      await patch(rowId, { status: done ? "COMPLETED" : "ON_TRACK", progress: done ? 100 : 0 });
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      await patch(rowId, { title: name });
    },
    onAdd: async (groupId: string) => {
      const res = await fetch("/api/okrs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled objective", level: groupId }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const o: ApiOkr = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: o.id, name: o.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (okrs ?? [])
      .filter((o) => o.endDate)
      .map((o): CalendarEvent => ({
        id: o.id, title: o.title, date: o.endDate as string,
        color: STATUS_COLORS[o.status], done: o.status === "COMPLETED",
        payload: okrToRow(o).cells,
      })),
    [okrs],
  );

  const activeCount = (okrs ?? []).filter((o) => o.status !== "COMPLETED").length;

  return (
    <>
      <OsTitleBar
        title="OKRs"
        Icon={Target}
        iconGradient={GRAD.indigoBlue}
        description={okrs === null ? "Loading objectives…" : `${okrs.length} objective${okrs.length === 1 ? "" : "s"} · ${activeCount} active · live-synced`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.pr]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New objective" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Target} iconGradient={GRAD.redPink} title="Couldn't load OKRs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : okrs === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : okrs.length === 0 ? (
            <OsEmptyView Icon={Target} iconGradient={GRAD.indigoBlue} title="No OKRs yet" subtitle="Set your first objective using '+ Add objective' below. Pick Company / Team / Individual to start." chips={["Company", "Team", "Individual"]} cta="New objective" />
          ) : (
            <OsMainTable moduleId="okrs" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="okrs" events={calendarEvents} newLabel="New objective" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Target} iconGradient={GRAD.indigoBlue} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
