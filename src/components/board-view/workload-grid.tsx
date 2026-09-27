"use client";

// WorkloadGrid: the shared people-rows by day-columns capacity grid, rendered
// by BOTH a List's WORKLOAD view (board-workload-view.tsx, settings in
// View.config) and the cross-List /team/workload page (settings in the
// viewer's preferences), so the two surfaces never fork.
//
// The counting is src/lib/people/workload-count.ts (unit tested): an item
// counts in every assignee's row, a start-to-due span spreads over the
// person's working days, hours split evenly across assignees, and capacity
// comes from the person's own weekly hours or schedule, then the company's
// working calendar. Undated open items go to the Unscheduled column.
//
// Cells: the number over a bottom-anchored fill whose height is the day's
// utilisation; at or under capacity the fill is --os-surface-2, over it the
// cell turns --os-danger-bg with the number in --os-danger-text and a "+2h"
// badge (colour plus the number, never colour alone). A click opens the day
// popover: that day's items, each opening the task drawer, with an Assign
// picker on unassigned work for people who can edit its List.
//
// Overdue: open work due before today is listed per person under their load
// summary ("3 overdue", danger text, opening the same popover), whatever the
// window, and a person whose only work is late still gets a row: the worst
// case is a manager reading a buried person as having room.
//
// Dates follow the viewer's date preferences (formatWallClockDate for the
// grid's calendar days, formatDate for an item's due instant).
//
// Keyboard: with the grid focused, Left and Right move the window a week and
// T returns to today; Esc closes the popover.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleDashed, Flag, Settings2, UserPlus, Users } from "lucide-react";
import { isDoneStatus, makeStatusLookup, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useWorkSchedule } from "@/lib/use-work-schedule";
import { effectivePersonSchedule, holidayOn, type Holiday, type WorkSchedule } from "@/lib/work-schedule";
import { capacityOn, computeWorkload, overBy, UNASSIGNED, type PersonLoad } from "@/lib/people/workload-count";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatWallClockDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { Picker } from "@/components/ui/picker";
import { PersonAvatar } from "./assignee-picker";
import { StatusGlyph } from "./status-glyph";

const NAME_W = 240;   // sticky People column
const HEAD_H = 44;    // weekday and date
const ROW_H = 56;     // a chart row, not a data row
const UNSCHED_W = 104;
const ITEM_CAP = 8;

export interface WorkloadPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  /** The person's own weekly hours (User.weeklyCapacityHours), null = schedule. */
  weeklyCapacityHours?: number | null;
  /** Their work schedule override ({ workdays, hoursPerDay }), null = the org's. */
  workSchedule?: unknown;
}

export interface WorkloadSettings {
  mode: "tasks" | "hours";
  windowDays: 7 | 14 | 28;
  /**
   * Hours in a full day for THIS view, or null for "follow the people's own
   * hours and the company's working calendar". A List's WORKLOAD view keeps
   * its per-view override here; the /team/workload page never sets it.
   */
  dailyHours: number | null;
  dailyTasks: number;
  /** A List view's per-person daily hours override (View.config). */
  perPersonHours: Record<string, number>;
  countWeekends: boolean;
  showAllPeople: boolean;
}

export const DEFAULT_WORKLOAD_SETTINGS: WorkloadSettings = {
  mode: "tasks",
  windowDays: 14,
  dailyHours: null,
  dailyTasks: 3,
  perPersonHours: {},
  countWeekends: false,
  showAllPeople: false,
};

/** Validate an untyped settings blob (View.config keys) field by field. */
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
    dailyHours: typeof raw.dailyHours === "number" && Number.isFinite(raw.dailyHours) && raw.dailyHours >= 1 && raw.dailyHours <= 24
      ? raw.dailyHours
      : null,
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
  /** Controlled window start (the page owns the navigator). */
  anchor?: Date;
  onAnchorChange?: (d: Date) => void;
  /** The page renders its own toolbar (window navigator, segmented mode, "..."). */
  hideToolbar?: boolean;
  /** The company working calendar, when the page already has it. */
  orgSchedule?: WorkSchedule;
  /** List names for the day popover. */
  boardNames?: Record<string, string>;
  /** Each List's own statuses, when items come from several Lists. */
  statusesByBoard?: Record<string, StatusOption[]>;
  /** May the viewer assign this (unassigned) item? */
  canAssign?: (item: BoardItemRow) => boolean;
  onAssign?: (itemId: string, personId: string) => Promise<boolean>;
  /** Beside the empty sentence ("Show the next 28 days"). */
  emptyAction?: { label: string; onClick: () => void };
  /**
   * Everyone each item is split across, by item id, when `items` carry only
   * the assignees in view (the cross-List page drops the ones outside the
   * viewer's scope): Hours mode then shows each person's real share.
   */
  shareCounts?: Record<string, number>;
}

