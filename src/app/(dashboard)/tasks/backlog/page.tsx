"use client";

/* Backlog — the PM's flat, sortable spreadsheet of unscheduled work.
 *
 * Rows: every non-completed future task. Sort by priority / title /
 * estimate / age / assignee. Bulk-select for promote or archive.
 * Inline add at the bottom. Priority pill bumps up/down with arrows.
 *
 *  GET   /api/tasks?startDate=…&endDate=…
 *  PATCH /api/tasks   { id, ... }
 *  POST  /api/tasks   { title, date, allDay }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Layers, ChevronUp, ChevronDown, Flame, Trash2, ArrowUpDown,
  Plus, AlertOctagon, UserMinus, Hourglass, ListChecks, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
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
  URGENT: "var(--os-c-red)",
  HIGH:   "var(--os-c-orange)",
  NORMAL: "var(--os-c-blue)",
  LOW:    "var(--os-c-darkgray)",
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

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initialsFor(f?: string | null, l?: string | null) {
  return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?";
}

export default function BacklogPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
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

  const stats = useMemo(() => ({
    total: sorted.length,
    hours: sorted.reduce((acc, t) => acc + (t.estimateHours ?? 0), 0),
    p0: sorted.filter((t) => t.priority === "URGENT").length,
    unassigned: sorted.filter((t) => !t.assignee).length,
  }), [sorted]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, ...body } as ApiTask : t) ?? prev);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't save"); void load(); }
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
    setAdding(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.trim(),
          date: new Date(Date.now() + 30 * MS_DAY).toISOString(),
          allDay: true,
        }),
      });
      if (!res.ok) throw new Error();
      setDraft("");
      void load();
    } catch { toast("Couldn't add"); }
    finally { setAdding(false); }
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
    if (!confirm(`Archive ${selected.size} item${selected.size === 1 ? "" : "s"}?`)) return;
    const ids = Array.from(selected);
    for (const id of ids) await patch(id, { status: "COMPLETED" });
    setSelected(new Set());
    void load();
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id)));
  }

  return (
    <>
      <OsTitleBar
        title="Backlog"
        Icon={Layers}
        iconGradient={GRAD.indigoBlue}
        description={tasks === null ? "Loading…" : `${stats.total} item${stats.total === 1 ? "" : "s"} · ${stats.hours.toFixed(0)}h estimated`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={5}
        actions={
          selected.size > 0 ? (
            <div className="bklg__bulk">
              <span>{selected.size} selected</span>
              <button type="button" onClick={bulkPromote} title="Promote priority"><ChevronUp /> Promote</button>
              <button type="button" onClick={bulkArchive} title="Archive (mark completed)"><Trash2 /> Archive</button>
              <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : null
        }
      />

      {loadError ? (
        <OsEmptyView Icon={Layers} iconGradient={GRAD.redPink} title="Couldn't load backlog" subtitle={`API error: ${loadError}`} cta="Retry" />
      ) : tasks === null ? (
        <div className="bklg__loading">Loading backlog…</div>
      ) : (
        <div className="bklg">
          {/* Stat strip */}
          {sorted.length > 0 && (
            <div className="bklg__stats">
              <Stat Icon={ListChecks} label="Items" value={`${stats.total}`} color="var(--os-c-indigo)" />
              <Stat Icon={Hourglass} label="Hours estimated" value={`${stats.hours.toFixed(0)}h`} color="var(--os-c-blue)" />
              <Stat Icon={AlertOctagon} label="P0 urgent" value={`${stats.p0}`} color="var(--os-c-red)" highlight={stats.p0 > 0} />
              <Stat Icon={UserMinus} label="Unassigned" value={`${stats.unassigned}`} color="var(--os-c-orange)" highlight={stats.unassigned > 0} />
            </div>
          )}

          {/* Spreadsheet */}
          <div className="bklg__table">
            <div className="bklg__row bklg__row--head">
              <div className="bklg__cell bklg__cell--check">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === sorted.length}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < sorted.length; }}
                  onChange={toggleAll}
                />
              </div>
              <SortHeader label="Priority" k="priority" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} cls="bklg__cell--prio" />
              <SortHeader label="Title"    k="title"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} cls="bklg__cell--title" />
              <SortHeader label="Est"      k="estimate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} cls="bklg__cell--est" />
              <SortHeader label="Age"      k="age"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} cls="bklg__cell--age" />
              <SortHeader label="Assignee" k="assignee" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} cls="bklg__cell--owner" />
              <div className="bklg__cell bklg__cell--labels">Labels</div>
            </div>

            {sorted.length === 0 ? (
              <div className="bklg__empty">Backlog is empty. Drop a quick idea below to start filling it.</div>
            ) : sorted.map((t) => (
              <div key={t.id} className={`bklg__row ${selected.has(t.id) ? "is-selected" : ""}`} style={{ ["--prio-color" as string]: PRIO_COLOR[t.priority] }}>
                <div className="bklg__cell bklg__cell--check">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} />
                </div>

                <div className="bklg__cell bklg__cell--prio">
                  <div className="bklg__prio" style={{ background: PRIO_COLOR[t.priority] }}>
                    <span>{PRIO_LABEL[t.priority]}</span>
                    <div className="bklg__prio-arrows">
                      <button type="button" onClick={() => bumpPriority(t, "up")} aria-label="Promote"><ChevronUp /></button>
                      <button type="button" onClick={() => bumpPriority(t, "down")} aria-label="Demote"><ChevronDown /></button>
                    </div>
                  </div>
                </div>

                <div className="bklg__cell bklg__cell--title">
                  {(t.priority === "URGENT" || t.priority === "HIGH") && (
                    <Flame style={{ width: 12, height: 12, color: PRIO_COLOR[t.priority], marginRight: 6, verticalAlign: -2 }} />
                  )}
                  {t.title}
                </div>

                <div className="bklg__cell bklg__cell--est">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    defaultValue={t.estimateHours ?? ""}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== (t.estimateHours ?? 0)) void setEstimate(t, v); }}
                    className="bklg__est-input"
                    placeholder="—"
                  />
                  <span className="bklg__est-unit">h</span>
                </div>

                <div className="bklg__cell bklg__cell--age">{fmtAge(t.createdAt)}</div>

                <div className="bklg__cell bklg__cell--owner">
                  {t.assignee ? (
                    <>
                      <span className="bklg__avatar" style={{ background: avColor(t.assignee.id) }}>
                        {initialsFor(t.assignee.firstName, t.assignee.lastName)}
                      </span>
                      <span className="bklg__assignee-name">
                        {`${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim()}
                      </span>
                    </>
                  ) : (
                    <em className="bklg__unassigned">unassigned</em>
                  )}
                </div>

                <div className="bklg__cell bklg__cell--labels">
                  {(t.labels ?? []).slice(0, 3).map((l) => (
                    <span key={l.label.id} className="bklg__label">{l.label.name}</span>
                  ))}
                  {(t.labels?.length ?? 0) > 3 && <span className="bklg__label-more">+{(t.labels?.length ?? 0) - 3}</span>}
                </div>
              </div>
            ))}

            {/* Inline add row */}
            <div className="bklg__row bklg__row--add">
              <div className="bklg__cell bklg__cell--check" />
              <div className="bklg__cell bklg__cell--prio">
                {adding ? <Loader2 className="bklg__spin" /> : <Plus />}
              </div>
              <div className="bklg__cell bklg__cell--add-input" style={{ gridColumn: "span 5" }}>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addRow(); }}
                  placeholder="Type a backlog item and press Enter…"
                  className="bklg__add-input"
                  disabled={adding}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ Icon, label, value, color, highlight }: { Icon: typeof Layers; label: string; value: string; color: string; highlight?: boolean }) {
  return (
    <div className={`bklg-stat ${highlight ? "is-highlight" : ""}`} style={{ ["--stat-color" as string]: color }}>
      <span className="bklg-stat__icon"><Icon /></span>
      <div className="bklg-stat__body">
        <div className="bklg-stat__value">{value}</div>
        <div className="bklg-stat__label">{label}</div>
      </div>
    </div>
  );
}

function SortHeader({ label, k, sortKey, sortDir, onClick, cls }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir;
  onClick: (k: SortKey) => void; cls?: string;
}) {
  const active = sortKey === k;
  return (
    <button type="button" onClick={() => onClick(k)} className={`bklg__cell bklg__sort ${cls ?? ""} ${active ? "is-active" : ""}`}>
      <span>{label}</span>
      {active ? (sortDir === "asc" ? <ChevronUp /> : <ChevronDown />) : <ArrowUpDown />}
    </button>
  );
}
