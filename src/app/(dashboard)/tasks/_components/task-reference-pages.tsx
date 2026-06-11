"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot, CalendarDays, Eye, ChevronDown, ChevronRight, Check, Flag, Loader2,
  Lock, Plus, Settings, Star, Zap,
  type LucideIcon,
} from "lucide-react";
import { TaskListSurface } from "./task-list-surface";

export function AssignedToMeReferencePage() {
  return (
    <TaskSurface title="Assigned to me" titlePrefix="My Wrk">
      <TaskListSurface
        initialAssignedOnly
        initialGroupBy="dueDate"
        initialSortKey="dueDate"
        initialVisibleColumns={["priority", "dueDate"]}
      />
    </TaskSurface>
  );
}

export function TodayOverdueReferencePage() {
  return (
    <TaskSurface title="Today & Overdue">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5 p-2.5">
        <MyWorkPanel />

        <section className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white !p-4">
          <h2 className="text-[14px] font-semibold text-zinc-900">Agenda</h2>
          <div className="flex flex-1 items-center justify-center text-center">
            <div className="w-full max-w-[360px]">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-zinc-300">
                <CalendarDays className="h-10 w-10" />
              </span>
              <p className="mx-auto mb-4 max-w-[260px] text-[12px] leading-5 text-zinc-600">
                Connect your calendar to view upcoming events and join your next call
              </p>
              <CalendarConnect label="Google Calendar" />
              <CalendarConnect label="Microsoft Outlook" />
            </div>
          </div>
        </section>
      </div>
    </TaskSurface>
  );
}

export function PersonalListReferencePage() {
  return (
    <TaskSurface
      title="Personal List"
      titlePrefix="My Wrk"
      headerRight={
        <div className="flex items-center gap-3 text-[12.5px] text-zinc-600">
          <span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4" />View</span>
          <span className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4" />Automate</span>
          <span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4" />Ask</span>
        </div>
      }
    >
      <TaskListSurface />
    </TaskSurface>
  );
}

