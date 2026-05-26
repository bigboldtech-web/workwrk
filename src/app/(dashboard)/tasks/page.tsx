"use client";

/* Real, persistent Tasks page.
 *
 * - GET /api/tasks on mount → groups by date (Today/This week/Later/Done)
 * - PATCH /api/tasks on status / priority / checkbox / inline rename
 * - POST /api/tasks on "+ Add item"
 * All mutations are optimistic with rollback on failure (handled inside
 * OsMainTable via the `handlers` prop).
 *
 * Status mapping:
 *   OS "planning" ↔ Prisma PLANNED
 *   OS "working"  ↔ Prisma IN_PROGRESS
 *   OS "done"     ↔ Prisma COMPLETED
 * Priority mapping:
 *   OS "low"|"medium"|"high"|"critical" ↔ Prisma LOW|NORMAL|HIGH|URGENT
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, ClipboardList, Boxes, Calendar as CalendarIcon, BarChart, ChartPie } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue, type PrioValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PickerOption } from "@/components/layout/os/picker-popover";

// ─── Type for the Task shape returned by /api/tasks ──────────
type ApiTask = {
  id: string;
  title: string;
  date: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  completedAt?: string | null;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
  labels?: { label: { id: string; name: string; color?: string | null } }[];
  _count?: { comments?: number };
};

// ─── Mappings ────────────────────────────────────────────────
const STATUS_API_TO_OS: Record<ApiTask["status"], StatusValue> = {
  PLANNED: "planning",
  IN_PROGRESS: "working",
  COMPLETED: "done",
};
const STATUS_OS_TO_API: Partial<Record<StatusValue, ApiTask["status"]>> = {
  planning: "PLANNED",
  working: "IN_PROGRESS",
  done: "COMPLETED",
};
const PRIO_API_TO_OS: Record<ApiTask["priority"], PrioValue> = {
  LOW: "low",
  NORMAL: "medium",
  HIGH: "high",
  URGENT: "critical",
};
const PRIO_OS_TO_API: Partial<Record<PrioValue, ApiTask["priority"]>> = {
  low: "LOW",
  medium: "NORMAL",
  high: "HIGH",
  critical: "URGENT",
};

const TASK_STATUS_OPTIONS: PickerOption[] = [
  { value: "planning", label: "Planned",     color: C.indigo },
  { value: "working",  label: "In progress", color: C.orange },
  { value: "done",     label: "Done",        color: C.green },
];

// Stable hash → palette color so each unique assignee gets a consistent avatar color
const AVATAR_COLORS = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarColorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initialsFor(first?: string | null, last?: string | null) {
  const f = (first ?? "").trim()[0] ?? "";
  const l = (last ?? "").trim()[0] ?? "";
  return ((f + l) || "?").toUpperCase();
}

// Map a Task row's label color hex → nearest os palette name
const LABEL_COLORS = ["green", "orange", "red", "blue", "purple", "pink", "indigo", "teal", "lime", "brown", "yellow"] as const;
function labelColorFor(hex?: string | null, fallbackSeed = "") {
  if (hex) {
    // very simple bucketing — pick by 1st char of hex hash
    const h = hex.toLowerCase().replace("#", "");
    const code = parseInt(h.slice(0, 2), 16) || 0;
    return LABEL_COLORS[code % LABEL_COLORS.length];
  }
  let h = 0;
  for (let i = 0; i < fallbackSeed.length; i++) h = (h * 31 + fallbackSeed.charCodeAt(i)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}

// ─── Grouping ────────────────────────────────────────────────
const MS_DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function buildGroups(tasks: ApiTask[]): TableGroup[] {
  const today = startOfDay(new Date()).getTime();
  const weekEnd = today + 7 * MS_DAY;
  const monthAgo = today - 30 * MS_DAY;

  const buckets: { id: string; title: string; color: string; rows: Row[] }[] = [
    { id: "today",     title: "Today",       color: C.orange, rows: [] },
    { id: "this-week", title: "This week",   color: C.blue,   rows: [] },
    { id: "later",     title: "Later",       color: C.indigo, rows: [] },
    { id: "overdue",   title: "Overdue",     color: C.red,    rows: [] },
    { id: "done",      title: "Done — last 30 days", color: C.green, rows: [] },
  ];

  for (const t of tasks) {
    const due = startOfDay(new Date(t.date)).getTime();
    const isDone = t.status === "COMPLETED";
    const row = taskToRow(t);

    if (isDone) {
      const completedAt = t.completedAt ? new Date(t.completedAt).getTime() : due;
      if (completedAt >= monthAgo) buckets[4].rows.push(row);
    } else if (due < today) {
      buckets[3].rows.push(row);
    } else if (due === today) {
      buckets[0].rows.push(row);
    } else if (due <= weekEnd) {
      buckets[1].rows.push(row);
    } else {
      buckets[2].rows.push(row);
    }
  }

  // Don't show empty Overdue group unless there are any
  return buckets.filter((b) => b.rows.length > 0 || b.id === "today" || b.id === "this-week");
}

function taskToRow(t: ApiTask): Row {
  const due = new Date(t.date);
  const today0 = startOfDay(new Date()).getTime();
  const due0 = startOfDay(due).getTime();
  const dateState: "today" | "overdue" | "done" | undefined =
    t.status === "COMPLETED" ? "done"
    : due0 < today0 ? "overdue"
    : due0 === today0 ? "today"
    : undefined;

  const owner = t.assignee
    ? [{
        initials: initialsFor(t.assignee.firstName, t.assignee.lastName),
        color: avatarColorFor(t.assignee.id),
      }]
    : [];

  const tags = (t.labels ?? []).map((l) => ({
    label: l.label.name,
    color: labelColorFor(l.label.color, l.label.id),
  }));

  return {
    id: t.id,
    name: t.title,
    done: t.status === "COMPLETED",
    cells: {
      status: { value: STATUS_API_TO_OS[t.status] },
      prio:   { value: PRIO_API_TO_OS[t.priority] },
      owner,
      due:    { iso: t.date, state: dateState },
      tags,
      updates: { count: t._count?.comments ?? 0 },
    },
  };
}

// ─── Columns ────────────────────────────────────────────────
const COLUMNS: Column[] = [
  { id: "status", label: "Status",   type: "status" },
  { id: "owner",  label: "Owner",    type: "person" },
  { id: "due",    label: "Due",      type: "date" },
  { id: "prio",   label: "Priority", type: "priority" },
  { id: "tags",   label: "Labels",   type: "tags" },
  { id: "updates",label: "Updates",  type: "updates" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "kanban",    label: "Kanban",     Icon: Boxes },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

// ─── Page ────────────────────────────────────────────────────
export default function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");

  const load = useCallback(async () => {
    try {
      // Pull a wide window — last 30d through next 90d — so all 5 buckets
      // have data to draw from.
      const from = new Date(Date.now() - 30 * MS_DAY).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 90 * MS_DAY).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      setTasks(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Subscribe to row-version bumps so we re-fetch when something else
  // (drawer, Sidekick tool call, etc.) mutates a task elsewhere.
  const { rowVersion } = useOsShell();
  const tasksVersion = rowVersion("tasks");
  useEffect(() => {
    if (tasksVersion > 0) void load();
  }, [tasksVersion, load]);

  const groups = useMemo(() => buildGroups(tasks ?? []), [tasks]);

  // Calendar events — one per task, colored by status
  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      date: t.date,
      color:
        t.status === "COMPLETED" ? C.green
        : t.status === "IN_PROGRESS" ? C.orange
        : C.indigo,
      done: t.status === "COMPLETED",
      payload: taskToRow(t).cells,
    })),
    [tasks],
  );

  // ─── Persistence handlers ─────────────────────────────────
  async function patchTask(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _groupId: string, value: string) => {
      const apiStatus = STATUS_OS_TO_API[value as StatusValue];
      if (!apiStatus) return; // OS status not mapped to a Task status; skip
      await patchTask(rowId, { status: apiStatus });
      void load(); // re-fetch so the row migrates to the right group
    },
    onPrioChange: async (rowId: string, _groupId: string, value: string) => {
      const apiPrio = PRIO_OS_TO_API[value as PrioValue];
      if (!apiPrio) return;
      await patchTask(rowId, { priority: apiPrio });
    },
    onToggleDone: async (rowId: string, _groupId: string, done: boolean) => {
      await patchTask(rowId, { status: done ? "COMPLETED" : "IN_PROGRESS" });
      void load();
    },
    onRename: async (rowId: string, _groupId: string, name: string) => {
      await patchTask(rowId, { title: name });
    },
    onAdd: async (groupId: string) => {
      // pick a due date that matches the group bucket
      const today = startOfDay(new Date());
      let date = today;
      if (groupId === "this-week") date = new Date(today.getTime() + 2 * MS_DAY);
      else if (groupId === "later") date = new Date(today.getTime() + 10 * MS_DAY);
      else if (groupId === "overdue") date = today; // can't really add to past
      else if (groupId === "done") date = today;

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled task",
          date: date.toISOString(),
          allDay: true,
        }),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const created = await res.json();
      const task = created.data ?? created;
      // Re-fetch in the background so the row appears in its proper bucket
      // (the helper-added temp row stays visible until the fetch returns).
      setTimeout(() => void load(), 200);
      return { id: task.id, name: task.title };
    },
  };

  return (
    <>
      <OsTitleBar
        title="My tasks"
        Icon={CheckSquare}
        iconGradient={GRAD.bluePurple}
        description={
          tasks === null
            ? "Loading your tasks…"
            : `${tasks.length} task${tasks.length === 1 ? "" : "s"} · live-synced with /api/tasks`
        }
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.ak]}
        morePeople={9}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New task" activeFilters={0} />
          {loadError ? (
            <OsEmptyView
              Icon={CheckSquare}
              iconGradient={GRAD.redPink}
              title="Couldn't load tasks"
              subtitle={`API error: ${loadError}. Check your connection and try again.`}
              chips={["Retry", "Check /api/tasks"]}
              cta="Retry"
            />
          ) : tasks === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>
              Loading your tasks…
            </div>
          ) : tasks.length === 0 ? (
            <OsEmptyView
              Icon={CheckSquare}
              iconGradient={GRAD.bluePurple}
              title="No tasks yet"
              subtitle="Click '+ Add item' below in any group, or use Sidekick (⌘J) to create your first task."
              chips={["⌘J for Sidekick", "+ Add item"]}
              cta="Add your first task"
            />
          ) : (
            <OsMainTable
              moduleId="tasks"
              columns={COLUMNS}
              groups={groups}
              statusOptions={TASK_STATUS_OPTIONS}
              handlers={handlers}
            />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="tasks" events={calendarEvents} newLabel="New task" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView
          Icon={CheckSquare}
          iconGradient={GRAD.bluePurple}
          title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`}
          subtitle="This view will share the same live data as Main table — just visualized differently. Persistence already works on the Main table; switch back to it to try."
          chips={["Live data", "Persistent edits", "Drag-and-drop"]}
          cta="Back to Main table"
        />
      )}
    </>
  );
}