/** Monday-anchored week start. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function parseDate(raw: Date | string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function personName(p: WorkloadPerson | null): string {
  if (!p) return "Unassigned";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unknown";
}

/** "6", "6.5": one decimal only when it matters. */
export function fmtH(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type Popover = { key: string; title: string; ids: string[] };

export function WorkloadGrid({
  items, people, statuses, settings, canEdit, onSettingsChange, onOpenItem,
  anchor: anchorProp, onAnchorChange, hideToolbar, orgSchedule, boardNames, statusesByBoard, canAssign, onAssign, emptyAction, shareCounts,
}: WorkloadGridProps) {
  const datePrefs = useDatePrefs();
  const { schedule: fetchedSchedule, configured: scheduleConfigured } = useWorkSchedule();
  const schedule = orgSchedule ?? fetchedSchedule;

  // Controlled (List view / team page persist) vs local-only fallback so the
  // controls are never dead for a read-only viewer of a List view.
  const controlled = !!onSettingsChange;
  const [localSettings, setLocalSettings] = useState<WorkloadSettings>(settings);
  const s = controlled ? settings : localSettings;
  const change = useCallback((patch: Partial<WorkloadSettings>) => {
    if (onSettingsChange) onSettingsChange(patch);
    else setLocalSettings((prev) => ({ ...prev, ...patch }));
  }, [onSettingsChange]);

  const statusLookup = useMemo(() => makeStatusLookup(statuses), [statuses]);

  // ── Window ────────────────────────────────────────────────────────
  const [localAnchor, setLocalAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const anchor = anchorProp ?? localAnchor;
  const setAnchor = useCallback((d: Date) => { if (onAnchorChange) onAnchorChange(d); else setLocalAnchor(d); }, [onAnchorChange]);
  const days = useMemo(
    () => Array.from({ length: s.windowDays }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i)),
    [anchor, s.windowDays],
  );
  const today = new Date();
  const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const isCurrentWindow = anchor.getTime() === startOfWeek(today).getTime();
  const shift = (deltaDays: number) => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + deltaDays));
  const rangeLabel = `${formatWallClockDate(ymdKey(days[0]), datePrefs)} to ${formatWallClockDate(ymdKey(days[days.length - 1]), datePrefs)}`;
  const dayLabel = (d: Date) => `${WEEKDAY[d.getDay()]}, ${formatWallClockDate(ymdKey(d), datePrefs)}`;

  // ── Load (src/lib/people/workload-count.ts) ───────────────────────
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p] as const)), [people]);
  const scheduleFor = useCallback(
    (key: string): WorkSchedule => {
      const p = personById.get(key);
      return p ? effectivePersonSchedule(schedule, p.workSchedule) : schedule;
    },
    [personById, schedule],
  );
  const openItems = useMemo(
    () => items.filter((it) => !it.archivedAt && !isDoneStatus((it.boardId && statusesByBoard?.[it.boardId]) || statuses, it.status)),
    [items, statuses, statusesByBoard],
  );
  const itemById = useMemo(() => new Map(openItems.map((it) => [it.id, it] as const)), [openItems]);
  const loads = useMemo(() => computeWorkload(
    openItems.map((it) => {
      const est = it.metadata?.timeEstimate;
      return {
        id: it.id,
        ownerId: it.ownerId,
        assigneeIds: it.assigneeIds ?? [],
        startAt: it.startAt ?? null,
        dueAt: it.dueAt ?? null,
        estimateMinutes: typeof est === "number" ? est : null,
        shareCount: shareCounts?.[it.id] ?? null,
      };
    }),
    people.map((p) => p.id),
    { from: anchor, days: s.windowDays, countWeekends: s.countWeekends, today: new Date(todayTime) },
    scheduleFor,
  ), [openItems, people, anchor, s.windowDays, s.countWeekends, scheduleFor, shareCounts, todayTime]);

  const capFor = useCallback((key: string, day: Date): number => {
    const p = personById.get(key);
    const perView = p ? s.perPersonHours[p.id] : undefined;
    return capacityOn(
      {
        schedule: scheduleFor(key),
        weeklyCapacityHours: p?.weeklyCapacityHours ?? null,
        dailyHoursOverride: typeof perView === "number" ? perView : s.dailyHours,
      },
      day,
      { mode: s.mode, dailyTasks: s.dailyTasks, countWeekends: s.countWeekends },
    );
  }, [personById, s.perPersonHours, s.dailyHours, s.mode, s.dailyTasks, s.countWeekends, scheduleFor]);

  const rows = useMemo(() => {
    const loadOf = (r: PersonLoad) => (s.mode === "hours" ? r.totalHours : r.totalTasks);
    const list = [...loads.values()];
    list.sort((a, b) => {
      // Unassigned first, so work waiting for a person is seen first.
      if (a.key === UNASSIGNED) return -1;
      if (b.key === UNASSIGNED) return 1;
      const d = loadOf(b) - loadOf(a);
      if (d !== 0) return d;
      return personName(personById.get(a.key) ?? null).localeCompare(personName(personById.get(b.key) ?? null));
    });
    return list;
  }, [loads, s.mode, personById]);

  const hasWork = (r: PersonLoad) => r.totalTasks > 0 || r.unscheduled.length > 0 || r.overdue.length > 0;
  const hiddenCount = rows.filter((r) => r.key !== UNASSIGNED && !hasWork(r)).length;
  const visible = rows.filter((r) => (r.key === UNASSIGNED ? hasWork(r) : s.showAllPeople || hasWork(r)));

  // ── Expand / popover ──────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }, []);
  const [pop, setPop] = useState<Popover | null>(null);
  const popAnchor = useRef<HTMLElement | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const openPopover = (key: string, title: string, ids: string[], el: HTMLElement) => {
    popAnchor.current = el;
    setAssignFor(null);
    setPop({ key, title, ids });
  };

  // ── Keyboard on the grid ──────────────────────────────────────────
  const onGridKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); shift(-7); }
    else if (e.key === "ArrowRight") { e.preventDefault(); shift(7); }
    else if (e.key === "t" || e.key === "T") { e.preventDefault(); setAnchor(startOfWeek(new Date())); }
  };

  // ── A List view's capacity gear (kept for the WORKLOAD view) ──────
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

  const cols = `repeat(${days.length}, minmax(56px, 1fr))`;
  const fillerRows = (r: PersonLoad) =>
    expanded.has(r.key) ? Math.min(r.windowItems.length, ITEM_CAP) + (r.windowItems.length > ITEM_CAP ? 1 : 0) : 0;

  return (
    <section>
      {hideToolbar ? null : (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => shift(-7)} aria-label="Previous week" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" disabled={isCurrentWindow} onClick={() => setAnchor(startOfWeek(new Date()))} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">
            Today
          </button>
          <button type="button" onClick={() => shift(7)} aria-label="Next week" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-base font-medium text-ink">{rangeLabel}</span>
          <div role="radiogroup" aria-label="Workload mode" className="inline-flex h-8 items-center rounded-lg bg-subtle p-0.5">
            {(["tasks", "hours"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={s.mode === m} onClick={() => change({ mode: m })}
                className={`h-7 rounded-md px-3 text-sm font-medium ${s.mode === m ? "border border-line bg-raised text-ink" : "text-ink-2 hover:text-ink"}`}>
                {m === "tasks" ? "Tasks" : "Hours"}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Window" className="inline-flex h-8 items-center rounded-lg bg-subtle p-0.5">
            {([7, 14, 28] as const).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={s.windowDays === w} onClick={() => change({ windowDays: w })}
                className={`h-7 rounded-md px-2.5 text-sm font-medium ${s.windowDays === w ? "border border-line bg-raised text-ink" : "text-ink-2 hover:text-ink"}`}>
                {w === 7 ? "1 week" : w === 14 ? "2 weeks" : "4 weeks"}
              </button>
            ))}
          </div>
          {controlled && canEdit ? (
            <>
              <button ref={gearRef} type="button" onClick={() => setPanelOpen((v) => !v)} aria-label="Capacity settings" title="Capacity settings"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover">
                <Settings2 className="h-4 w-4" />
              </button>
              <MorePortal anchorRef={gearRef} panelRef={panelRef} width={300} open={panelOpen} placement="below">
                <div className="space-y-2.5 rounded-lg border border-line bg-raised p-3 shadow-[var(--os-shadow-pop)]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Capacity</div>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-base text-ink">Daily hours</span>
                    <input type="number" min={1} max={24} defaultValue={s.dailyHours ?? ""} placeholder={fmtH(schedule.hoursPerDay)}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") { change({ dailyHours: null }); return; }
                        const v = Number(raw);
                        if (Number.isFinite(v) && v >= 1 && v <= 24) change({ dailyHours: v });
                      }}
                      className="h-8 w-16 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums" aria-label="Daily hours" />
                  </div>
                  <p className="text-xs text-ink-2">
                    {s.dailyHours === null
                      ? scheduleConfigured
                        ? `Following each person's weekly hours and the company working calendar (${fmtH(schedule.hoursPerDay)}h a day).`
                        : `No company working calendar set, so ${fmtH(schedule.hoursPerDay)}h a day is assumed.`
                      : "This view only. Clear the box to follow each person's hours and the company calendar."}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-base text-ink">Daily tasks</span>
                    <input type="number" min={1} max={99} defaultValue={s.dailyTasks}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1 && v <= 99) change({ dailyTasks: v }); }}
                      className="h-8 w-16 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums" aria-label="Daily tasks" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-base text-ink">Count weekends</span>
                    <Switch checked={s.countWeekends} onChange={(v) => change({ countWeekends: v })} aria-label="Count weekends" />
                  </div>
                  <div className="h-px bg-[var(--os-line)]" />
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Per-person hours a day</div>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto">
                    {people.map((p) => (
                      <div key={p.id} className="flex h-8 items-center gap-2">
                        <PersonAvatar person={{ ...p, email: null }} size={20} />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{personName(p)}</span>
                        <input type="number" min={1} max={24} placeholder={fmtH(s.dailyHours ?? schedule.hoursPerDay)} defaultValue={s.perPersonHours[p.id] ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") { setPerPerson(p.id, null); return; }
                            const v = Number(raw);
                            if (Number.isFinite(v) && v >= 1 && v <= 24) setPerPerson(p.id, v);
                          }}
                          className="h-8 w-16 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums" aria-label={`Hours a day for ${personName(p)}`} />
                      </div>
                    ))}
                    {people.length === 0 ? <div className="text-sm text-ink-2">No members</div> : null}
                  </div>
                </div>
              </MorePortal>
            </>
          ) : null}
        </div>
      )}

      <div className="os-chrome relative overflow-x-auto rounded-lg border border-line bg-raised" tabIndex={0} onKeyDown={onGridKey} aria-label={`Workload, ${rangeLabel}`}>
        {visible.length === 0 ? (
          <div className="px-8 py-10 text-center">
            <p className="text-row text-ink-2">Nothing scheduled in this window</p>
            <div className="mt-2 flex items-center justify-center gap-3">
              {emptyAction ? <button type="button" onClick={emptyAction.onClick} className="text-sm text-brand-deep hover:underline">{emptyAction.label}</button> : null}
              {hiddenCount > 0 ? (
                <button type="button" onClick={() => change({ showAllPeople: true })} className="text-sm text-ink-2 hover:text-ink">
                  Show {hiddenCount} {hiddenCount === 1 ? "person" : "people"} with no scheduled work
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex" style={{ minWidth: NAME_W + days.length * 56 + UNSCHED_W }}>
            {/* People column (sticky start) */}
            <div className="sticky start-0 z-20 shrink-0 border-e border-line bg-raised" style={{ width: NAME_W }}>
              <div className="flex items-center border-b border-line px-3 text-xs font-semibold text-ink-2" style={{ height: HEAD_H }}>People</div>
              {visible.map((r) => {
                const person = personById.get(r.key) ?? null;
                const isOpen = expanded.has(r.key);
                const capTotal = days.reduce((sum, d) => sum + capFor(r.key, d), 0);
                const summary = s.mode === "hours" ? `${fmtH(r.totalHours)}h / ${fmtH(capTotal)}h` : `${r.totalTasks} / ${capTotal} tasks`;
                return (
                  <Fragment key={r.key}>
                    <div className="flex items-center gap-2 border-b border-line-soft px-3" style={{ height: ROW_H }}>
                      <button type="button" onClick={() => toggleExpanded(r.key)} aria-expanded={isOpen}
                        aria-label={isOpen ? `Collapse ${personName(person)}` : `Expand ${personName(person)}`}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-hover">
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                      {person ? (
                        <PersonAvatar person={{ ...person, email: null }} size={28} />
                      ) : (
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2"><Users className="h-3.5 w-3.5" /></span>
                      )}
                      {/* Name over the load summary: a 240 column cannot hold both on
                          one line without cutting the name, and two people whose
                          names start alike must never read the same. */}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={`truncate text-row font-medium ${person ? "text-ink" : "text-ink-2"}`} title={personName(person)}>{personName(person)}</span>
                        {r.key === UNASSIGNED && r.overdue.length === 0 ? null : (
                          <span className="flex min-w-0 items-center gap-1 truncate text-sm tabular-nums text-ink-2">
                            {r.key === UNASSIGNED ? null : <span className="truncate">{summary}</span>}
                            {r.overdue.length > 0 ? (
                              <>
                                {r.key === UNASSIGNED ? null : <span aria-hidden>·</span>}
                                <button type="button"
                                  onClick={(e) => openPopover(r.key, `${personName(person)} · Overdue`, r.overdue, e.currentTarget)}
                                  className="shrink-0 font-medium text-danger-text hover:underline"
                                  aria-label={`${r.overdue.length} overdue for ${personName(person)}`}>
                                  {r.overdue.length} overdue
                                </button>
                              </>
                            ) : null}
                          </span>
                        )}
                      </span>
                    </div>
                    {isOpen ? (
                      <>
                        {r.windowItems.slice(0, ITEM_CAP).map((id) => {
                          const it = itemById.get(id);
                          if (!it) return null;
                          const current = it.status ? statusLookup[it.status] ?? null : null;
                          const due = parseDate(it.dueAt);
                          return (
                            <div key={id} className="flex h-8 items-center gap-2 border-b border-line-soft bg-subtle ps-10 pe-3">
                              <StatusGlyph current={current} statuses={statuses} />
                              <button type="button" onClick={() => onOpenItem?.(it.id)} className="min-w-0 flex-1 truncate text-start text-sm text-ink hover:underline" title={it.title}>{it.title}</button>
                              <span className={`text-xs tabular-nums ${due && due.getTime() < todayTime ? "text-danger-text" : "text-ink-2"}`}>{due ? formatDate(due, datePrefs, "date") : ""}</span>
                            </div>
                          );
                        })}
                        {r.windowItems.length > ITEM_CAP ? (
                          <div className="flex h-8 items-center border-b border-line-soft bg-subtle ps-10 pe-3 text-xs text-ink-2">+{r.windowItems.length - ITEM_CAP} more</div>
                        ) : null}
                      </>
                    ) : null}
                  </Fragment>
                );
              })}
              {hiddenCount > 0 ? (
                <button type="button" onClick={() => change({ showAllPeople: !s.showAllPeople })} className="h-8 w-full truncate px-3 text-start text-sm text-ink-2 hover:text-ink"
                  title={s.showAllPeople ? "Hide people with no scheduled work" : `Show ${hiddenCount} ${hiddenCount === 1 ? "person" : "people"} with no scheduled work`}>
                  {s.showAllPeople ? "Hide people with no work" : `Show ${hiddenCount} more ${hiddenCount === 1 ? "person" : "people"}`}
                </button>
              ) : null}
            </div>

            {/* Day columns */}
            <div className="min-w-0 flex-1">
              <div className="grid border-b border-line" style={{ gridTemplateColumns: cols, height: HEAD_H }}>
                {days.map((d, i) => {
                  const isToday = d.getTime() === todayTime;
                  const off = !s.countWeekends && capacityOn({ schedule }, d, { mode: "hours", dailyTasks: 1, countWeekends: false }) === 0;
                  return (
                    <div key={i} className={`flex items-center justify-center border-s border-line-soft first:border-s-0 ${off ? "bg-subtle" : ""}`}>
                      <span className={`inline-flex flex-col items-center rounded-md px-1.5 py-0.5 text-xs leading-4 ${isToday ? "ring-1 ring-[var(--os-brand)]" : ""}`}>
                        <span className="font-medium text-ink-2">{WEEKDAY[d.getDay()]}</span>
                        <span className={`tabular-nums ${isToday ? "font-semibold text-ink" : "text-ink-2"}`}>{d.getDate()}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {visible.map((r) => (
                <Fragment key={r.key}>
                  <div className="grid border-b border-line-soft" style={{ gridTemplateColumns: cols, height: ROW_H }}>
                    {days.map((d, i) => (
                      <DayCell
                        key={i}
                        dayLabel={dayLabel(d)}
                        load={r.days[i]}
                        cap={capFor(r.key, d)}
                        mode={s.mode}
                        holiday={holidayOn(schedule, d)}
                        onOpen={(el) => openPopover(r.key, `${personName(personById.get(r.key) ?? null)} · ${dayLabel(d)}`, r.days[i].itemIds, el)}
                      />
                    ))}
                  </div>
                  {Array.from({ length: fillerRows(r) }, (_, i) => <div key={i} className="h-8 border-b border-line-soft bg-subtle" />)}
                </Fragment>
              ))}
              {hiddenCount > 0 ? <div className="h-8" aria-hidden="true" /> : null}
            </div>

            {/* Unscheduled (sticky end) */}
            <div className="sticky end-0 z-20 shrink-0 border-s border-line bg-raised" style={{ width: UNSCHED_W }}>
              <div className="flex items-center justify-center border-b border-line px-2 text-xs font-semibold text-ink-2" style={{ height: HEAD_H }}>Unscheduled</div>
              {visible.map((r) => (
                <Fragment key={r.key}>
                  <div className="flex items-center justify-center border-b border-line-soft" style={{ height: ROW_H }}>
                    {r.unscheduled.length > 0 ? (
                      <button type="button"
                        onClick={(e) => openPopover(r.key, `${personName(personById.get(r.key) ?? null)} · Unscheduled`, r.unscheduled, e.currentTarget)}
                        className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium tabular-nums text-ink hover:bg-hover"
                        aria-label={`${r.unscheduled.length} unscheduled for ${personName(personById.get(r.key) ?? null)}`}>
                        {r.unscheduled.length}
                      </button>
                    ) : (
                      <span className="text-sm tabular-nums text-ink-3">0</span>
                    )}
                  </div>
                  {Array.from({ length: fillerRows(r) }, (_, i) => <div key={i} className="h-8 border-b border-line-soft bg-subtle" />)}
                </Fragment>
              ))}
              {hiddenCount > 0 ? <div className="h-8" aria-hidden="true" /> : null}
            </div>
          </div>
        )}
      </div>

      {pop ? (
        <MorePortal anchorRef={popAnchor} width={280} open placement="below" onClose={() => setPop(null)}>
          <div className="os-chrome rounded-lg border border-line bg-raised shadow-[var(--os-shadow-pop)]" role="dialog" aria-label={pop.title}>
            <div className="border-b border-line-soft px-3 py-2 text-sm font-medium text-ink">{pop.title}</div>
            {pop.ids.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-2">Nothing on this day.</p>
            ) : (
              <ul className="max-h-[280px] overflow-y-auto py-1">
                {pop.ids.map((id) => {
                  const it = itemById.get(id);
                  if (!it) return null;
                  const assignable = pop.key === UNASSIGNED && !!onAssign && (canAssign ? canAssign(it) : canEdit);
                  return (
                    <li key={id} className="relative flex items-center gap-2 px-3 py-1.5 hover:bg-hover">
                      <button type="button" onClick={() => { setPop(null); onOpenItem?.(it.id); }} className="min-w-0 flex-1 text-start">
                        <span className="block truncate text-sm text-ink">{it.title}</span>
                        {it.boardId && boardNames?.[it.boardId] ? <span className="block truncate text-xs text-ink-2">{boardNames[it.boardId]}</span> : null}
                      </button>
                      {it.priority && it.priority.toLowerCase() !== "none" ? <Flag className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-label={`Priority ${it.priority.toLowerCase()}`} /> : null}
                      {assignable ? (
                        <>
                          <button type="button" onClick={() => setAssignFor(assignFor === id ? null : id)} aria-label={`Assign ${it.title}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                            <UserPlus className="h-4 w-4" />
                          </button>
                          {assignFor === id ? (
                            <Picker
                              open
                              onClose={() => setAssignFor(null)}
                              ariaLabel="Assign to"
                              searchPlaceholder="Search people"
                              sections={[{ options: people.map((p) => ({ value: p.id, label: personName(p) })) }]}
                              onSelect={(pid) => {
                                setAssignFor(null);
                                void onAssign!(id, pid).then((ok) => { if (ok) setPop((cur) => (cur ? { ...cur, ids: cur.ids.filter((x) => x !== id) } : cur)); });
                              }}
                              className="absolute end-0 top-9 z-50"
                            />
                          ) : null}
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </MorePortal>
      ) : null}
    </section>
  );
}

// ── Day cell ───────────────────────────────────────────────────────
function DayCell({ dayLabel, load, cap, mode, holiday, onOpen }: {
  /** The day in the viewer's date format ("Mon, 21 Sep"). */
  dayLabel: string;
  load: { tasks: number; hours: number; unestimated: number; itemIds: string[] };
  cap: number;
  mode: WorkloadSettings["mode"];
  holiday: Holiday | null;
  onOpen: (el: HTMLElement) => void;
}) {
  const loadVal = mode === "hours" ? load.hours : load.tasks;
  const over = overBy(loadVal, cap);
  const label = mode === "hours" ? `${fmtH(load.hours)}h` : String(load.tasks);
  const breakdown = mode === "hours"
    ? `${fmtH(load.hours)}h of ${fmtH(cap)}h · ${load.tasks} ${load.tasks === 1 ? "task" : "tasks"}`
    : `${load.tasks} of ${cap} ${cap === 1 ? "task" : "tasks"}`;
  const unest = mode === "hours" && load.unestimated > 0 ? `${load.unestimated} ${load.unestimated === 1 ? "task" : "tasks"} without an estimate` : "";
  const why = holiday ? holiday.name : cap === 0 ? "Not a working day" : "";
  const title = [dayLabel, breakdown, unest, over > 0 ? `Over by ${mode === "hours" ? `${fmtH(over)}h` : over}` : "", why].filter(Boolean).join(" · ");
  const util = cap > 0 ? Math.min(loadVal / cap, 1) : loadVal > 0 ? 1 : 0;
  const bg = over > 0 ? "bg-[var(--os-danger-bg)]" : cap === 0 ? "bg-subtle" : "";

  return (
    <div className="border-s border-line-soft p-[3px] first:border-s-0">
      <button type="button" onClick={(e) => onOpen(e.currentTarget)} title={title} aria-label={title}
        className={`relative h-full w-full overflow-hidden rounded-md text-center ${bg} hover:ring-1 hover:ring-[var(--os-line-strong)]`}>
        {loadVal > 0 && over === 0 ? (
          <span aria-hidden className="absolute inset-x-0 bottom-0 bg-[var(--os-surface-2)]" style={{ height: `${util * 100}%` }} />
        ) : null}
        <span className={`relative text-sm font-medium tabular-nums ${over > 0 ? "text-danger-text" : loadVal > 0 ? "text-ink" : "text-ink-3"}`}>
          {loadVal > 0 ? label : mode === "hours" ? "0h" : "0"}
        </span>
        {over > 0 ? (
          <span className="absolute end-0.5 top-0.5 rounded px-1 text-micro font-medium leading-4 tabular-nums text-danger-text">
            +{mode === "hours" ? `${fmtH(over)}h` : over}
          </span>
        ) : null}
        {mode === "hours" && load.unestimated > 0 ? (
          <CircleDashed aria-hidden className="absolute start-1 top-1 h-3 w-3 text-ink-2" />
        ) : null}
      </button>
    </div>
  );
}
