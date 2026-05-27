"use client";

/* Backlog — flat, dense, sortable. The PM's spreadsheet.
 *
 * Rows: every unscheduled / future task in the org.
 * Columns: priority · title · estimate (h) · age · assignee · labels.
 * Click any header to sort. Bulk-select via checkbox column. Drag the
 * priority chip to bump it up/down. Type at the bottom row to add.
 *
 * GET   /api/tasks?startDate=…&endDate=…       (we pull a 90d window)
 * PATCH /api/tasks   { id, status?, priority?, estimateHours?, title?, date? }
 * POST  /api/tasks   { title, date, allDay }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, ChevronUp, ChevronDown, Flame, Trash2, ArrowUpDown, Plus } from "lucide-react";
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
  estimateHours?: number | null;
  createdAt?: string;
  assignee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  labels?: { label: { id: string; name: string } }[];
};

const PRIO_RANK: Record<ApiPrio, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const PRIO_LABEL: Record<ApiPrio, string> = { URGENT: "P0", HIGH: "P1", NORMAL: "P2", LOW: "P3" };
const PRIO_COLOR: Record<ApiPrio, string> = {
  URGENT: "var(--os-c-red)", HIGH: "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)", LOW: "var(--os-c-darkgray)",
};
const PRIO_NEXT: Record<ApiPrio, ApiPrio> = { LOW: "NORMAL", NORMAL: "HIGH", HIGH: "URGENT", URGENT: "URGENT" };
const PRIO_PREV: Record<ApiPrio, ApiPrio> = { URGENT: "HIGH", HIGH: "NORMAL", NORMAL: "LOW", LOW: "LOW" };

const MS_DAY = 86_400_000;
const fmtAge = (iso?: string) => {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / MS_DAY);
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
};

type SortKey = "priority" | "title" | "estimate" | "age" | "assignee";
type SortDir = "asc" | "desc";

export default function BacklogPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 365 * MS_DAY).toISOString().slice(0, 10);
      const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiTask[] = Array.isArray(data) ? data : (data.data ?? []);
      // backlog = future, non-completed
      setTasks(list.filter((t) => t.status !== "COMPLETED"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tasks");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const sorted = useMemo(() => {
    const arr = [...(tasks ?? [])];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "priority": cmp = PRIO_RANK[a.priority] - PRIO_RANK[b.priority]; break;
        case "title":    cmp = a.title.localeCompare(b.title); break;
        case "estimate": cmp = (a.estimateHours ?? 0) - (b.estimateHours ?? 0); break;
        case "age": {
          const ai = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bi = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          cmp = bi - ai;
          break;
        }
        case "assignee": {
          const an = a.assignee ? `${a.assignee.firstName ?? ""} ${a.assignee.lastName ?? ""}` : "zzz";
          const bn = b.assignee ? `${b.assignee.firstName ?? ""} ${b.assignee.lastName ?? ""}` : "zzz";
          cmp = an.localeCompare(bn);
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [tasks, sortKey, sortDir]);

  const totalEst = sorted.reduce((acc, t) => acc + (t.estimateHours ?? 0), 0);
  const p0Count = sorted.filter((t) => t.priority === "URGENT").length;
  const unassignedCount = sorted.filter((t) => !t.assignee).length;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "title" || key === "assignee" ? "asc" : "asc"); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, ...body } as ApiTask : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch {
      toast("Couldn't save");
      void load();
    }
  }

  async function bumpPriority(t: ApiTask, dir: "up" | "down") {
    const next = dir === "up" ? PRIO_PREV[t.priority] : PRIO_NEXT[t.priority];
    if (next === t.priority) return;
    await patch(t.id, { priority: next });
  }

  async function setEstimate(t: ApiTask, hours: number) {
    if (hours < 0 || hours > 999) return;
    await patch(t.id, { estimateHours: hours });
  }

  async function addRow() {
    if (!draft.trim()) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.trim(),
          date: new Date(Date.now() + 30 * MS_DAY).toISOString(),
          allDay: true,
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      setDraft("");
      void load();
    } catch {
      toast("Couldn't add");
    }
  }

  async function bulkPromote() {
    const ids = Array.from(selected);
    for (const id of ids) {
      const t = tasks?.find((x) => x.id === id);
      if (!t) continue;
      await bumpPriority(t, "up");
    }
    setSelected(new Set());
  }
  async function bulkArchive() {
    const ids = Array.from(selected);
    for (const id of ids) await patch(id, { status: "COMPLETED" });
    setSelected(new Set());
    void load();
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id)));
  }

  return (
    <div className="backlog">
      <header className="backlog__head">
        <div className="backlog__head-l">
          <div className="backlog__icon"><Layers /></div>
          <div>
            <h1 className="backlog__title">Backlog</h1>
            <div className="backlog__sub">
              {tasks === null ? "Loading…" : (
                <>{sorted.length} item{sorted.length === 1 ? "" : "s"} · {totalEst.toFixed(0)}h estimated · {p0Count} P0 · {unassignedCount} unassigned</>
              )}
            </div>
          </div>
        </div>
        {selected.size > 0 ? (
          <div className="backlog__bulk">
            <span>{selected.size} selected</span>
            <button type="button" onClick={bulkPromote}><ChevronUp /> Promote</button>
            <button type="button" onClick={bulkArchive}><Trash2 /> Archive</button>
            <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        ) : null}
      </header>

      {loadError ? (
        <div className="backlog__error">Couldn&apos;t load backlog: {loadError}</div>
      ) : tasks === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="backlog__table">
          <div className="backlog__row backlog__row--head">
            <div className="backlog__cell backlog__cell--check">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === sorted.length}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < sorted.length; }}
                onChange={toggleAll}
              />
            </div>
            <SortHeader label="Pri" k="priority" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="backlog__cell--prio" />
            <SortHeader label="Title" k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="backlog__cell--title" />
            <SortHeader label="Est" k="estimate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="backlog__cell--est" />
            <SortHeader label="Age" k="age" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="backlog__cell--age" />
            <SortHeader label="Assignee" k="assignee" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="backlog__cell--owner" />
            <div className="backlog__cell backlog__cell--labels">Labels</div>
          </div>

          {sorted.length === 0 ? (
            <div className="backlog__empty">Backlog is empty. Drop ideas in below.</div>
          ) : sorted.map((t) => (
            <div key={t.id} className={`backlog__row ${selected.has(t.id) ? "is-selected" : ""}`}>
              <div className="backlog__cell backlog__cell--check">
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} />
              </div>
              <div className="backlog__cell backlog__cell--prio">
                <div className="backlog__prio" style={{ background: PRIO_COLOR[t.priority] }}>
                  <button type="button" onClick={() => bumpPriority(t, "up")}   className="backlog__prio-arrow" title="Promote"><ChevronUp /></button>
                  <span>{PRIO_LABEL[t.priority]}</span>
                  <button type="button" onClick={() => bumpPriority(t, "down")} className="backlog__prio-arrow" title="Demote"><ChevronDown /></button>
                </div>
              </div>
              <div className="backlog__cell backlog__cell--title">
                {(t.priority === "URGENT" || t.priority === "HIGH") && (
                  <Flame style={{ width: 11, height: 11, color: PRIO_COLOR[t.priority], marginRight: 6, verticalAlign: -1 }} />
                )}
                {t.title}
              </div>
              <div className="backlog__cell backlog__cell--est">
                <input
                  type="number"
                  min={0}
                  max={999}
                  defaultValue={t.estimateHours ?? ""}
                  onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== (t.estimateHours ?? 0)) void setEstimate(t, v); }}
                  className="backlog__est-input"
                  placeholder="—"
                />
                <span className="backlog__est-unit">h</span>
              </div>
              <div className="backlog__cell backlog__cell--age">{fmtAge(t.createdAt)}</div>
              <div className="backlog__cell backlog__cell--owner">
                {t.assignee ? `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() : <em style={{ color: "var(--os-ink-3)" }}>unassigned</em>}
              </div>
              <div className="backlog__cell backlog__cell--labels">
                {(t.labels ?? []).slice(0, 3).map((l) => (
                  <span key={l.label.id} className="backlog__label">{l.label.name}</span>
                ))}
              </div>
            </div>
          ))}

          <div className="backlog__row backlog__row--add">
            <div className="backlog__cell backlog__cell--check"></div>
            <div className="backlog__cell backlog__cell--prio"><Plus style={{ width: 14, height: 14, color: "var(--os-ink-3)" }} /></div>
            <div className="backlog__cell backlog__cell--title" style={{ gridColumn: "span 5" }}>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addRow(); }}
                placeholder="Type a backlog item and press Enter…"
                className="backlog__add-input"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({ label, k, sortKey, sortDir, onClick, className }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir;
  onClick: (k: SortKey) => void; className?: string;
}) {
  const active = sortKey === k;
  return (
    <button type="button" onClick={() => onClick(k)} className={`backlog__cell backlog__sort ${className ?? ""} ${active ? "is-active" : ""}`}>
      <span>{label}</span>
      {active ? (sortDir === "asc" ? <ChevronUp /> : <ChevronDown />) : <ArrowUpDown />}
    </button>
  );
}