function TaskSurface({
  title,
  titlePrefix,
  headerRight,
  children,
}: {
  title: string;
  titlePrefix?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-200 !px-4">
        <div
          role="heading"
          aria-level={1}
          className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold leading-5 text-zinc-900"
        >
          {titlePrefix ? <span className="shrink-0 font-medium text-zinc-500">{titlePrefix} /</span> : null}
          <span className="truncate">{title}</span>
          {title === "Personal List" ? (
            <>
              <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-700" />
              <Star className="h-4 w-4 shrink-0 text-zinc-500" />
            </>
          ) : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </header>
      {children}
    </div>
  );
}

function IconButton({ Icon, label, framed }: { Icon: LucideIcon; label: string; framed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-100 ${
        framed ? "border border-zinc-200" : ""
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function CalendarConnect({ label }: { label: string }) {
  return (
    <div className="mb-2 flex h-9 items-center justify-between rounded-lg border border-zinc-200 bg-white !px-2.5 text-left shadow-sm">
      <span className="text-[12.5px] font-medium text-zinc-800">{label}</span>
      <button type="button" className="rounded-md bg-zinc-100 !px-2 py-1 text-[12px] text-zinc-600">
        Connect
      </button>
    </div>
  );
}

// ─────────────────────────── My Work panel ───────────────────────────
// Real "Today & Overdue" work list: tabs (To Do / Done / Delegated) and
// due-date buckets (Today / Overdue / Next / Unscheduled). Backed by the
// legacy Task model via /api/tasks (defaults to the current user).

type WorkApiTask = {
  id: string;
  title: string;
  date?: string | null;
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assignee?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};
type WorkTask = {
  id: string;
  title: string;
  dueISO: string | null;
  done: boolean;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" | null;
  assigneeName?: string;
};

function mapWorkTask(t: WorkApiTask): WorkTask {
  const name = [t.assignee?.firstName, t.assignee?.lastName].filter(Boolean).join(" ").trim();
  return {
    id: t.id,
    title: t.title,
    dueISO: t.date ?? null,
    done: t.status === "COMPLETED",
    priority: t.priority ?? null,
    assigneeName: name || t.assignee?.email || undefined,
  };
}

const WORK_GROUPS = ["Today", "Overdue", "Next", "Unscheduled"] as const;
type WorkGroup = (typeof WORK_GROUPS)[number];

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "#ef4444", HIGH: "#eab308", NORMAL: "#3b82f6", LOW: "#94a3b8",
};

function startOfDayLocal(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDaysLocal(d: Date, n: number) { const x = startOfDayLocal(d); x.setDate(x.getDate() + n); return x; }

function bucketOf(dueISO: string | null, today: Date): WorkGroup {
  if (!dueISO) return "Unscheduled";
  const d = startOfDayLocal(new Date(dueISO));
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  if (d.getTime() < today.getTime()) return "Overdue";
  if (d.getTime() === today.getTime()) return "Today";
  return "Next";
}

function fmtDue(dueISO: string | null, today: Date): string {
  if (!dueISO) return "";
  const d = startOfDayLocal(new Date(dueISO));
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MyWorkPanel() {
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"todo" | "done" | "delegated">("todo");
  const [collapsed, setCollapsed] = useState<Record<WorkGroup, boolean>>({ Today: false, Overdue: false, Next: true, Unscheduled: true });
  const [composerGroup, setComposerGroup] = useState<WorkGroup | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [delegated, setDelegated] = useState<WorkTask[]>([]);
  const [delegatedState, setDelegatedState] = useState<"idle" | "loading" | "loaded">("idle");
  const today = useMemo(() => startOfDayLocal(new Date()), []);

  const load = useCallback(async () => {
    try {
      const data = await fetch("/api/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : []));
      setTasks((Array.isArray(data) ? data : []).map(mapWorkTask));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Lazy-load delegated tasks the first time that tab is opened.
  useEffect(() => {
    if (tab !== "delegated" || delegatedState !== "idle") return;
    setDelegatedState("loading");
    fetch("/api/tasks?view=delegated", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDelegated((Array.isArray(data) ? data : []).map(mapWorkTask)))
      .catch(() => setDelegated([]))
      .finally(() => setDelegatedState("loaded"));
  }, [tab, delegatedState]);

  const toggleDone = async (task: WorkTask) => {
    setBusyId(task.id);
    const next = !task.done;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)));
    try {
      await fetch("/api/tasks", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: task.id, status: next ? "COMPLETED" : "PLANNED" }) });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !next } : t)));
    } finally {
      setBusyId(null);
    }
  };

  const addTask = async (group: WorkGroup) => {
    const title = draft.trim();
    setComposerGroup(null);
    setDraft("");
    if (!title) return;
    const due = group === "Unscheduled" ? null : group === "Next" ? addDaysLocal(today, 1) : group === "Overdue" ? addDaysLocal(today, -1) : today;
    try {
      const created = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, status: "PLANNED", ...(due ? { date: due.toISOString() } : {}) }),
      }).then((r) => (r.ok ? r.json() : null));
      if (created?.id) {
        setTasks((prev) => [...prev, mapWorkTask(created)]);
      } else {
        void load();
      }
    } catch {
      void load();
    }
  };

  const visible = tab === "done" ? tasks.filter((t) => t.done) : tasks.filter((t) => !t.done);
  const grouped = useMemo(() => {
    const m: Record<WorkGroup, WorkTask[]> = { Today: [], Overdue: [], Next: [], Unscheduled: [] };
    if (tab === "todo") for (const t of visible) m[bucketOf(t.dueISO, today)].push(t);
    return m;
  }, [visible, tab, today]);

  return (
    <section className="relative flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white !p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[14px] font-semibold text-zinc-900">My Work</h2>
        <IconButton Icon={Settings} label="Settings" />
      </div>

      <div className="flex items-center gap-4 border-b border-zinc-100 mb-1">
        {(["todo", "done", "delegated"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`relative pb-2 text-[13px] ${tab === key ? "text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-700"}`}>
            {key === "todo" ? "To Do" : key === "done" ? "Done" : "Delegated"}
            {tab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 rounded-full" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : tab === "delegated" ? (
          delegatedState === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : delegated.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-zinc-400">You haven’t delegated any tasks.</div>
          ) : (
            <div className="py-1">{delegated.map((t) => <TaskRow key={t.id} task={t} today={today} busy={busyId === t.id} onToggle={() => toggleDone(t)} showAssignee />)}</div>
          )
        ) : tab === "done" ? (
          visible.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-zinc-400">Nothing completed yet.</div>
          ) : (
            <div className="py-1">{visible.map((t) => <TaskRow key={t.id} task={t} today={today} busy={busyId === t.id} onToggle={() => toggleDone(t)} />)}</div>
          )
        ) : (
          WORK_GROUPS.map((g) => {
            const items = grouped[g];
            const open = !collapsed[g];
            return (
              <div key={g} className="py-0.5">
                <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))} className="flex items-center gap-1.5 w-full text-left py-1.5">
                  {open ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                  <span className={`text-[13px] font-medium ${g === "Overdue" && items.length > 0 ? "text-red-500" : "text-zinc-700"}`}>{g}</span>
                  <span className="text-[12px] text-zinc-400">{items.length}</span>
                </button>
                {open && (
                  <div className="pl-5">
                    {items.map((t) => <TaskRow key={t.id} task={t} today={today} busy={busyId === t.id} onToggle={() => toggleDone(t)} />)}
                    {items.length === 0 && g === "Today" && composerGroup !== g && (
                      <p className="py-1.5 text-[12px] text-zinc-400">Tasks and reminders assigned to you will show here.</p>
                    )}
                    {composerGroup === g ? (
                      <div className="flex items-center gap-2 py-1.5">
                        <span className="w-4 h-4 rounded-full border border-dashed border-zinc-300 shrink-0" />
                        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addTask(g); if (e.key === "Escape") { setComposerGroup(null); setDraft(""); } }} onBlur={() => void addTask(g)} placeholder="Task name" className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400" />
                      </div>
                    ) : (g === "Today" || g === "Next" || g === "Unscheduled") ? (
                      <button type="button" onClick={() => { setComposerGroup(g); setDraft(""); }} className="flex items-center gap-1.5 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-600">
                        <Plus className="w-3.5 h-3.5" /> Add task
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function TaskRow({ task, today, busy, onToggle, showAssignee }: { task: WorkTask; today: Date; busy: boolean; onToggle: () => void; showAssignee?: boolean }) {
  const dueLabel = fmtDue(task.dueISO, today);
  const overdue = !task.done && bucketOf(task.dueISO, today) === "Overdue";
  return (
    <div className="group flex items-center gap-2.5 py-1.5 border-b border-zinc-50 last:border-0">
      <button type="button" onClick={onToggle} disabled={busy} className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${task.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-zinc-300 hover:border-emerald-500"}`}>
        {task.done && <Check className="w-3 h-3" />}
      </button>
      <span className={`flex-1 text-[13px] truncate ${task.done ? "line-through text-zinc-400" : "text-zinc-800"}`}>{task.title}</span>
      {showAssignee && task.assigneeName && (
        <span className="text-[11px] text-zinc-500 bg-zinc-100 rounded-full px-2 py-0.5 shrink-0 truncate max-w-[120px]">{task.assigneeName}</span>
      )}
      {task.priority && <Flag className="w-3.5 h-3.5 shrink-0" style={{ color: PRIORITY_COLOR[task.priority] }} />}
      {dueLabel && <span className={`text-[12px] shrink-0 ${overdue ? "text-red-500" : "text-zinc-400"}`}>{dueLabel}</span>}
    </div>
  );
}
