"use client";

/* Real Activity feed page.
 *
 *  GET /api/activity?scope=team|my|all&limit=200
 *
 *  Read-only stream of ActivityLog rows. Groups by day (Today / Yesterday /
 *  earlier ISO date). Activity itself is generated as a side effect of other
 *  modules — no add/edit here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiActivity = {
  id: string;
  type: string;
  description: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
  actor?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

function typeColor(t: string): string {
  if (t.includes("create") || t.includes("start") || t.includes("add")) return C.green;
  if (t.includes("delete") || t.includes("cancel") || t.includes("remove")) return C.red;
  if (t.includes("update") || t.includes("edit") || t.includes("rename")) return C.blue;
  if (t.includes("complete") || t.includes("done") || t.includes("publish")) return C.teal;
  return C.indigo;
}

function dayKey(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function actToRow(a: ApiActivity): Row {
  return {
    id: a.id,
    name: a.description,
    cells: {
      actor: a.actor ? [{ initials: initials(a.actor.firstName, a.actor.lastName), color: avColor(a.actor.id) }] : [],
      type: a.type.replace(/_/g, " "),
      target: a.targetType ? a.targetType.replace(/_/g, " ") : "—",
      when: { iso: a.createdAt },
    },
  };
}

function buildGroups(rows: ApiActivity[]): TableGroup[] {
  const byDay = new Map<string, { color: string; items: ApiActivity[] }>();
  const palette = [C.indigo, C.purple, C.blue, C.teal, C.green, C.orange, C.pink];
  let idx = 0;
  for (const a of rows) {
    const key = dayKey(a.createdAt);
    if (!byDay.has(key)) {
      byDay.set(key, { color: key === "Today" ? C.green : key === "Yesterday" ? C.blue : palette[idx++ % palette.length], items: [] });
    }
    byDay.get(key)!.items.push(a);
  }
  return Array.from(byDay.entries()).map(([day, { color, items }]) => ({
    id: day, title: day, color,
    rows: items.map(actToRow),
  }));
}

const COLUMNS: Column[] = [
  { id: "actor",  label: "Actor",  type: "person" },
  { id: "type",   label: "Type",   type: "text" },
  { id: "target", label: "Target", type: "text" },
  { id: "when",   label: "When",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ActivityPage() {
  const [rows, setRows] = useState<ApiActivity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?scope=team&limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiActivity[] = data?.data?.data ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("activity");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).slice(0, 200).map((a): CalendarEvent => ({
      id: a.id,
      title: a.description.length > 60 ? a.description.slice(0, 60) + "…" : a.description,
      date: a.createdAt,
      color: typeColor(a.type),
      payload: actToRow(a).cells,
    })),
    [rows],
  );

  const todayCount = (rows ?? []).filter((a) => dayKey(a.createdAt) === "Today").length;

  return (
    <>
      <OsTitleBar
        title="Activity feed"
        Icon={Activity}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading activity…" : `${rows.length} event${rows.length === 1 ? "" : "s"}${todayCount > 0 ? ` · ${todayCount} today` : ""} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={8}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Activity} iconGradient={GRAD.redPink} title="Couldn't load activity" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Activity} iconGradient={GRAD.orangePink} title="No activity yet" subtitle="As your team uses WorkwrK — creating tasks, posting updates, moving deals — every action shows up here in real time." chips={["Tasks", "Deals", "Tickets", "Onboarding"]} cta="Explore modules" />
          ) : (
            <OsMainTable moduleId="activity" columns={COLUMNS} groups={groups} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="activity" events={calendarEvents} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Activity} iconGradient={GRAD.orangePink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
