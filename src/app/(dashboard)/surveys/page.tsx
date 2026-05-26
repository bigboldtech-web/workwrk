"use client";

/* Real, persistent Surveys page (pulse surveys).
 *
 *  GET   /api/pulse-surveys             list
 *  POST  /api/pulse-surveys             { title, questions, audienceType?, frequency?, closesAt? }
 *  PATCH /api/pulse-surveys/[id]        { title?, status?, frequency?, closesAt? }  (manager+)
 *
 *  Status (string): DRAFT | ACTIVE | CLOSED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, ClipboardList, ChartPie, Calendar as CalendarIcon } from "lucide-react";
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

type SrStatus = "DRAFT" | "ACTIVE" | "CLOSED";

type ApiSurvey = {
  id: string;
  title: string;
  status: SrStatus;
  frequency?: string | null;
  audienceType: string;
  anonymous: boolean;
  questions?: unknown[];
  createdAt: string;
  closesAt?: string | null;
  closedAt?: string | null;
  responses?: { id: string }[];
  _count?: { responses?: number };
  // optional aggregate added server-side
  audienceSize?: number;
  responseRate?: number;
};

const STATUS_TO_OS: Record<SrStatus, StatusValue> = {
  DRAFT: "planning", ACTIVE: "working", CLOSED: "done",
};
const STATUS_LABELS: Record<SrStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", CLOSED: "Closed",
};
const STATUS_COLORS: Record<SrStatus, string> = {
  DRAFT: C.indigo, ACTIVE: C.orange, CLOSED: C.green,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as SrStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: SrStatus[] = ["DRAFT", "ACTIVE", "CLOSED"];

function surveyToRow(s: ApiSurvey): Row {
  const questionCount = Array.isArray(s.questions) ? s.questions.length : 0;
  const responses = s._count?.responses ?? s.responses?.length ?? 0;
  const audience = s.audienceSize ?? 0;
  const pct = audience > 0 ? Math.round((responses / audience) * 100) : 0;
  return {
    id: s.id,
    name: s.title,
    done: s.status === "CLOSED",
    cells: {
      status: { value: STATUS_TO_OS[s.status], label: STATUS_LABELS[s.status] },
      questions: `${questionCount}`,
      audience: s.audienceType,
      anonymous: s.anonymous ? "Yes" : "No",
      responses: `${responses}${audience ? ` / ${audience}` : ""}`,
      rate: audience > 0 ? { pct, color: pct >= 70 ? "green" : pct >= 30 ? "blue" : "warning" } : undefined,
      closes: s.closesAt ? { iso: s.closesAt } : undefined,
    },
  };
}

function buildGroups(rows: ApiSurvey[]): TableGroup[] {
  const buckets = new Map<SrStatus, ApiSurvey[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const s of rows) {
    const b = buckets.get(s.status);
    if (b) b.push(s);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(surveyToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "ACTIVE");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",     type: "status" },
  { id: "questions", label: "Questions",  type: "text" },
  { id: "audience",  label: "Audience",   type: "text" },
  { id: "anonymous", label: "Anonymous",  type: "text" },
  { id: "responses", label: "Responses",  type: "text" },
  { id: "rate",      label: "Response rate", type: "progress" },
  { id: "closes",    label: "Closes",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function SurveysPage() {
  const [rows, setRows] = useState<ApiSurvey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pulse-surveys");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("surveys");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/pulse-surveys/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can edit surveys");
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
      const ok = await patch(rowId, { title: name });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (_g: string) => {
      const res = await fetch("/api/pulse-surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled pulse",
          questions: [{ id: "q1", text: "How was your week?", type: "rating" }],
          audienceType: "ALL",
          anonymous: true,
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can create surveys");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const s: ApiSurvey = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: s.id, name: s.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? [])
      .filter((s) => s.closesAt)
      .map((s): CalendarEvent => ({
        id: s.id,
        title: `${s.title} closes`,
        date: s.closesAt as string,
        color: STATUS_COLORS[s.status],
        done: s.status === "CLOSED",
        payload: surveyToRow(s).cells,
      })),
    [rows],
  );

  const activeCount = (rows ?? []).filter((s) => s.status === "ACTIVE").length;

  return (
    <>
      <OsTitleBar
        title="Surveys"
        Icon={BarChart}
        iconGradient={GRAD.bluePurple}
        description={rows === null ? "Loading surveys…" : `${rows.length} survey${rows.length === 1 ? "" : "s"} · ${activeCount} active · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New pulse" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={BarChart} iconGradient={GRAD.redPink} title="Couldn't load surveys" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={BarChart} iconGradient={GRAD.bluePurple} title="No surveys yet" subtitle="Launch your first pulse survey. Anonymous by default so people speak freely." chips={["Rating", "NPS", "Free text", "Multiple choice"]} cta="New pulse" />
          ) : (
            <OsMainTable moduleId="surveys" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="surveys" events={calendarEvents} newLabel="New pulse" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={BarChart} iconGradient={GRAD.bluePurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
