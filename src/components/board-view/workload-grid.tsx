"use client";

// WorkloadGrid — the shared people-rows × day-columns capacity grid
// (ClickUp Workload parity). One core rendered by BOTH the board-level
// WORKLOAD view (board-workload-view.tsx, settings persisted in
// View.config) and the manager-scoped /team/workload page (settings in
// localStorage), so the two surfaces never fork.
//
// Load math mirrors the legacy /api/tasks/workload split, ported to
// BoardItemRow: a task's time estimate (Item.metadata.timeEstimate,
// minutes) spreads evenly across its startAt..dueAt span; tasks mode
// counts 1 per in-window span day. Done/closed statuses are excluded
// (ClickUp hides closed work by default). Undated open items feed a
// per-person "unscheduled" backlog pill instead of day cells.
//
// Date scaffolding (startOfWeek / MS_PER_DAY / sticky name column /
// two-tier month+day header / brand-red today marker / weekend shading) is
// copied from board-gantt-view.tsx — those helpers are module-private
// there, so they're re-declared here (Monday-anchored, per ClickUp).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Settings2, Users } from "lucide-react";
import {
  isDoneStatus,
  makeStatusLookup,
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar } from "./assignee-picker";
import { StatusGlyph } from "./status-glyph";

const MS_PER_DAY = 86_400_000;
const NAME_W = 220;   // left sticky People column width
const HEAD_H = 44;    // two-tier header (month band + day row)
const ROW_H = 56;     // per-person capacity row height
const ITEM_CAP = 8;   // expanded per-person item rows before "+N more"
const UNASSIGNED = "__unassigned__";

export interface WorkloadPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

export interface WorkloadSettings {
  mode: "tasks" | "hours";
  windowDays: 7 | 14 | 28;
  dailyHours: number;
  dailyTasks: number;
  perPersonHours: Record<string, number>;
  countWeekends: boolean;
  showAllPeople: boolean;
}

export const DEFAULT_WORKLOAD_SETTINGS: WorkloadSettings = {
  mode: "tasks",
  windowDays: 14,
  dailyHours: 8,
  dailyTasks: 3,
  perPersonHours: {},
  countWeekends: false,
  showAllPeople: false,
};

/** Validate an untyped settings blob (View.config keys / localStorage)
 *  field-by-field, falling back to the defaults on garbage. */
export function sanitizeWorkloadSettings(raw: Partial<Record<keyof WorkloadSettings, unknown>>): WorkloadSettings {
  const d = DEFAULT_WORKLOAD_SETTINGS;
  const num = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  const perPerson: Record<string, number> = {};
  if (raw.perPersonHours && typeof raw.perPersonHours === "object" && !Array.isArray(raw.perPersonHours)) {
    for (const [k, v] of Object.entries(raw.perPersonHours as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 24) perPerson[k] = v;
    }
  }
  return {
    mode: raw.mode === "hours" ? "hours" : "tasks",
    windowDays: raw.windowDays === 7 || raw.windowDays === 28 ? raw.windowDays : d.windowDays,
    dailyHours: num(raw.dailyHours, 1, 24, d.dailyHours),
    dailyTasks: num(raw.dailyTasks, 1, 99, d.dailyTasks),
    perPersonHours: perPerson,
    countWeekends: raw.countWeekends === true,
    showAllPeople: raw.showAllPeople === true,
  };
}

interface WorkloadGridProps {
  items: BoardItemRow[];
  people: WorkloadPerson[];
  statuses: StatusOption[];
  settings: WorkloadSettings;
  canEdit: boolean;
  onSettingsChange?: (patch: Partial<WorkloadSettings>) => void;
  onOpenItem?: (id: string) => void;
}

interface DayLoad {
  hours: number;
  tasks: number;
  /** Hours-mode blind spot: open in-window tasks with no time estimate. */
  unestimated: number;
}

interface PersonRowData {
  key: string;
  person: WorkloadPerson | null; // null → the synthetic Unassigned row
  days: DayLoad[];
  backlog: BoardItemRow[];       // undated open items
  windowItems: BoardItemRow[];   // dated open items touching the window
  totalHours: number;
  totalTasks: number;
}

