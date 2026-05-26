"use client";

/* Real Learning page.
 *
 *  GET  /api/courses              list catalog (any role)
 *  POST /api/courses              { title, mandatory?, category?, duration? } (manager+)
 *
 *  Courses have no status enum. We bucket by `mandatory` (Mandatory vs
 *  Optional) and a third "Recent" group for items added in the last
 *  14 days, surfaced first so newly-added courses are visible at a glance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiCourse = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  duration?: number | null;
  mandatory: boolean;
  createdAt: string;
  _count?: { enrollments?: number };
};

const MS_DAY = 86400_000;

function courseToRow(c: ApiCourse): Row {
  const hours = c.duration ? Math.round((c.duration / 60) * 10) / 10 : null;
  return {
    id: c.id,
    name: c.title,
    cells: {
      status: { value: (c.mandatory ? "critical" : "progress") as StatusValue, label: c.mandatory ? "Mandatory" : "Optional" },
      category: c.category ?? "—",
      duration: hours ? `${hours}h` : "—",
      enrollments: `${c._count?.enrollments ?? 0}`,
      added: { iso: c.createdAt },
    },
  };
}

function buildGroups(courses: ApiCourse[]): TableGroup[] {
  const recentCutoff = Date.now() - 14 * MS_DAY;
  const recent = courses.filter((c) => new Date(c.createdAt).getTime() >= recentCutoff);
  const mandatory = courses.filter((c) => c.mandatory && new Date(c.createdAt).getTime() < recentCutoff);
  const optional = courses.filter((c) => !c.mandatory && new Date(c.createdAt).getTime() < recentCutoff);

  return [
    { id: "recent",    title: "Recent (last 14 days)", color: C.orange,  rows: recent.map(courseToRow) },
    { id: "mandatory", title: "Mandatory",              color: C.pink,    rows: mandatory.map(courseToRow) },
    { id: "optional",  title: "Optional",               color: C.teal,    rows: optional.map(courseToRow) },
  ].filter((g) => g.rows.length > 0 || g.id === "mandatory" || g.id === "optional");
}

const COLUMNS: Column[] = [
  { id: "status",      label: "Type",        type: "status" },
  { id: "category",    label: "Category",    type: "text" },
  { id: "duration",    label: "Duration",    type: "text" },
  { id: "enrollments", label: "Enrolled",    type: "text" },
  { id: "added",       label: "Added",       type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function LearningPage() {
  const [courses, setCourses] = useState<ApiCourse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/courses");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCourses(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("learning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(courses ?? []), [courses]);

  const handlers = {
    onRename: async (rowId: string, _g: string, name: string) => {
      // No PATCH endpoint exists for courses yet — block rename gracefully.
      toast("Course editing isn't wired yet");
      throw new Error("not supported");
    },
    onAdd: async (groupId: string) => {
      const mandatory = groupId === "mandatory";
      const res = await fetch("/api/courses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled course", mandatory }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can create courses");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const c: ApiCourse = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: c.id, name: c.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (courses ?? []).map((c): CalendarEvent => ({
      id: c.id,
      title: `${c.mandatory ? "★ " : ""}${c.title}`,
      date: c.createdAt,
      color: c.mandatory ? C.pink : C.teal,
      payload: courseToRow(c).cells,
    })),
    [courses],
  );

  const mandatoryCount = (courses ?? []).filter((c) => c.mandatory).length;
  const totalEnrolled = (courses ?? []).reduce((acc, c) => acc + (c._count?.enrollments ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Learning"
        Icon={GraduationCap}
        iconGradient={GRAD.indigoBlue}
        description={courses === null ? "Loading catalog…" : `${courses.length} course${courses.length === 1 ? "" : "s"} · ${mandatoryCount} mandatory · ${totalEnrolled} enrollments`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New course" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={GraduationCap} iconGradient={GRAD.redPink} title="Couldn't load courses" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : courses === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : courses.length === 0 ? (
            <OsEmptyView Icon={GraduationCap} iconGradient={GRAD.indigoBlue} title="No courses yet" subtitle="Publish your first course. Mandatory courses appear at the top of each employee's training tab." chips={["Compliance", "Onboarding", "Security", "Leadership"]} cta="New course" />
          ) : (
            <OsMainTable moduleId="learning" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="learning" events={calendarEvents} newLabel="New course" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={GraduationCap} iconGradient={GRAD.indigoBlue} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
