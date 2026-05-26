"use client";

/* Real Candor page (anonymous feedback sessions).
 *
 *  GET   /api/candor                list sessions visible to me
 *  POST  /api/candor                { title, prompts: string[], departmentId?, status? }
 *  PATCH /api/candor                { id, status: ACTIVE | CLOSED, ... }
 *
 *  Status enum: DRAFT | ACTIVE | CLOSED
 *  Responses are anonymous; we surface count + ownership.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircleHeart, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type CandorStatus = "DRAFT" | "ACTIVE" | "CLOSED";

type ApiCandor = {
  id: string;
  title: string;
  description?: string | null;
  prompts: string[] | unknown;
  status: CandorStatus;
  departmentId?: string | null;
  launchedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  createdBy: string;
  responseCount?: number;
  isOwner?: boolean;
};

const STATUS_TO_OS: Record<CandorStatus, StatusValue> = {
  DRAFT: "planning", ACTIVE: "working", CLOSED: "done",
};
const STATUS_LABELS: Record<CandorStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", CLOSED: "Closed",
};
const STATUS_COLORS: Record<CandorStatus, string> = {
  DRAFT: C.indigo, ACTIVE: C.orange, CLOSED: C.green,
};
const STATUS_OPTIONS: PickerOption[] = (["DRAFT", "ACTIVE", "CLOSED"] as CandorStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: CandorStatus[] = ["ACTIVE", "DRAFT", "CLOSED"];

function candorToRow(c: ApiCandor): Row {
  const promptCount = Array.isArray(c.prompts) ? c.prompts.length : 0;
  return {
    id: c.id,
    name: c.title,
    done: c.status === "CLOSED",
    cells: {
      status: { value: STATUS_TO_OS[c.status], label: STATUS_LABELS[c.status] },
      scope: c.departmentId ? "Department" : "Org-wide",
      prompts: `${promptCount} prompt${promptCount === 1 ? "" : "s"}`,
      responses: `${c.responseCount ?? 0}`,
      owner: c.isOwner ? "You" : "—",
      launched: c.launchedAt ? { iso: c.launchedAt } : undefined,
      closed: c.closedAt ? { iso: c.closedAt, state: "done" } : undefined,
    },
  };
}

function buildGroups(rows: ApiCandor[]): TableGroup[] {
  const buckets = new Map<CandorStatus, ApiCandor[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const c of rows) {
    const b = buckets.get(c.status);
    if (b) b.push(c);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(candorToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "ACTIVE");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",    type: "status" },
  { id: "scope",     label: "Scope",     type: "text" },
  { id: "prompts",   label: "Prompts",   type: "text" },
  { id: "responses", label: "Responses", type: "text" },
  { id: "owner",     label: "Owner",     type: "text" },
  { id: "launched",  label: "Launched",  type: "date" },
  { id: "closed",    label: "Closed",    type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CandorPage() {
  const [rows, setRows] = useState<ApiCandor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/candor");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("candor");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const row = (rows ?? []).find((r) => r.id === rowId);
      if (!row?.isOwner) {
        toast("Only the session creator can change status");
        throw new Error("not owner");
      }
      if (value === "DRAFT" && row.status !== "DRAFT") {
        toast("Once launched, a session can only go to Closed");
        throw new Error("illegal");
      }
      const res = await fetch("/api/candor", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, status: value }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can move Candor sessions");
        throw new Error(`PATCH ${res.status}`);
      }
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const res = await fetch("/api/candor", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, title: name }),
      });
      if (!res.ok) {
        if (res.status === 404) toast("Only the creator can rename this session");
        throw new Error(`PATCH ${res.status}`);
      }
    },
    onAdd: async (_g: string) => {
      const res = await fetch("/api/candor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled Candor",
          prompts: ["What's working well right now?", "What should we change?", "Anything else?"],
          status: "DRAFT",
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can create Candor sessions");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const c: ApiCandor = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: c.id, name: c.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? [])
      .filter((c) => c.launchedAt || c.closedAt)
      .map((c): CalendarEvent => ({
        id: c.id,
        title: `${c.title}${c.status === "CLOSED" ? " closed" : " launched"}`,
        date: (c.closedAt ?? c.launchedAt) as string,
        color: STATUS_COLORS[c.status],
        done: c.status === "CLOSED",
        payload: candorToRow(c).cells,
      })),
    [rows],
  );

  const activeCount = (rows ?? []).filter((r) => r.status === "ACTIVE").length;
  const totalResponses = (rows ?? []).reduce((acc, r) => acc + (r.responseCount ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Candor"
        Icon={MessageCircleHeart}
        iconGradient={GRAD.pinkPurple}
        description={rows === null ? "Loading sessions…" : `${rows.length} session${rows.length === 1 ? "" : "s"} · ${activeCount} active · ${totalResponses} anonymous response${totalResponses === 1 ? "" : "s"}`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={6}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New Candor" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={MessageCircleHeart} iconGradient={GRAD.redPink} title="Couldn't load sessions" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={MessageCircleHeart} iconGradient={GRAD.pinkPurple} title="No Candor sessions yet" subtitle="Run anonymous feedback rounds. Pick a scope (team or org), write 3-5 prompts, launch. Responses are 100% anonymous." chips={["Anonymous", "Department", "Org-wide"]} cta="New Candor" />
          ) : (
            <OsMainTable moduleId="candor" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="candor" events={calendarEvents} newLabel="New Candor" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={MessageCircleHeart} iconGradient={GRAD.pinkPurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
