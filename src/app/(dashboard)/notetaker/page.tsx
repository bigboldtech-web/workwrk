"use client";

/* Real Notetaker page (AI meeting notes archive).
 *
 *  Notetaker itself is a one-shot processor:
 *    POST /api/notetaker/process  — Claude extracts JSON from raw transcript
 *    POST /api/notetaker/save     — persists as Meeting + ActionItem rows
 *
 *  The board view here surfaces processed meetings (read-only). Adding new
 *  notes means uploading a transcript, which lives in the dedicated drawer
 *  flow — toast directs there.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mic, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type MeetingType = "DAILY_STANDUP" | "WEEKLY_REVIEW" | "ONE_ON_ONE" | "QUARTERLY_REVIEW" | "ANNUAL_PLANNING" | "ADHOC";

type ApiMeeting = {
  id: string;
  title: string;
  type: MeetingType;
  scheduledAt: string;
  duration: number;
  notes?: string | null;
  attendees?: Array<{ user?: { id: string; firstName?: string | null; lastName?: string | null } | null }>;
  stats?: {
    hasNotes: boolean;
    decisionCount: number;
    actionItemsTotal: number;
    actionItemsDone: number;
  };
  createdAt: string;
  updatedAt: string;
};

const TYPE_LABELS: Record<MeetingType, string> = {
  DAILY_STANDUP: "Daily standup", WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1", QUARTERLY_REVIEW: "Quarterly", ANNUAL_PLANNING: "Annual planning", ADHOC: "Ad-hoc",
};
const TYPE_COLORS: Record<MeetingType, string> = {
  DAILY_STANDUP: C.blue, WEEKLY_REVIEW: C.indigo, ONE_ON_ONE: C.purple,
  QUARTERLY_REVIEW: C.teal, ANNUAL_PLANNING: C.green, ADHOC: C.gray,
};
const TYPE_ORDER: MeetingType[] = ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

function meetingToRow(m: ApiMeeting): Row {
  const people = (m.attendees ?? []).slice(0, 4).flatMap((a) => a.user ? [{ initials: initials(a.user.firstName, a.user.lastName), color: avColor(a.user.id) }] : []);
  const aiTotal = m.stats?.actionItemsTotal ?? 0;
  const aiDone = m.stats?.actionItemsDone ?? 0;
  const actionPct = aiTotal === 0 ? 0 : Math.round((aiDone / aiTotal) * 100);
  return {
    id: m.id,
    name: m.title,
    done: aiTotal > 0 && aiDone === aiTotal,
    cells: {
      attendees: people,
      duration: `${m.duration} min`,
      decisions: `${m.stats?.decisionCount ?? 0}`,
      actions: aiTotal > 0
        ? { pct: actionPct, color: actionPct >= 100 ? "green" : actionPct >= 50 ? "blue" : "warning" }
        : undefined,
      hasNotes: m.stats?.hasNotes ? "✓" : "—",
      scheduled: { iso: m.scheduledAt },
    },
  };
}

function buildGroups(rows: ApiMeeting[]): TableGroup[] {
  const buckets = new Map<MeetingType, ApiMeeting[]>();
  for (const t of TYPE_ORDER) buckets.set(t, []);
  for (const m of rows) {
    const b = buckets.get(m.type);
    if (b) b.push(m);
  }
  return TYPE_ORDER
    .map((t) => ({
      id: t, title: TYPE_LABELS[t], color: TYPE_COLORS[t],
      rows: (buckets.get(t) ?? []).map(meetingToRow),
    }))
    .filter((g) => g.rows.length > 0);
}

const COLUMNS: Column[] = [
  { id: "attendees", label: "Attendees", type: "person" },
  { id: "duration",  label: "Duration",  type: "text" },
  { id: "decisions", label: "Decisions", type: "text" },
  { id: "actions",   label: "Actions",   type: "progress" },
  { id: "hasNotes",  label: "Notes",     type: "text" },
  { id: "scheduled", label: "Scheduled", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function NotetakerPage() {
  const [rows, setRows] = useState<ApiMeeting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiMeeting[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list.filter((m) => m.stats?.hasNotes || (m.stats?.decisionCount ?? 0) > 0 || (m.stats?.actionItemsTotal ?? 0) > 0));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("notetaker");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Open the notetaker drawer and paste your transcript — AI will extract decisions + actions");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((m): CalendarEvent => ({
      id: m.id,
      title: m.title,
      date: m.scheduledAt,
      color: TYPE_COLORS[m.type],
      payload: meetingToRow(m).cells,
    })),
    [rows],
  );

  const totalActions = (rows ?? []).reduce((acc, m) => acc + (m.stats?.actionItemsTotal ?? 0), 0);
  const totalDecisions = (rows ?? []).reduce((acc, m) => acc + (m.stats?.decisionCount ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Notetaker"
        Icon={Mic}
        iconGradient={GRAD.purpleIndigo}
        description={rows === null ? "Loading notes…" : `${rows.length} meeting${rows.length === 1 ? "" : "s"} processed · ${totalDecisions} decision${totalDecisions === 1 ? "" : "s"} · ${totalActions} action item${totalActions === 1 ? "" : "s"}`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Process transcript" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Mic} iconGradient={GRAD.redPink} title="Couldn't load notes" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Mic} iconGradient={GRAD.purpleIndigo} title="No processed transcripts yet" subtitle="Paste a meeting transcript — Claude extracts decisions, action items, and attendees. Optionally spawn tasks for each action." chips={["Transcript", "Decisions", "Actions", "Auto-tasks"]} cta="Process transcript" />
          ) : (
            <OsMainTable moduleId="notetaker" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="notetaker" events={calendarEvents} newLabel="Process transcript" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Mic} iconGradient={GRAD.purpleIndigo} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
