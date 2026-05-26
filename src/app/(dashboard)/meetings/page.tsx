"use client";

/* Real, persistent Meetings page.
 *
 *  GET  /api/meetings           paginated { data: { items, ... } } (also enriched with `stats`)
 *  POST /api/meetings           { title, type, scheduledAt, duration?, agenda?, attendeeIds? }
 *  PUT  /api/meetings/[id]      { title?, type?, scheduledAt?, agenda?, notes?, decisions? }
 *
 *  No status enum — meetings are positioned in time. Groups:
 *    Today / This week / Upcoming / Past (last 30 days)
 *
 *  We render a "Type" pill in place of status (Daily standup / 1:1 /
 *  Weekly review / etc.) — color-coded by type.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, ClipboardList, Boxes, ChartPie, BarChart } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type MeetingType = "DAILY_STANDUP" | "WEEKLY_REVIEW" | "ONE_ON_ONE" | "QUARTERLY_REVIEW" | "ANNUAL_PLANNING" | "ADHOC";

type ApiAttendee = {
  id: string;
  userId: string;
  user?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
};

type ApiMeeting = {
  id: string;
  title: string;
  type: MeetingType;
  scheduledAt: string;
  duration: number;
  agenda?: string | null;
  notes?: string | null;
  attendees?: ApiAttendee[];
  stats?: { hasNotes?: boolean; decisionCount?: number; actionItemsTotal?: number; actionItemsDone?: number };
};

const TYPE_TO_OS: Record<MeetingType, StatusValue> = {
  DAILY_STANDUP: "working",
  WEEKLY_REVIEW: "review",
  ONE_ON_ONE: "progress",
  QUARTERLY_REVIEW: "planning",
  ANNUAL_PLANNING: "critical",
  ADHOC: "pending",
};
const TYPE_LABELS: Record<MeetingType, string> = {
  DAILY_STANDUP: "Daily standup",
  WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1",
  QUARTERLY_REVIEW: "Quarterly review",
  ANNUAL_PLANNING: "Annual planning",
  ADHOC: "Ad hoc",
};
const TYPE_COLORS: Record<MeetingType, string> = {
  DAILY_STANDUP: C.orange,
  WEEKLY_REVIEW: C.purple,
  ONE_ON_ONE: C.blue,
  QUARTERLY_REVIEW: C.indigo,
  ANNUAL_PLANNING: C.pink,
  ADHOC: C.yellow,
};

const TYPE_OPTIONS: PickerOption[] = (Object.keys(TYPE_LABELS) as MeetingType[]).map((t) => ({
  value: t, label: TYPE_LABELS[t], color: TYPE_COLORS[t],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarColorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function initialsFor(first?: string | null, last?: string | null) {
  const f = (first ?? "").trim()[0] ?? "";
  const l = (last ?? "").trim()[0] ?? "";
  return ((f + l) || "?").toUpperCase();
}

const MS_DAY = 24 * 60 * 60 * 1000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function meetingToRow(m: ApiMeeting): Row {
  const when = new Date(m.scheduledAt);
  const today0 = startOfDay(new Date()).getTime();
  const due0 = startOfDay(when).getTime();
  const dateState: "today" | "overdue" | "done" | undefined =
    due0 === today0 ? "today" :
    due0 < today0 ? "done" : undefined;

  const owners = (m.attendees ?? [])
    .slice(0, 3)
    .map((a) => ({
      initials: a.user ? initialsFor(a.user.firstName, a.user.lastName) : "?",
      color: avatarColorFor(a.userId),
    }));

  const ai = m.stats;
  const actionsLabel = ai && ai.actionItemsTotal
    ? `${ai.actionItemsDone ?? 0} / ${ai.actionItemsTotal} done`
    : "—";

  return {
    id: m.id,
    name: m.title,
    done: due0 < today0,
    cells: {
      type: { value: TYPE_TO_OS[m.type], label: TYPE_LABELS[m.type] },
      owner: owners,
      when: { iso: m.scheduledAt, state: dateState },
      duration: `${m.duration} min`,
      actions: actionsLabel,
    },
  };
}

function buildGroups(meetings: ApiMeeting[]): TableGroup[] {
  const today0 = startOfDay(new Date()).getTime();
  const weekEnd = today0 + 7 * MS_DAY;
  const monthAgo = today0 - 30 * MS_DAY;

  const buckets: { id: string; title: string; color: string; rows: Row[] }[] = [
    { id: "today",     title: "Today",       color: C.orange, rows: [] },
    { id: "this-week", title: "This week",   color: C.blue,   rows: [] },
    { id: "upcoming",  title: "Upcoming",    color: C.indigo, rows: [] },
    { id: "past",      title: "Past (30d)",  color: C.green,  rows: [] },
  ];
  for (const m of meetings) {
    const due0 = startOfDay(new Date(m.scheduledAt)).getTime();
    const row = meetingToRow(m);
    if (due0 < today0) {
      if (due0 >= monthAgo) buckets[3].rows.push(row);
    } else if (due0 === today0) buckets[0].rows.push(row);
    else if (due0 <= weekEnd) buckets[1].rows.push(row);
    else buckets[2].rows.push(row);
  }
  return buckets.filter((b) => b.rows.length > 0 || b.id === "today" || b.id === "this-week");
}

const COLUMNS: Column[] = [
  { id: "type",     label: "Type",       type: "status" },
  { id: "owner",    label: "Attendees",  type: "person" },
  { id: "when",     label: "When",       type: "date" },
  { id: "duration", label: "Duration",   type: "text" },
  { id: "actions",  label: "Action items", type: "text" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "kanban",    label: "Kanban",     Icon: Boxes },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<ApiMeeting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // GET returns { data: { items, total, ... } } via paginatedResult
      const list: ApiMeeting[] = data?.data?.items
        ?? data?.data?.data
        ?? data?.items
        ?? (Array.isArray(data?.data) ? data.data : [])
        ?? (Array.isArray(data) ? data : []);
      setMeetings(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("meetings");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(meetings ?? []), [meetings]);

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (meetings ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      date: m.scheduledAt,
      color: TYPE_COLORS[m.type],
      payload: meetingToRow(m).cells,
    })),
    [meetings],
  );

  async function putMeeting(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      await putMeeting(rowId, { type: value });
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      await putMeeting(rowId, { title: name });
    },
    onAdd: async (groupId: string) => {
      // Pick a sensible scheduledAt per group
      const now = new Date();
      let scheduledAt = new Date();
      if (groupId === "today") {
        scheduledAt.setHours(now.getHours() + 1, 0, 0, 0);
      } else if (groupId === "this-week") {
        scheduledAt = new Date(now.getTime() + 2 * MS_DAY);
        scheduledAt.setHours(10, 0, 0, 0);
      } else if (groupId === "upcoming") {
        scheduledAt = new Date(now.getTime() + 10 * MS_DAY);
        scheduledAt.setHours(10, 0, 0, 0);
      } else {
        scheduledAt = new Date(now.getTime() + 60 * 60 * 1000);
      }
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled meeting",
          type: "ADHOC",
          scheduledAt: scheduledAt.toISOString(),
          duration: 30,
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const m: ApiMeeting = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: m.id, name: m.title };
    },
  };

  const upcomingCount = (meetings ?? []).filter((m) => new Date(m.scheduledAt).getTime() > Date.now()).length;

  return (
    <>
      <OsTitleBar
        title="Meetings"
        Icon={CalendarIcon}
        iconGradient={GRAD.pinkPurple}
        description={meetings === null ? "Loading meetings…" : `${meetings.length} meeting${meetings.length === 1 ? "" : "s"} · ${upcomingCount} upcoming · live-synced`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.pr]}
        morePeople={9}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New meeting" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={CalendarIcon} iconGradient={GRAD.redPink} title="Couldn't load meetings" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : meetings === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading meetings…</div>
          ) : meetings.length === 0 ? (
            <OsEmptyView Icon={CalendarIcon} iconGradient={GRAD.pinkPurple} title="No meetings yet" subtitle="Schedule your first meeting via '+ Add meeting' below, or sync with Google Calendar to auto-import." chips={["Daily standup", "Weekly review", "1:1", "Ad hoc"]} cta="New meeting" />
          ) : (
            <OsMainTable moduleId="meetings" columns={COLUMNS} groups={groups} statusOptions={TYPE_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="meetings" events={calendarEvents} newLabel="New meeting" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView
          Icon={CalendarIcon}
          iconGradient={GRAD.pinkPurple}
          title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`}
          subtitle="This view will share the same live data as Main table. Persistence already works there."
          chips={["Live data", "Persistent edits"]}
          cta="Back to Main table"
        />
      )}
    </>
  );
}
