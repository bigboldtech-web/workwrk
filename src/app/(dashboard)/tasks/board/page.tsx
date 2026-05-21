"use client";

// /tasks/board — monday-style BoardView over the org's tasks.
// Sibling to /tasks (the rich calendar/day/week/Gantt surface).
// Users who prefer the table/kanban/calendar strip pattern land
// here. The legacy calendar stays untouched for power users.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";

const TASK_FIELDS: BoardField[] = [
  { key: "title", label: "Title", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "PLANNED", label: "Planned", color: "#9CA3AF" },
      { value: "IN_PROGRESS", label: "In progress", color: "#F59E0B" },
      { value: "COMPLETED", label: "Done", color: "#10B981" },
    ] },
  },
  {
    key: "priority", label: "Priority", fieldType: "SELECT",
    options: { choices: [
      { value: "LOW", label: "Low", color: "#9CA3AF" },
      { value: "NORMAL", label: "Normal", color: "#60A5FA" },
      { value: "HIGH", label: "High", color: "#F59E0B" },
      { value: "URGENT", label: "Urgent", color: "#EF4444" },
    ] },
  },
  { key: "category", label: "Category", fieldType: "TEXT" },
  { key: "date", label: "Due", fieldType: "DATE" },
  { key: "hoursSpent", label: "Hours", fieldType: "NUMBER" },
];

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  category: string | null;
  date: string;
  hoursSpent: number | null;
  assigneeId: string | null;
  assignee?: { firstName: string | null; lastName: string | null } | null;
};

export default function TasksBoardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = await res.json();
      // jsonSuccess wraps in { data: [...] }; tolerate either shape.
      const list = Array.isArray(data) ? data : (data.data ?? data.tasks ?? []);
      setTasks(list);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="px-4 py-3 space-y-3">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Work</h1>
          <p className="text-xs text-muted">
            Every task in your workspace, monday-style. Table / Kanban / Calendar / Gallery — switch with the toolbar below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted hover:text-foreground hover:bg-surface-2"
          >
            <CalendarDays size={13} /> Calendar view
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="rounded-xl border border-border bg-surface text-center py-20 text-sm text-muted">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface text-center py-20">
          <p className="text-sm text-muted mb-3">No tasks yet.</p>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Plus size={13} /> Create your first task
          </Link>
        </div>
      ) : (
        <BoardView
          boardKey="tasks:board"
          items={tasks}
          fields={TASK_FIELDS}
          getId={(t) => t.id}
          getTitle={(t) => t.title}
          getValue={(t, key) => {
            const raw = (t as unknown as Record<string, unknown>)[key];
            if (key === "hoursSpent") return raw == null ? null : Number(raw);
            return raw;
          }}
          editableFields={["status", "priority"]}
          selectable
          onRowClick={(t) => setOpenTask(t)}
          onChangeField={async (id, key, value) => {
            await fetch("/api/tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            }).catch(() => {});
            await refresh();
            setOpenTask((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Task : prev);
          }}
          onBulkChange={async (ids, key, value) => {
            await Promise.all(ids.map((id) => fetch("/api/tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, [key]: value }),
            })));
            await refresh();
          }}
        />
      )}

      <ItemDetailDrawer
        open={!!openTask}
        onClose={() => setOpenTask(null)}
        item={openTask}
        title={openTask?.title ?? ""}
        entityType="TASK"
        fields={TASK_FIELDS}
        editableFields={["status", "priority"]}
        getValue={(t, k) => (t as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpenTask((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Task : prev);
        }}
      />
    </div>
  );
}