/** Monday-anchored week start (ClickUp's Workload weeks run Mon–Sun). */
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function parseDate(raw: Date | string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function personName(p: WorkloadPerson | null): string {
  if (!p) return "Unassigned";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unknown";
}

/** "6", "6.5" — one decimal only when it matters. */
function fmtH(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export function WorkloadGrid({ items, people, statuses, settings, canEdit, onSettingsChange, onOpenItem }: WorkloadGridProps) {
  // Controlled (board view / team page persist) vs local-only fallback so
  // the mode/window selects never become dead controls for read-only
  // viewers of a board WORKLOAD view.
  const controlled = !!onSettingsChange;
  const [localSettings, setLocalSettings] = useState<WorkloadSettings>(settings);
  const s = controlled ? settings : localSettings;
  const change = useCallback((patch: Partial<WorkloadSettings>) => {
    if (onSettingsChange) onSettingsChange(patch);
    else setLocalSettings((prev) => ({ ...prev, ...patch }));
  }, [onSettingsChange]);

  const statusLookup = useMemo(() => makeStatusLookup(statuses), [statuses]);

  // ── Window ────────────────────────────────────────────────────────
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const days = useMemo(
    () => Array.from({ length: s.windowDays }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i)),
    [anchor, s.windowDays],
  );
  const today = new Date();
  const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const isCurrentWindow = anchor.getTime() === startOfWeek(today).getTime();
  const shift = (deltaDays: number) =>
    setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + deltaDays));
  const rangeLabel = `${days[0].toLocaleString("default", { month: "short", day: "numeric" })} - ${
    days[days.length - 1].toLocaleString("default", { month: "short", day: "numeric" })}`;

  // Consecutive days grouped by month for the header's month band.
  const monthBands = useMemo(() => {
    const bands: Array<{ label: string; span: number }> = [];
    for (const d of days) {
      const label = d.toLocaleString("default", { month: "long", year: "numeric" });
      const last = bands[bands.length - 1];
      if (last && last.label === label) last.span += 1;
      else bands.push({ label, span: 1 });
    }
    return bands;
  }, [days]);

  // ── Load math (mode-independent: both hours + tasks per day) ──────
  const rowsData = useMemo<PersonRowData[]>(() => {
    const anchorMid = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime();
    const map = new Map<string, PersonRowData>();
    const ensure = (key: string, person: WorkloadPerson | null): PersonRowData => {
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          person,
          days: Array.from({ length: s.windowDays }, () => ({ hours: 0, tasks: 0, unestimated: 0 })),
          backlog: [],
          windowItems: [],
          totalHours: 0,
          totalTasks: 0,
        };
        map.set(key, row);
      } else if (!row.person && person) {
        row.person = person;
      }
      return row;
    };
    // Every member renders even with zero assigned items (behind the
    // "Show N people without tasks" affordance).
    for (const p of people) ensure(p.id, p);

    for (const it of items) {
      if (it.archivedAt) continue;
      // ClickUp hides closed work by default; unknown statuses count as
      // open (isDoneStatus contract), which is the safe side.
      if (isDoneStatus(statuses, it.status)) continue;
      const key = it.ownerId ?? UNASSIGNED;
      const row = ensure(key, it.owner ? { ...it.owner } : null);
      const start = parseDate(it.startAt);
      const due = parseDate(it.dueAt);
      if (!start && !due) {
        row.backlog.push(it);
        continue;
      }
      let d0 = (start ?? due)!;
      let d1 = (due ?? start)!;
      if (d1.getTime() < d0.getTime()) [d0, d1] = [d1, d0];
      const lo = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
      const hi = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
      const spanDays = Math.max(1, Math.round((hi.getTime() - lo.getTime()) / MS_PER_DAY) + 1);
      const rawEst = it.metadata?.timeEstimate;
      const estMinutes = typeof rawEst === "number" && Number.isFinite(rawEst) && rawEst > 0 ? rawEst : 0;
      const hoursPerDay = estMinutes / 60 / spanDays;
      let touched = false;
      for (let i = 0; i < spanDays; i++) {
        const day = new Date(lo.getFullYear(), lo.getMonth(), lo.getDate() + i);
        const idx = Math.round((day.getTime() - anchorMid) / MS_PER_DAY);
        if (idx < 0 || idx >= s.windowDays) continue;
        const cell = row.days[idx];
        cell.tasks += 1;
        cell.hours += hoursPerDay;
        if (estMinutes === 0) cell.unestimated += 1;
        touched = true;
      }
      if (touched) row.windowItems.push(it);
    }

    for (const row of map.values()) {
      row.totalHours = row.days.reduce((sum, d) => sum + d.hours, 0);
      row.totalTasks = row.days.reduce((sum, d) => sum + d.tasks, 0);
      row.windowItems.sort((a, b) => {
        const da = parseDate(a.dueAt)?.getTime() ?? parseDate(a.startAt)?.getTime() ?? 0;
        const db = parseDate(b.dueAt)?.getTime() ?? parseDate(b.startAt)?.getTime() ?? 0;
        return da - db;
      });
    }
    return Array.from(map.values());
  }, [items, people, statuses, anchor, s.windowDays]);

  const sorted = useMemo(() => {
    const loadOf = (r: PersonRowData) => (s.mode === "hours" ? r.totalHours : r.totalTasks);
    const list = [...rowsData];
    list.sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      const d = loadOf(b) - loadOf(a);
      if (d !== 0) return d;
      return personName(a.person).localeCompare(personName(b.person));
    });
    return list;
  }, [rowsData, s.mode]);

  const hasWork = (r: PersonRowData) => r.totalTasks > 0 || r.backlog.length > 0;
  const hiddenCount = sorted.filter((r) => r.key !== UNASSIGNED && !hasWork(r)).length;
  const visible = sorted.filter((r) => (r.key === UNASSIGNED ? hasWork(r) : s.showAllPeople || hasWork(r)));

  const capFor = useCallback((r: PersonRowData, day: Date): number => {
    const dow = day.getDay();
    if ((dow === 0 || dow === 6) && !s.countWeekends) return 0;
    if (s.mode === "hours") {
      const override = r.person ? s.perPersonHours[r.person.id] : undefined;
      return typeof override === "number" ? override : s.dailyHours;
    }
    return s.dailyTasks;
  }, [s.mode, s.countWeekends, s.perPersonHours, s.dailyHours, s.dailyTasks]);

  // ── Expand / collapse ─────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const expandedRowCount = (r: PersonRowData): number =>
    Math.min(r.windowItems.length, ITEM_CAP) + (r.windowItems.length > ITEM_CAP ? 1 : 0);

  // ── Capacity settings panel (gear) ────────────────────────────────
  const gearRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    if (!panelOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (gearRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setPanelOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [panelOpen]);

  const setPerPerson = (id: string, v: number | null) => {
    const next = { ...s.perPersonHours };
    if (v == null) delete next[id];
    else next[id] = v;
    change({ perPersonHours: next });
  };

  const cols = `repeat(${days.length}, minmax(44px, 1fr))`;

  return (
    <section>
      {/* Toolbar — window nav + mode/zoom selects + capacity gear */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button
          type="button"
          disabled={isCurrentWindow}
          onClick={() => setAnchor(startOfWeek(new Date()))}
          className="h-7 px-2.5 rounded-md border border-zinc-200 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300 disabled:hover:bg-transparent"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => shift(-7)}
          aria-label="Previous week"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-50"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => shift(7)}
          aria-label="Next week"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-50"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12.5px] font-semibold text-zinc-900">{rangeLabel}</span>
        <select
          value={s.mode}
          onChange={(e) => change({ mode: e.target.value === "hours" ? "hours" : "tasks" })}
          aria-label="Workload mode"
          className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700"
        >
          <option value="tasks">Task count</option>
          <option value="hours">Time estimates</option>
        </select>
        <select
          value={String(s.windowDays)}
          onChange={(e) => {
            const v = Number(e.target.value);
            change({ windowDays: v === 7 ? 7 : v === 28 ? 28 : 14 });
          }}
          aria-label="Window size"
          className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700"
        >
          <option value="7">1 week</option>
          <option value="14">2 weeks</option>
          <option value="28">4 weeks</option>
        </select>
        {controlled && canEdit ? (
          <>
            <button
              ref={gearRef}
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-label="Capacity settings"
              title="Capacity settings"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-50"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            <MorePortal anchorRef={gearRef} panelRef={panelRef} width={300} open={panelOpen} placement="below">
              <div className="rounded-xl border border-zinc-200 bg-white shadow-2xl p-3 space-y-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Capacity</div>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-zinc-700 flex-1">Daily hours</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    defaultValue={s.dailyHours}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 1 && v <= 24) change({ dailyHours: v });
                    }}
                    className="h-7 w-16 rounded-md border border-zinc-200 px-2 text-[12px] tabular-nums text-right"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-zinc-700 flex-1">Daily tasks</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    defaultValue={s.dailyTasks}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 1 && v <= 99) change({ dailyTasks: v });
                    }}
                    className="h-7 w-16 rounded-md border border-zinc-200 px-2 text-[12px] tabular-nums text-right"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-zinc-700 flex-1">Count weekends</span>
                  <Switch
                    checked={s.countWeekends}
                    onChange={(v) => change({ countWeekends: v })}
                    aria-label="Count weekends"
                  />
                </div>
                <div className="h-px bg-zinc-100" />
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Per-person hours</div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {people.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 h-7">
                      <PersonAvatar person={{ ...p, email: null }} size={20} />
                      <span className="flex-1 min-w-0 truncate text-[12px] text-zinc-700">{personName(p)}</span>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        placeholder={String(s.dailyHours)}
                        defaultValue={s.perPersonHours[p.id] ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") { setPerPerson(p.id, null); return; }
                          const v = Number(raw);
                          if (Number.isFinite(v) && v >= 1 && v <= 24) setPerPerson(p.id, v);
                        }}
                        className="h-7 w-16 rounded-md border border-zinc-200 px-2 text-[12px] tabular-nums text-right"
                      />
                    </div>
                  ))}
                  {people.length === 0 ? (
                    <div className="text-[12px] text-zinc-400">No members</div>
                  ) : null}
                </div>
              </div>
            </MorePortal>
          </>
        ) : null}
        <div className="flex-1" />
      </div>

      <div className="relative rounded-xl border border-zinc-200 bg-white overflow-x-auto">
        {visible.length === 0 ? (
          <div className="px-8 py-10 text-center">
            <p className="text-[12.5px] text-zinc-500">No scheduled work in this window.</p>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => change({ showAllPeople: true })}
                className="mt-2 h-7 px-2 text-[12px] text-zinc-500 hover:text-zinc-700"
              >
                Show {hiddenCount} {hiddenCount === 1 ? "person" : "people"} without tasks
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex" style={{ minWidth: NAME_W + 720 }}>
            {/* Left People column (sticky) */}
            <div className="shrink-0 sticky left-0 z-20 bg-white border-r border-zinc-200" style={{ width: NAME_W }}>
              <div
                className="flex items-center px-3 border-b border-zinc-200 bg-white text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500"
                style={{ height: HEAD_H }}
              >
                People
              </div>
              {visible.map((r) => {
                const isOpen = expanded.has(r.key);
                const capTotal = days.reduce((sum, d) => sum + capFor(r, d), 0);
                const summary = s.mode === "hours"
                  ? `${fmtH(r.totalHours)}h/${fmtH(capTotal)}h`
                  : `${r.totalTasks}/${capTotal} tasks`;
                return (
                  <Fragment key={r.key}>
                    <div className="flex items-center gap-2 px-3 border-b border-zinc-100" style={{ height: ROW_H }}>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(r.key)}
                        aria-label={isOpen ? `Collapse ${personName(r.person)}` : `Expand ${personName(r.person)}`}
                        className="h-5 w-5 inline-flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 shrink-0"
                      >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                      {r.person ? (
                        <PersonAvatar person={{ ...r.person, email: null }} size={24} />
                      ) : (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-zinc-400 shrink-0">
                          <Users className="w-3 h-3" />
                        </span>
                      )}
                      <span
                        className={`flex-1 min-w-0 truncate text-[12.5px] font-medium ${r.person ? "text-zinc-800" : "text-zinc-500"}`}
                        title={personName(r.person)}
                      >
                        {personName(r.person)}
                      </span>
                      <span className="text-[11px] tabular-nums text-zinc-500">{summary}</span>
                      {r.backlog.length > 0 ? (
                        <span
                          className="inline-flex items-center h-5 rounded-full bg-zinc-100 px-2 text-[10.5px] font-medium text-zinc-500"
                          title={`${r.backlog.length} open task${r.backlog.length === 1 ? "" : "s"} with no dates`}
                        >
                          {r.backlog.length} unscheduled
                        </span>
                      ) : null}
                    </div>
                    {isOpen ? (
                      <>
                        {r.windowItems.slice(0, ITEM_CAP).map((it) => {
                          const current = it.status ? statusLookup[it.status] ?? null : null;
                          const due = parseDate(it.dueAt);
                          return (
                            <div
                              key={it.id}
                              className="flex items-center gap-2 pl-10 pr-3 h-7 border-b border-zinc-100 bg-zinc-50/50 dark:bg-white/[0.02]"
                            >
                              <StatusGlyph current={current} statuses={statuses} />
                              <button
                                type="button"
                                onClick={() => onOpenItem?.(it.id)}
                                className="flex-1 min-w-0 truncate text-left text-[12px] text-zinc-700 hover:text-[var(--os-brand)]"
                                title={it.title}
                              >
                                {it.title}
                              </button>
                              <span className="text-[11px] tabular-nums text-zinc-400">
                                {due ? due.toLocaleString("default", { month: "short", day: "numeric" }) : ""}
                              </span>
                            </div>
                          );
                        })}
                        {r.windowItems.length > ITEM_CAP ? (
                          <div className="flex items-center pl-10 pr-3 h-7 border-b border-zinc-100 bg-zinc-50/50 dark:bg-white/[0.02] text-[11px] text-zinc-400">
                            +{r.windowItems.length - ITEM_CAP} more
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </Fragment>
                );
              })}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => change({ showAllPeople: !s.showAllPeople })}
                  className="h-7 px-2 text-[12px] text-zinc-500 hover:text-zinc-700 text-left w-full"
                >
                  {s.showAllPeople
                    ? "Hide people without tasks"
                    : `Show ${hiddenCount} ${hiddenCount === 1 ? "person" : "people"} without tasks`}
                </button>
              ) : null}
            </div>

            {/* Right day grid */}
            <div className="flex-1 min-w-[720px]">
              {/* Two-tier header: month band over weekday+day-number cells. */}
              <div className="border-b border-zinc-200 bg-white" style={{ height: HEAD_H }}>
                <div className="grid h-[18px]" style={{ gridTemplateColumns: cols }}>
                  {monthBands.map((band, i) => (
                    <div
                      key={`${band.label}-${i}`}
                      className="px-2 flex items-center text-[10.5px] font-medium text-zinc-500 truncate"
                      style={{ gridColumn: `span ${band.span}` }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
                <div className="grid h-[26px]" style={{ gridTemplateColumns: cols }}>
                  {days.map((d, i) => {
                    const isToday = d.getTime() === todayTime;
                    return (
                      <div
                        key={i}
                        className="border-l first:border-l-0 border-zinc-100 flex items-center justify-center gap-1 text-[10.5px]"
                      >
                        <span className="text-zinc-300 font-medium">{WEEKDAY_INITIALS[d.getDay()]}</span>
                        {isToday ? (
                          <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#E2445C] text-white text-[10px] font-semibold">
                            {d.getDate()}
                          </span>
                        ) : (
                          <span className="text-zinc-400">{d.getDate()}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {visible.map((r) => (
                <Fragment key={r.key}>
                  <div className="grid border-b border-zinc-100" style={{ gridTemplateColumns: cols, height: ROW_H }}>
                    {days.map((d, i) => (
                      <DayCell
                        key={i}
                        day={d}
                        load={r.days[i]}
                        cap={capFor(r, d)}
                        mode={s.mode}
                        onToggle={() => toggleExpanded(r.key)}
                      />
                    ))}
                  </div>
                  {expanded.has(r.key)
                    ? Array.from({ length: expandedRowCount(r) }, (_, i) => (
                        <div key={i} className="h-7 border-b border-zinc-100 bg-zinc-50/50 dark:bg-white/[0.02]" />
                      ))
                    : null}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Day cell — explicit bg+content pairs per theme (contrast rules) ──
//
// States: zero-capacity weekend / zero-load weekday / under-or-at
// capacity (emerald, bottom fill = utilization) / overloaded (solid red
// fill + overage badge). Hours mode marks days whose count includes
// unestimated tasks with an amber dot (the load number is a floor).
function DayCell({ day, load, cap, mode, onToggle }: {
  day: Date;
  load: DayLoad;
  cap: number;
  mode: WorkloadSettings["mode"];
  onToggle: () => void;
}) {
  const loadVal = mode === "hours" ? load.hours : load.tasks;
  const over = loadVal - cap;
  const label = mode === "hours" ? `${fmtH(load.hours)}h` : String(load.tasks);
  const dayLabel = `${day.toLocaleString("default", { weekday: "short" })}, ${day.toLocaleString("default", { month: "short", day: "numeric" })}`;
  const breakdown = mode === "hours"
    ? `${fmtH(load.hours)}h of ${fmtH(cap)}h · ${load.tasks} task${load.tasks === 1 ? "" : "s"}`
    : `${load.tasks} of ${cap} task${cap === 1 ? "" : "s"} · ${fmtH(load.hours)}h est`;
  const unest = mode === "hours" && load.unestimated > 0 ? ` · ${load.unestimated} unestimated` : "";
  const title = `${dayLabel} · ${breakdown}${unest}`;

  let block: React.ReactNode;
  if (cap === 0) {
    // Weekend (capacity off) — muted; load still visible as a gray bar.
    block = (
      <>
        {loadVal > 0 ? (
          <>
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-zinc-300 dark:bg-zinc-600" />
            <span className="absolute top-1 left-1.5 text-[10.5px] font-semibold tabular-nums text-zinc-500">{label}</span>
          </>
        ) : null}
      </>
    );
  } else if (loadVal <= 0) {
    block = (
      <>
        <span className="absolute top-1 left-1.5 text-[10.5px] font-semibold tabular-nums text-zinc-400">
          {mode === "hours" ? "0h" : "0"}
        </span>
        {/* Tasks scheduled but none estimated — the 0h is a floor, flag it. */}
        {mode === "hours" && load.unestimated > 0 ? (
          <span aria-hidden className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-500" />
        ) : null}
      </>
    );
  } else if (over > 0) {
    block = (
      <>
        <span aria-hidden className="absolute inset-0 bg-red-500" />
        <span className="absolute top-1 left-1.5 text-[10.5px] font-semibold tabular-nums text-white">{label}</span>
        <span className="absolute top-0 right-0 m-0.5 inline-flex items-center h-3.5 min-w-[14px] justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white tabular-nums">
          +{mode === "hours" ? `${fmtH(over)}h` : over}
        </span>
      </>
    );
  } else {
    block = (
      <>
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 bg-emerald-500"
          style={{ height: `${Math.min(loadVal / cap, 1) * 100}%` }}
        />
        <span className="absolute top-1 left-1.5 text-[10.5px] font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
          {label}
        </span>
        {mode === "hours" && load.unestimated > 0 ? (
          <span aria-hidden className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-500" />
        ) : null}
      </>
    );
  }

  const bg = cap === 0 || loadVal <= 0
    ? "bg-zinc-50 dark:bg-white/[0.04]"
    : over > 0
      ? "bg-red-100 dark:bg-red-500/15"
      : "bg-emerald-100 dark:bg-emerald-500/15";

  return (
    <div className="p-[3px] border-l first:border-l-0 border-zinc-100">
      <button
        type="button"
        onClick={onToggle}
        title={title}
        className={`relative w-full h-full rounded-[6px] overflow-hidden text-left ${bg}`}
      >
        {block}
      </button>
    </div>
  );
}
