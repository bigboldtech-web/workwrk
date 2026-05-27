"use client";

/* Tasks · Sprint board — drag-to-status kanban.
 *
 * Three columns matching TaskStatus: Planned → In progress → Completed.
 * Each card is small + dense: priority pill, title, assignee avatar,
 * due chip. Drag a card to another column to update status. "+" at
 * the top of each column quick-adds a card into that status.
 *
 * GET   /api/tasks?startDate=…&endDate=…   (window: -14d through +60d)
 * POST  /api/tasks   { title, date, status?, allDay }
 * PATCH /api/tasks   { id, status?, title? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { KanbanSquare, Plus, Flame } from "lucide-react";
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

const COLS: { id: ApiStatus; label: string; hue: string }[] = [
  { id: "PLANNED",     label: "Planned",     hue: "var(--os-c-indigo)" },
  { id: "IN_PROGRESS", label: "In progress", hue: "var(--os-c-orange)" },
  { id: "COMPLETED",   label: "Completed",   hue: "var(--os-c-green)" },
];

const PRIO_HUE: Record<ApiPrio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

function dueChip(t: ApiTask): { label: string; tone: "danger" | "today" | "muted" } | null {
  if (t.status === "COMPLETED") return null;
  const today0 = startOfDay(new Date()).getTime();
  const due0 = startOfDay(new Date(t.date)).getTime();
  const days = Math.round((due0 - today0) / MS_DAY);
  if (days < 0) return { label: `${-days}d late`, tone: "danger" };
  if (days === 0) return { label: "Today", tone: "today" };
  if (days <= 3) return { label: `${days}d`, tone: "muted" };
  return null;
}

export default function SprintBoardPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<ApiStatus, string>>({ PLANNED: "", IN_PROGRESS: "", COMPLETED: "" });
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

  async function moveTo(id: string, status: ApiStatus) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, status } : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't move"); void load(); }
  }

  async function quickAdd(status: ApiStatus) {
    const title = drafts[status].trim();
    if (!title) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date: new Date().toISOString(), allDay: true, status }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      setDrafts((d) => ({ ...d, [status]: "" }));
      void load();
    } catch { toast("Couldn't add"); }
  }

  const totalCount = tasks?.length ?? 0;
  const doneCount = (tasks ?? []).filter((t) => t.status === "COMPLETED").length;
  const inProgressCount = (tasks ?? []).filter((t) => t.status === "IN_PROGRESS").length;

  return (
    <div className="sprintbd">
      <header className="sprintbd__head">
        <div className="sprintbd__head-l">
          <div className="sprintbd__icon"><KanbanSquare /></div>
          <div>
            <h1 className="sprintbd__title">Sprint board</h1>
            <div className="sprintbd__sub">
              {tasks === null ? "Loading…" : `${totalCount} task${totalCount === 1 ? "" : "s"} · ${inProgressCount} in flight · ${doneCount} done`}
            </div>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="sprintbd__error">{loadError}</div>
      ) : tasks === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="sprintbd__cols">
          {COLS.map((c) => {
            const items = grouped.get(c.id) ?? [];
            return (
              <section
                key={c.id}
                className="sprintbd__col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (drag) void moveTo(drag, c.id); setDrag(null); }}
              >
                <header className="sprintbd__col-head" style={{ borderTop: `3px solid ${c.hue}` }}>
                  <span>{c.label}</span>
                  <span className="sprintbd__col-count">{items.length}</span>
                </header>
                <div className="sprintbd__col-add">
                  <Plus />
                  <input
                    type="text"
                    value={drafts[c.id]}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") void quickAdd(c.id); }}
                    placeholder={c.id === "PLANNED" ? "Plan a new task…" : c.id === "IN_PROGRESS" ? "Start working on…" : "Already done? Add it…"}
                  />
                </div>
                <div className="sprintbd__col-body">
                  {items.length === 0 ? (
                    <div className="sprintbd__col-empty">Drop a card here.</div>
                  ) : items.map((t) => {
                    const chip = dueChip(t);
                    return (
                      <article
                        key={t.id}
                        className={`sprintbd-card ${t.status === "COMPLETED" ? "is-done" : ""}`}
                        draggable
                        onDragStart={() => setDrag(t.id)}
                        onDragEnd={() => setDrag(null)}
                      >
                        <header className="sprintbd-card__head">
                          {(t.priority === "URGENT" || t.priority === "HIGH") && (
                            <span className="sprintbd-card__prio" style={{ color: PRIO_HUE[t.priority] }}>
                              <Flame /> {t.priority === "URGENT" ? "P0" : "P1"}
                            </span>
                          )}
                          {chip && <span className={`sprintbd-card__chip sprintbd-card__chip--${chip.tone}`}>{chip.label}</span>}
                        </header>
                        <h4 className="sprintbd-card__title">{t.title}</h4>
                        <footer className="sprintbd-card__foot">
                          {t.assignee ? (
                            <span className="sprintbd-card__av" style={{ background: avColor(t.assignee.id) }}>
                              {initials(t.assignee.firstName, t.assignee.lastName)}
                            </span>
                          ) : <span className="sprintbd-card__unassigned">unassigned</span>}
                          {t.estimateHours != null && <span className="sprintbd-card__est">{t.estimateHours}h</span>}
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
  );
}
