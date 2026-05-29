"use client";

/* Tasks · Sprint board — drag-to-status kanban + workload heatmap.
 *
 * Three columns matching TaskStatus: Planned → In progress → Completed.
 * Cards drag between columns. "+" at the top of each column quick-adds.
 *
 * Above the board: a workload strip showing each assignee's open task
 * count + estimated hours. Bars surface overload at a glance.
 *
 *  GET   /api/tasks?startDate=…&endDate=…
 *  POST  /api/tasks   { title, date, status?, allDay }
 *  PATCH /api/tasks   { id, status?, title? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KanbanSquare, Plus, Flame, Loader2, Clock, UserMinus,
  CheckSquare, Activity,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type ApiStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";

type ApiTask = {
  id: string; title: string; date: string;
  status: ApiStatus; priority: ApiPrio;
  estimateHours?: number | null;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

const COLS: { id: ApiStatus; label: string; sub: string; hue: string }[] = [
  { id: "PLANNED",     label: "Planned",     sub: "ready to start",      hue: "var(--os-c-indigo)" },
  { id: "IN_PROGRESS", label: "In progress", sub: "in flight right now", hue: "var(--os-c-orange)" },
  { id: "COMPLETED",   label: "Completed",   sub: "done this sprint",    hue: "var(--os-c-green)" },
];

const PRIO_HUE: Record<ApiPrio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

function dueChip(t: ApiTask): { label: string; tone: "danger" | "today" | "soon" } | null {
  if (t.status === "COMPLETED") return null;
  const today0 = startOfDay(new Date()).getTime();
  const due0 = startOfDay(new Date(t.date)).getTime();
  const days = Math.round((due0 - today0) / MS_DAY);
  if (days < 0) return { label: `${-days}d late`, tone: "danger" };
  if (days === 0) return { label: "Today", tone: "today" };
  if (days <= 3) return { label: `${days}d`, tone: "soon" };
  return null;
}

interface Workload {
  id: string;
  name: string;
  count: number;
  hours: number;
  inProgress: number;
}

export default function SprintBoardPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState<ApiStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<ApiStatus, string>>({ PLANNED: "", IN_PROGRESS: "", COMPLETED: "" });
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const from = new Date(Date.now() - 14 * MS_DAY).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 60 * MS_DAY).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Group tasks into columns, sorted by priority then due date
  const grouped = useMemo(() => {
    const m = new Map<ApiStatus, ApiTask[]>();
    for (const c of COLS) m.set(c.id, []);
    const prioRank: Record<ApiPrio, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    for (const t of tasks ?? []) m.get(t.status)?.push(t);
    for (const [, arr] of m) {
      arr.sort((a, b) => {
        const p = prioRank[a.priority] - prioRank[b.priority];
        if (p !== 0) return p;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
    }
    return m;
  }, [tasks]);

  // Compute workload per assignee (only counts open tasks)
  const workload = useMemo<Workload[]>(() => {
    const m = new Map<string, Workload>();
    for (const t of tasks ?? []) {
      if (t.status === "COMPLETED") continue;
      if (!t.assignee) continue;
      const id = t.assignee.id;
      const name = `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || "Unknown";
      const w = m.get(id) ?? { id, name, count: 0, hours: 0, inProgress: 0 };
      w.count += 1;
      w.hours += t.estimateHours ?? 0;
      if (t.status === "IN_PROGRESS") w.inProgress += 1;
      m.set(id, w);
    }
    return Array.from(m.values()).sort((a, b) => b.hours - a.hours || b.count - a.count);
  }, [tasks]);
  const maxHours = Math.max(40, ...workload.map((w) => w.hours)); // floor at 40h for sane scale

  async function moveTo(id: string, status: ApiStatus) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, status } : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      if (!res.ok) throw new Error();
    } catch { toast("Couldn't move"); void load(); }
  }

  async function quickAdd(status: ApiStatus) {
    const title = drafts[status].trim();
    if (!title) return;
    setAdding(status);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date: new Date().toISOString(), allDay: true, status }),
      });
      if (!res.ok) throw new Error();
      setDrafts((d) => ({ ...d, [status]: "" }));
      void load();
    } catch { toast("Couldn't add"); }
    finally { setAdding(null); }
  }

  const total = tasks?.length ?? 0;
  const inFlight = (tasks ?? []).filter((t) => t.status === "IN_PROGRESS").length;
  const done = (tasks ?? []).filter((t) => t.status === "COMPLETED").length;
  const unassigned = (tasks ?? []).filter((t) => !t.assignee && t.status !== "COMPLETED").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <OsTitleBar
        title="Sprint board"
        Icon={KanbanSquare}
        iconGradient={GRAD.orangePink}
        description={tasks === null
          ? "Loading…"
          : `${total} task${total === 1 ? "" : "s"} · ${inFlight} in flight · ${pct}% complete`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={5}
      />

      {loadError ? (
        <OsEmptyView Icon={KanbanSquare} iconGradient={GRAD.redPink} title="Couldn't load board" subtitle={`API error: ${loadError}`} cta="Retry" />
      ) : tasks === null ? (
        <div className="spbd__loading">Loading board…</div>
      ) : (
        <div className="spbd">
          {/* Workload heatmap */}
          {workload.length > 0 && (
            <section className="spbd__workload">
              <header>
                <h2><Activity /> Workload</h2>
                <span>{workload.length} assignee{workload.length === 1 ? "" : "s"} · {unassigned} unassigned task{unassigned === 1 ? "" : "s"}</span>
              </header>
              <div className="spbd__workload-list">
                {workload.map((w) => {
                  const pct = Math.min(100, Math.round((w.hours / maxHours) * 100));
                  const overloaded = w.hours > 40;
                  const dim = highlightedUserId !== null && highlightedUserId !== w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      className={`spbd-load ${overloaded ? "is-overloaded" : ""} ${dim ? "is-dim" : ""} ${highlightedUserId === w.id ? "is-active" : ""}`}
                      onMouseEnter={() => setHighlightedUserId(w.id)}
                      onMouseLeave={() => setHighlightedUserId(null)}
                    >
                      <span className="spbd-load__av" style={{ background: avColor(w.id) }}>
                        {initials(w.name.split(" ")[0], w.name.split(" ")[1])}
                      </span>
                      <div className="spbd-load__body">
                        <div className="spbd-load__name">
                          <span>{w.name}</span>
                          <em>{w.count} task{w.count === 1 ? "" : "s"} · {w.hours.toFixed(0)}h</em>
                        </div>
                        <div className="spbd-load__bar">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Kanban columns */}
          {total === 0 ? (
            <OsEmptyView Icon={KanbanSquare} iconGradient={GRAD.orangePink} title="No tasks in the window" subtitle="The board shows tasks from -14 days to +60 days. Add a task to any column to get started." chips={["Drag to move", "Quick-add at the top", "Priority sort built in"]} cta="Plan a task" />
          ) : (
            <div className="spbd__cols">
              {COLS.map((c) => {
                const items = grouped.get(c.id) ?? [];
                return (
                  <section
                    key={c.id}
                    className={`spbd__col ${drag ? "is-dropzone" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (drag) void moveTo(drag, c.id); setDrag(null); }}
                    style={{ ["--col-hue" as string]: c.hue }}
                  >
                    <header className="spbd__col-head">
                      <div className="spbd__col-text">
                        <h3>{c.label}</h3>
                        <p>{c.sub}</p>
                      </div>
                      <span className="spbd__col-count">{items.length}</span>
                    </header>
                    <div className="spbd__col-add">
                      {adding === c.id ? <Loader2 className="spbd__spin" /> : <Plus />}
                      <input
                        type="text"
                        value={drafts[c.id]}
                        onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") void quickAdd(c.id); }}
                        placeholder={c.id === "PLANNED" ? "Plan a new task…" : c.id === "IN_PROGRESS" ? "What's in flight?" : "Already done? Add it…"}
                        disabled={adding === c.id}
                      />
                    </div>
                    <div className="spbd__col-body">
                      {items.length === 0 ? (
                        <div className="spbd__col-empty">{drag ? "Drop here" : "No cards"}</div>
                      ) : items.map((t) => {
                        const chip = dueChip(t);
                        const isHighlighted = highlightedUserId !== null && t.assignee?.id === highlightedUserId;
                        const dim = highlightedUserId !== null && t.assignee?.id !== highlightedUserId;
                        return (
                          <article
                            key={t.id}
                            className={`spbd-card ${t.status === "COMPLETED" ? "is-done" : ""} ${isHighlighted ? "is-highlight" : ""} ${dim ? "is-dim" : ""}`}
                            draggable
                            onDragStart={() => setDrag(t.id)}
                            onDragEnd={() => setDrag(null)}
                            style={{ ["--prio-color" as string]: PRIO_HUE[t.priority] }}
                          >
                            <header className="spbd-card__head">
                              {(t.priority === "URGENT" || t.priority === "HIGH") ? (
                                <span className="spbd-card__prio">
                                  <Flame /> {t.priority === "URGENT" ? "P0" : "P1"}
                                </span>
                              ) : <span />}
                              {chip && <span className={`spbd-card__chip spbd-card__chip--${chip.tone}`}>{chip.label}</span>}
                            </header>
                            <h4 className="spbd-card__title">{t.title}</h4>
                            <footer className="spbd-card__foot">
                              {t.assignee ? (
                                <div className="spbd-card__assignee">
                                  <span className="spbd-card__av" style={{ background: avColor(t.assignee.id) }}>
                                    {initials(t.assignee.firstName, t.assignee.lastName)}
                                  </span>
                                  <span className="spbd-card__name">
                                    {`${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || "Assigned"}
                                  </span>
                                </div>
                              ) : (
                                <span className="spbd-card__unassigned"><UserMinus /> unassigned</span>
                              )}
                              {t.estimateHours != null && (
                                <span className="spbd-card__est"><Clock /> {t.estimateHours}h</span>
                              )}
                              {t.status === "COMPLETED" && <CheckSquare className="spbd-card__done-tick" />}
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
