"use client";

/* My tasks — personal focus queue.
 *
 * Not a board. Not a table. A calm vertical queue with 4 buckets:
 *   Overdue · Today · This week · Later  (+ a Done-today recap pinned bottom)
 *
 * Each task is a single line: round check · title · priority dot · due chip ·
 * (optional) assigner avatar. Click the circle to complete, double-click title
 * to rename, type at the bottom of any column to add.
 *
 * GET  /api/tasks?assigneeId=me&startDate=…&endDate=…
 * PATCH /api/tasks   { id, status?, title?, date?, priority? }
 * POST  /api/tasks   { title, date, allDay }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, AlertCircle, Sun, CalendarDays, Clock, Plus, Sparkles, ChevronRight, Flame } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type ApiStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";

type ApiTask = {
  id: string;
  title: string;
  date: string;
  status: ApiStatus;
  priority: ApiPrio;
  completedAt?: string | null;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  labels?: { label: { id: string; name: string; color?: string | null } }[];
};

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

const PRIO_COLOR: Record<ApiPrio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};
const PRIO_LABEL: Record<ApiPrio, string> = {
  URGENT: "Urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low",
};

type Bucket = "overdue" | "today" | "week" | "later" | "done";
const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "Overdue", today: "Today", week: "This week", later: "Later", done: "Done today",
};
const BUCKET_ICON: Record<Bucket, React.ComponentType<{ className?: string }>> = {
  overdue: AlertCircle, today: Sun, week: CalendarDays, later: Clock, done: CheckSquare,
};
const BUCKET_HUE: Record<Bucket, string> = {
  overdue: "var(--os-c-red)", today: "var(--os-c-orange)", week: "var(--os-c-blue)", later: "var(--os-c-indigo)", done: "var(--os-c-green)",
};

function bucketFor(t: ApiTask): Bucket {
  const today0 = startOfDay(new Date()).getTime();
  const due0 = startOfDay(new Date(t.date)).getTime();
  if (t.status === "COMPLETED") {
    const completedAt = t.completedAt ? new Date(t.completedAt).getTime() : due0;
    return completedAt >= today0 ? "done" : "later"; // older completes drop out via filter
  }
  if (due0 < today0) return "overdue";
  if (due0 === today0) return "today";
  if (due0 <= today0 + 6 * MS_DAY) return "week";
  return "later";
}

function dueChip(t: ApiTask): { label: string; tone: "danger" | "today" | "muted" | "good" } {
  const today0 = startOfDay(new Date()).getTime();
  const due0 = startOfDay(new Date(t.date)).getTime();
  if (t.status === "COMPLETED") return { label: "Done", tone: "good" };
  const days = Math.round((due0 - today0) / MS_DAY);
  if (days < 0) return { label: `${-days}d late`, tone: "danger" };
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "muted" };
  if (days <= 6) return { label: new Date(due0).toLocaleDateString("en-US", { weekday: "short" }), tone: "muted" };
  return { label: new Date(due0).toLocaleDateString("en-US", { month: "short", day: "numeric" }), tone: "muted" };
}

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5)  return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Wrapping up";
};

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<Bucket, string>>({ overdue: "", today: "", week: "", later: "", done: "" });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const from = new Date(Date.now() - 14 * MS_DAY).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 60 * MS_DAY).toISOString().slice(0, 10);
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
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const grouped = useMemo(() => {
    const buckets: Record<Bucket, ApiTask[]> = { overdue: [], today: [], week: [], later: [], done: [] };
    for (const t of tasks ?? []) {
      const b = bucketFor(t);
      // hide completed tasks unless they were completed today
      if (t.status === "COMPLETED" && b !== "done") continue;
      buckets[b].push(t);
    }
    // sort each bucket: priority desc, then due asc
    const prioRank: Record<ApiPrio, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    for (const k of Object.keys(buckets) as Bucket[]) {
      buckets[k].sort((a, b) => {
        const p = prioRank[a.priority] - prioRank[b.priority];
        if (p !== 0) return p;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
    }
    return buckets;
  }, [tasks]);

  async function patch(id: string, body: Record<string, unknown>) {
    // optimistic
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, ...body, status: (body.status as ApiStatus) ?? t.status, completedAt: body.status === "COMPLETED" ? new Date().toISOString() : t.completedAt } as ApiTask : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch (e) {
      toast("Couldn't save — refreshing");
      void load();
    }
  }

  async function completeTask(t: ApiTask) {
    if (t.status === "COMPLETED") {
      await patch(t.id, { status: "IN_PROGRESS" });
    } else {
      await patch(t.id, { status: "COMPLETED" });
    }
  }

  async function addTask(bucket: Bucket, title: string) {
    if (!title.trim()) return;
    const today = startOfDay(new Date()).getTime();
    let date = today;
    if (bucket === "week") date = today + 3 * MS_DAY;
    else if (bucket === "later") date = today + 14 * MS_DAY;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), date: new Date(date).toISOString(), allDay: true }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      setDrafts((d) => ({ ...d, [bucket]: "" }));
      void load();
    } catch {
      toast("Couldn't add task");
    }
  }

  async function rename(id: string, title: string) {
    if (!title.trim()) return setRenamingId(null);
    setRenamingId(null);
    await patch(id, { title: title.trim() });
  }

  async function snoozeToTomorrow(t: ApiTask) {
    const tomorrow = startOfDay(new Date(Date.now() + MS_DAY)).toISOString();
    await patch(t.id, { date: tomorrow });
    void load();
  }

  const overdueCount = grouped.overdue.length;
  const todayCount = grouped.today.length;
  const doneToday = grouped.done.length;

  // Workload: count tasks by bucket for the right-rail summary
  const upcomingThisWeek = grouped.today.length + grouped.week.length;
  const focusScore = todayCount === 0 ? 100 : Math.round((doneToday / (todayCount + doneToday)) * 100);

  if (loadError) {
    return (
      <div className="my-tasks">
        <div className="my-tasks__error">
          <AlertCircle />
          <div>
            <strong>Couldn&apos;t load your tasks</strong>
            <p>{loadError}</p>
            <button type="button" onClick={() => { setLoadError(null); void load(); }} className="my-tasks__retry">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-tasks">
      <header className="my-tasks__head">
        <div className="my-tasks__hello">
          <div className="my-tasks__hello-greet">{greeting()}.</div>
          <h1 className="my-tasks__hello-title">
            {tasks === null ? "Loading your day…" :
              todayCount === 0 && overdueCount === 0
                ? "Nothing on your plate today."
                : overdueCount > 0
                  ? <>You have <strong>{overdueCount} overdue</strong> and <strong>{todayCount} due today</strong>.</>
                  : <>You have <strong>{todayCount}</strong> task{todayCount === 1 ? "" : "s"} for today.</>}
          </h1>
        </div>
        <div className="my-tasks__stats">
          <div className="my-tasks__stat">
            <span className="my-tasks__stat-label">Overdue</span>
            <span className="my-tasks__stat-val" style={{ color: overdueCount > 0 ? "var(--os-c-red)" : "var(--os-ink-3)" }}>{overdueCount}</span>
          </div>
          <div className="my-tasks__stat">
            <span className="my-tasks__stat-label">Today</span>
            <span className="my-tasks__stat-val">{todayCount}</span>
          </div>
          <div className="my-tasks__stat">
            <span className="my-tasks__stat-label">This week</span>
            <span className="my-tasks__stat-val">{upcomingThisWeek}</span>
          </div>
          <div className="my-tasks__stat">
            <span className="my-tasks__stat-label">Focus</span>
            <span className="my-tasks__stat-val" style={{ color: focusScore >= 70 ? "var(--os-c-green)" : focusScore >= 40 ? "var(--os-c-orange)" : "var(--os-c-red)" }}>{focusScore}%</span>
          </div>
        </div>
      </header>

      <div className="my-tasks__cols">
        {(["overdue", "today", "week", "later", "done"] as Bucket[]).map((bucket) => {
          const items = grouped[bucket];
          if (bucket === "overdue" && items.length === 0) return null;
          if (bucket === "done" && items.length === 0) return null;
          const Icon = BUCKET_ICON[bucket];
          const hue = BUCKET_HUE[bucket];
          return (
            <section key={bucket} className={`my-tasks__col my-tasks__col--${bucket}`}>
              <header className="my-tasks__col-head" style={{ borderTop: `3px solid ${hue}` }}>
                <div className="my-tasks__col-head-l">
                  <Icon />
                  <span>{BUCKET_LABEL[bucket]}</span>
                  <span className="my-tasks__col-count">{items.length}</span>
                </div>
              </header>

              <div className="my-tasks__col-body">
                {items.length === 0 ? (
                  <div className="my-tasks__col-empty">{bucket === "today" ? "Clear inbox. Nice." : "Nothing here."}</div>
                ) : (
                  items.map((t) => {
                    const chip = dueChip(t);
                    const isRenaming = renamingId === t.id;
                    return (
                      <article key={t.id} className={`task ${t.status === "COMPLETED" ? "task--done" : ""}`}>
                        <button
                          type="button"
                          aria-label={t.status === "COMPLETED" ? "Mark incomplete" : "Mark complete"}
                          className="task__check"
                          onClick={() => completeTask(t)}
                        >
                          <span className="task__check-dot" style={{ borderColor: PRIO_COLOR[t.priority] }}>
                            {t.status === "COMPLETED" && <span className="task__check-tick">✓</span>}
                          </span>
                        </button>

                        <div className="task__main">
                          {isRenaming ? (
                            <input
                              defaultValue={t.title}
                              autoFocus
                              onBlur={(e) => void rename(t.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void rename(t.id, e.currentTarget.value);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="task__title-input"
                            />
                          ) : (
                            <button
                              type="button"
                              className="task__title"
                              onDoubleClick={() => setRenamingId(t.id)}
                              title="Double-click to rename"
                            >
                              {t.title || <em style={{ color: "var(--os-ink-3)" }}>Untitled</em>}
                            </button>
                          )}

                          <div className="task__meta">
                            {t.priority === "URGENT" || t.priority === "HIGH" ? (
                              <span className="task__prio" style={{ color: PRIO_COLOR[t.priority] }}>
                                <Flame /> {PRIO_LABEL[t.priority]}
                              </span>
                            ) : null}
                            <span className={`task__chip task__chip--${chip.tone}`}>{chip.label}</span>
                            {(t.labels ?? []).slice(0, 2).map((l) => (
                              <span key={l.label.id} className="task__tag">{l.label.name}</span>
                            ))}
                            {(t.labels?.length ?? 0) > 2 ? <span className="task__tag">+{(t.labels?.length ?? 0) - 2}</span> : null}
                          </div>
                        </div>

                        {bucket === "overdue" || bucket === "today" ? (
                          <button
                            type="button"
                            className="task__snooze"
                            onClick={() => snoozeToTomorrow(t)}
                            title="Snooze to tomorrow"
                          >
                            <ChevronRight />
                          </button>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>

              {bucket !== "done" && bucket !== "overdue" ? (
                <div className="my-tasks__add">
                  <Plus />
                  <input
                    type="text"
                    value={drafts[bucket]}
                    onChange={(e) => setDrafts((d) => ({ ...d, [bucket]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") void addTask(bucket, drafts[bucket]); }}
                    placeholder={`Add to ${BUCKET_LABEL[bucket].toLowerCase()}…`}
                  />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <footer className="my-tasks__foot">
        <div className="my-tasks__hint">
          <Sparkles />
          <span>Double-click a title to rename · Click the circle to complete · Type below any column to add</span>
        </div>
      </footer>
    </div>
  );
}
