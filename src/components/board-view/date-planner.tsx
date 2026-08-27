"use client";

// DatePlanner — the ClickUp-style scheduling popover for a task. One trigger,
// three working tabs:
//   • Date    — set/clear Start + Due (datetime), with quick chips + a month grid.
//   • Reminder — arm one or more reminders (relative to due or a custom time).
//                Task reminders are real Reminder rows (entityType BOARD_ITEM)
//                so they fire through the existing ticker/cron + topbar bell.
//   • Repeat   — the full "Set Recurring" panel: frequency + interval, a trigger
//                (on schedule vs on-complete), create-new-vs-roll-forward,
//                recur-forever / ends-after, update-status-to, sync-to-due.
//                Edits are buffered and committed on Save.
//
// It mounts two ways:
//   • full  (default) — a bordered "Set date" chip; used in the task detail.
//   • compact         — a ClickUp card chip (calendar icon + short due); used
//                       on kanban cards and the table Due cell so Set Recurring
//                       is reachable straight from a task's date icon.
//
// The panel is portaled with fixed positioning (useAnchorPos) so it escapes the
// drawer's / card's overflow clip.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays, CalendarPlus, Bell, Repeat, X, Loader2, Plus, Trash2, ChevronLeft, ChevronRight,
} from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { DetailPatch } from "./board-item-detail";
import { useAnchorPos } from "./use-anchor-pos";
import {
  parseRecurrence, buildRecurrenceSummary, isoWeekday, type RecurFreq, type RecurTrigger, type RecurrenceRule,
} from "@/lib/recurrence";

type Tab = "date" | "reminder" | "repeat";

type TaskReminder = {
  id: string;
  title: string;
  remindAt: string;
  notifyEmail: boolean;
};

// One width for every tab — must match the value handed to useAnchorPos so the
// clamp/flip math stays correct when the panel opens near the right edge.
const PANEL_WIDTH = 520;

// ── date <-> datetime-local helpers ────────────────────────────────
function pad(n: number) { return String(n).padStart(2, "0"); }
function toLocalInput(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function fmtWhen(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDay(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const FREQ_LABEL: Record<RecurFreq, string> = { DAY: "Daily", WEEK: "Weekly", MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" };
const FREQ_UNIT: Record<RecurFreq, string> = { DAY: "day", WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" };
// Quarterly is legacy-only: hidden from the picker unless the open rule uses it.
const BASE_FREQS: RecurFreq[] = ["DAY", "WEEK", "MONTH", "YEAR"];
const WEEKDAY_CHIPS: { v: number; label: string }[] = [
  { v: 1, label: "Mo" }, { v: 2, label: "Tu" }, { v: 3, label: "We" }, { v: 4, label: "Th" },
  { v: 5, label: "Fr" }, { v: 6, label: "Sa" }, { v: 7, label: "Su" },
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Quick-date offsets, ClickUp's set. Each returns a due Date (end of workday).
function quickDate(kind: string): Date {
  const d = new Date();
  const day = d.getDay(); // 0 Sun … 6 Sat
  switch (kind) {
    case "today": d.setHours(17, 0, 0, 0); break;
    case "later": d.setHours(Math.min(23, d.getHours() + 3), 0, 0, 0); break;
    case "tomorrow": d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); break;
    case "weekend": d.setDate(d.getDate() + ((6 - day + 7) % 7)); d.setHours(17, 0, 0, 0); break; // this Saturday
    case "nextweek": d.setDate(d.getDate() + ((8 - day) % 7 || 7)); d.setHours(9, 0, 0, 0); break; // next Monday
    case "nextweekend": d.setDate(d.getDate() + ((6 - day + 7) % 7) + 7); d.setHours(17, 0, 0, 0); break; // next Saturday
    case "2weeks": d.setDate(d.getDate() + 14); d.setHours(17, 0, 0, 0); break;
    case "4weeks": d.setDate(d.getDate() + 28); d.setHours(17, 0, 0, 0); break;
    default: d.setHours(17, 0, 0, 0);
  }
  return d;
}
// Right-aligned hint on each quick row (ClickUp shows the resolved day/time).
function quickHint(kind: string): string {
  const d = quickDate(kind);
  if (kind === "later") return d.toLocaleTimeString("en-US", { hour: "numeric" }).toLowerCase();
  if (kind === "2weeks" || kind === "4weeks") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
const QUICK_CHIPS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "later", label: "Later" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "weekend", label: "This weekend" },
  { key: "nextweek", label: "Next week" },
  { key: "nextweekend", label: "Next weekend" },
  { key: "2weeks", label: "2 weeks" },
  { key: "4weeks", label: "4 weeks" },
];

// Shared micro-styles.
const LABEL = "text-[11.5px] font-medium uppercase tracking-wide text-zinc-400";
const FIELD = "h-8 px-2 rounded-md border border-zinc-200 bg-white text-[13px] text-zinc-700 outline-none dark:bg-[#1B1F26] dark:border-[#2A2F38] dark:text-zinc-200 focus:border-[var(--os-brand)] transition-colors";

export function DatePlanner({
  item, canEdit, onPatch, statuses = [], compact = false, done = false,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  onPatch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
  /** Board statuses — feeds the "Update status to" dropdown. */
  statuses?: StatusOption[];
  /** Render the compact card chip instead of the full bordered "Set date". */
  compact?: boolean;
  /** Is the task complete? Only affects overdue coloring on the compact chip. */
  done?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("date");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchorPos(btnRef, open, PANEL_WIDTH);

  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [remLoading, setRemLoading] = useState(false);
  const recurrence = parseRecurrence(item.recurRule);

  const loadReminders = useCallback(async () => {
    setRemLoading(true);
    try {
      const res = await fetch(`/api/reminders?entityType=BOARD_ITEM&entityId=${item.id}`);
      if (res.ok) {
        const d = await res.json();
        setReminders(Array.isArray(d.reminders) ? d.reminders : []);
      }
    } catch { /* ignore */ }
    finally { setRemLoading(false); }
  }, [item.id]);

  // Fetch reminder rows the first time the popover opens.
  useEffect(() => {
    if (open) void loadReminders();
  }, [open, loadReminders]);

  // Click-outside + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  // ── writers ──────────────────────────────────────────────────────
  const setDates = (patch: { startAt?: string | null; dueAt?: string | null }) => {
    onPatch(patch, patch);
  };
  const setRecurrence = (rule: RecurrenceRule | null) => {
    onPatch({ recurRule: rule }, { recurRule: rule });
  };

  const addReminder = async (at: Date) => {
    try {
      const res = await fetch("/api/reminders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title || "Task reminder",
          remindAt: at.toISOString(),
          entityType: "BOARD_ITEM", entityId: item.id,
        }),
      });
      if (res.ok) void loadReminders();
    } catch { /* ignore */ }
  };
  const removeReminder = async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    try { await fetch(`/api/reminders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    catch { void loadReminders(); }
  };

  // ── trigger summary ──────────────────────────────────────────────
  const due = item.dueAt ?? null;
  const start = item.startAt ?? null;
  const dueDate = due ? new Date(due) : null;
  const overdue = !!dueDate && dueDate < new Date() && !done;
  const hasReminder = reminders.length > 0;
  const summary = due ? fmtDay(due) : start ? `${fmtDay(start)} →` : "";

  const tabBtn = (key: Tab, Icon: typeof CalendarDays, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 h-9 text-[13px] font-medium border-b-2 transition-colors ${
        tab === key ? "border-[var(--os-brand)] text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${tab === key ? "text-[var(--os-brand)]" : ""}`} /> {label}
    </button>
  );
  const chip = "inline-flex items-center h-7 px-2.5 rounded-md text-[13px] border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors";

  // ── trigger button ───────────────────────────────────────────────
  const trigger = compact ? (
    <button
      ref={btnRef}
      type="button"
      disabled={!canEdit}
      onClick={(e) => { e.stopPropagation(); if (canEdit) setOpen((v) => !v); }}
      className={`inline-flex items-center gap-1 rounded font-medium disabled:cursor-default ${
        due
          ? `px-1.5 py-0.5 text-[11.5px] ${overdue ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-600"}`
          : "text-zinc-400 hover:text-zinc-600"
      }`}
      title={due ? "Edit date / recurrence" : "Set date"}
    >
      <CalendarPlus className={due ? "w-3 h-3" : "w-[17px] h-[17px]"} />
      {due ? new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null}
      {hasReminder ? <Bell className="w-2.5 h-2.5 text-amber-500" /> : null}
      {recurrence ? (
        <span className="inline-flex" title={buildRecurrenceSummary(recurrence)}>
          <Repeat className="w-2.5 h-2.5 text-[var(--os-brand)]" />
        </span>
      ) : null}
    </button>
  ) : (
    <button
      ref={btnRef}
      type="button"
      onClick={(e) => { e.stopPropagation(); if (canEdit) setOpen((v) => !v); }}
      disabled={!canEdit}
      className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 max-w-full"
    >
      <CalendarDays className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
      <span className={`truncate ${summary ? "" : "text-zinc-400"}`}>{summary || "Set date"}</span>
      {hasReminder ? <Bell className="w-3 h-3 text-amber-500 flex-shrink-0" /> : null}
      {recurrence ? (
        <span className="inline-flex flex-shrink-0" title={buildRecurrenceSummary(recurrence)}>
          <Repeat className="w-3 h-3 text-[var(--os-brand)]" />
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      {trigger}

      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                left: pos.left,
                width: PANEL_WIDTH,
                // Hook-fitted: flips above near the bottom edge, and the
                // maxHeight always fits the chosen side so the Repeat
                // tab scrolls inside the panel instead of off-screen.
                ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
                maxHeight: Math.min(pos.maxHeight, Math.round(window.innerHeight * 0.78)),
              }}
              className="z-[120] rounded-xl bg-white dark:bg-[#14171D] border border-zinc-200 dark:border-[#2A2F38] dark:text-zinc-200 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.16)] overflow-hidden flex flex-col"
              // Keep popover interactions from bubbling (React tree) to the row /
              // card that hosts this planner — otherwise a click here can trigger
              // the ancestor's open/select handlers.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Tab strip */}
              <div className="flex items-stretch border-b border-zinc-100 px-2 shrink-0">
                {tabBtn("date", CalendarDays, "Date")}
                {tabBtn("reminder", Bell, "Reminder")}
                {tabBtn("repeat", Repeat, "Repeat")}
              </div>

              <div className="p-4 overflow-y-auto">
                {tab === "date" ? (
                  <DateTab
                    start={start}
                    due={due}
                    onQuick={(k) => setDates({ dueAt: quickDate(k).toISOString() })}
                    onPickDay={(d) => setDates({ dueAt: d.toISOString() })}
                    onStart={(v) => setDates({ startAt: v })}
                    onDue={(v) => setDates({ dueAt: v })}
                    onRepeat={() => setTab("repeat")}
                    recurrence={recurrence}
                  />
                ) : null}

                {tab === "reminder" ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <span className={`block ${LABEL}`}>Quick reminders</span>
                      {due ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button type="button" className={chip} onClick={() => addReminder(new Date(due))}>At due date</button>
                          <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 5 * 60000))}>5m before</button>
                          <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 30 * 60000))}>30m before</button>
                          <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 60 * 60000))}>1h before</button>
                          <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 24 * 60 * 60000))}>1d before</button>
                        </div>
                      ) : (
                        <p className="text-[13px] text-zinc-400">Set a due date to use quick reminders, or pick a custom time below.</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <span className={`block ${LABEL}`}>Custom</span>
                      <CustomReminder onAdd={addReminder} />
                    </div>
                    <div className="pt-3 border-t border-zinc-100 space-y-1.5">
                      <span className={`block ${LABEL}`}>Scheduled</span>
                      {remLoading ? (
                        <div className="flex items-center gap-2 text-[13px] text-zinc-400 py-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
                      ) : reminders.length === 0 ? (
                        <p className="text-[13px] text-zinc-400 py-1">No reminders set.</p>
                      ) : (
                        <ul>
                          {reminders.map((r) => (
                            <li key={r.id} className="flex items-center gap-2 h-8 px-2 -mx-2 rounded-md text-[13.5px] text-zinc-700 hover:bg-zinc-50 transition-colors">
                              <Bell className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                              <span className="flex-1 truncate">{fmtWhen(r.remindAt)}</span>
                              <button type="button" onClick={() => removeReminder(r.id)} className="text-zinc-300 hover:text-red-600 transition-colors" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}

                {tab === "repeat" ? (
                  <RepeatTab
                    rule={recurrence}
                    statuses={statuses}
                    due={due}
                    onPickDay={(d) => setDates({ dueAt: d.toISOString() })}
                    onCancel={() => setTab("date")}
                    onSave={(r) => { setRecurrence(r); }}
                  />
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ── Month calendar — shared by the Date and Repeat tabs ────────────
// Airy ClickUp-style grid: weekday header, adjacent-month days muted, today
// ringed with the accent, the due day filled with the accent.
function MonthCalendar({ due, onPickDay }: { due: Date | string | null; onPickDay: (d: Date) => void }) {
  const parsed = due ? new Date(due) : null;
  const dueDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const [cursor, setCursor] = useState(() => {
    const base = dueDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const today = new Date();

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const startPad = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: { d: Date; inMonth: boolean }[] = [];
    for (let i = startPad; i > 0; i--) list.push({ d: new Date(year, month, 1 - i), inMonth: false });
    for (let day = 1; day <= daysInMonth; day++) list.push({ d: new Date(year, month, day), inMonth: true });
    let trailing = 1;
    while (list.length % 7 !== 0) { list.push({ d: new Date(year, month + 1, trailing), inMonth: false }); trailing++; }
    return list;
  }, [cursor]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[14px] font-semibold text-zinc-800">
          {cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="w-6 h-6 inline-flex items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }} className="px-1.5 h-6 inline-flex items-center rounded-md text-[12px] text-zinc-500 hover:bg-zinc-100 transition-colors">Today</button>
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="w-6 h-6 inline-flex items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 mb-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map(({ d, inMonth }, i) => {
          const isToday = sameDay(d, today);
          const isDue = dueDate ? sameDay(d, dueDate) : false;
          return (
            <button
              key={i}
              type="button"
              onClick={() => { const nd = new Date(d); nd.setHours(17, 0, 0, 0); onPickDay(nd); }}
              className={`h-8 w-8 mx-auto inline-flex items-center justify-center rounded-full text-[13px] transition-colors ${
                isDue ? "bg-[var(--os-brand)] text-white font-semibold"
                : isToday ? "text-[var(--os-brand)] font-semibold ring-1 ring-inset ring-[var(--os-brand)] hover:bg-zinc-100"
                : inMonth ? "text-zinc-700 hover:bg-zinc-100"
                : "text-zinc-300 hover:bg-zinc-50 hover:text-zinc-500"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Date tab: Start/Due inputs up top, quick list + month grid below ─
function DateTab({
  start, due, onQuick, onPickDay, onStart, onDue, onRepeat, recurrence,
}: {
  start: Date | string | null;
  due: Date | string | null;
  onQuick: (kind: string) => void;
  onPickDay: (d: Date) => void;
  onStart: (v: string | null) => void;
  onDue: (v: string | null) => void;
  onRepeat: () => void;
  recurrence: RecurrenceRule | null;
}) {
  return (
    <div className="space-y-4">
      {/* Start / Due across the top, ClickUp-style */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0">
          <span className={`flex items-center justify-between h-4 ${LABEL}`}>
            Start date
            {start ? <button type="button" onClick={() => onStart(null)} className="text-zinc-300 hover:text-zinc-600 transition-colors" title="Clear"><X className="w-3 h-3" /></button> : null}
          </span>
          <input
            type="datetime-local"
            value={toLocalInput(start)}
            onChange={(e) => onStart(localToIso(e.target.value))}
            className={`${FIELD} mt-1 w-full`}
          />
        </label>
        <label className="block min-w-0">
          <span className={`flex items-center justify-between h-4 ${LABEL}`}>
            Due date
            {due ? <button type="button" onClick={() => onDue(null)} className="text-zinc-300 hover:text-zinc-600 transition-colors" title="Clear"><X className="w-3 h-3" /></button> : null}
          </span>
          <input
            type="datetime-local"
            value={toLocalInput(due)}
            onChange={(e) => onDue(localToIso(e.target.value))}
            className={`${FIELD} mt-1 w-full`}
          />
        </label>
      </div>

      {/* Quick options on the left, month calendar on the right */}
      <div className="flex gap-4">
        <div className="w-[150px] shrink-0 border-r border-zinc-100 pr-3 space-y-0.5">
          {QUICK_CHIPS.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => onQuick(q.key)}
              className="w-full h-7 px-2 rounded-md flex items-center justify-between gap-2 text-[13px] text-zinc-700 hover:bg-zinc-100 transition-colors"
            >
              <span className="truncate">{q.label}</span>
              <span className="text-[12px] text-zinc-400 shrink-0">{quickHint(q.key)}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <MonthCalendar due={due} onPickDay={onPickDay} />
        </div>
      </div>

      {/* Set Recurring entry (ClickUp routes into the Repeat tab from here). */}
      <div className="pt-2 border-t border-zinc-100">
        <button
          type="button"
          onClick={onRepeat}
          className="w-full flex items-center justify-between h-8 px-2 rounded-md text-[13.5px] text-zinc-700 hover:bg-zinc-100 transition-colors"
        >
          <span className="inline-flex items-center gap-2 shrink-0"><Repeat className="w-3.5 h-3.5 text-zinc-400" /> Set Recurring</span>
          <span
            className="text-[12.5px] font-medium text-[var(--os-brand)] truncate min-w-0"
            title={recurrence ? buildRecurrenceSummary(recurrence) : undefined}
          >
            {recurrence ? buildRecurrenceSummary(recurrence) : ""}
          </span>
        </button>
      </div>
    </div>
  );
}

// Custom datetime reminder input (used in both due/no-due cases).
function CustomReminder({ onAdd }: { onAdd: (at: Date) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        type="datetime-local"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className={`${FIELD} flex-1`}
      />
      <button
        type="button"
        disabled={!val}
        onClick={() => { const d = new Date(val); if (!Number.isNaN(d.getTime())) { onAdd(d); setVal(""); } }}
        className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-[13px] font-medium text-white bg-[var(--os-brand)] hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
    </div>
  );
}

// ── Repeat tab: the full "Set Recurring" panel ─────────────────────
// Buffered — nothing is written until Save, matching ClickUp. Options live on
// the left; the month calendar (same due-date picker) sits on the right. The
// anchor is ALWAYS the task's due date (changing it re-anchors the series).
function RepeatTab({
  rule, statuses, due, onPickDay, onCancel, onSave,
}: {
  rule: RecurrenceRule | null;
  statuses: StatusOption[];
  due: Date | string | null;
  onPickDay: (d: Date) => void;
  onCancel: () => void;
  onSave: (r: RecurrenceRule | null) => void;
}) {
  // The due date seeds the frequency defaults (weekday / month day / year date).
  const dueDate = useMemo(() => {
    const d = due ? new Date(due) : null;
    return d && !Number.isNaN(d.getTime()) ? d : new Date();
  }, [due]);

  const [freq, setFreq] = useState<RecurFreq>(rule?.freq ?? "WEEK");
  const [interval, setIntervalN] = useState<number>(rule?.interval ?? 1);
  const [trigger, setTrigger] = useState<RecurTrigger>(rule?.trigger === "ON_COMPLETE" ? "ON_COMPLETE" : "SCHEDULE");
  const [weekdays, setWeekdays] = useState<number[]>(
    rule?.weekdays?.length ? [...rule.weekdays].sort((a, b) => a - b) : [isoWeekday(dueDate)],
  );
  const [monthDay, setMonthDay] = useState<number>(rule?.monthDay ?? dueDate.getDate());
  const [yearMonth, setYearMonth] = useState<number>(rule?.yearMonth ?? dueDate.getMonth() + 1);
  const [yearDay, setYearDay] = useState<number>(rule?.yearDay ?? dueDate.getDate());
  // Explicit time-of-day ("HH:MM") — empty = inherit the due date's time.
  // Never prefilled: an unset rule stays unset until the user picks a time.
  const [atTime, setAtTime] = useState<string>(rule?.atTime ?? "");
  const [ends, setEnds] = useState<"never" | "until" | "count">(
    rule && rule.forever === false ? (rule.until ? "until" : "count") : "never",
  );
  const [untilDate, setUntilDate] = useState<string>(() => {
    if (rule?.until) {
      const d = new Date(rule.until);
      if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return "";
  });
  const [count, setCount] = useState<number>(rule?.count && rule.count > 0 ? rule.count : 5);
  const firstOpen = statuses.find((s) => s.group === "ACTIVE")?.value ?? statuses[0]?.value ?? "";
  const [resetOn, setResetOn] = useState<boolean>(rule?.resetStatus != null);
  const [resetStatus, setResetStatus] = useState<string>(rule?.resetStatus ?? firstOpen);

  // Quarterly is legacy-only — keep it in the picker only for an open QUARTER rule.
  const freqOptions = rule?.freq === "QUARTER" ? (["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"] as RecurFreq[]) : BASE_FREQS;

  // The rule Save would write — also feeds the live plain-English summary.
  const draft: RecurrenceRule = useMemo(() => ({
    freq,
    interval,
    trigger,
    // The two spec modes: On schedule spawns fresh copies; After completion
    // rolls this task forward. syncDue is never written (always-sync).
    createNew: trigger === "SCHEDULE",
    forever: ends === "never",
    count: ends === "count" ? Math.max(1, count) : null,
    until: ends === "until" && untilDate
      ? (() => {
          const [y, m, d] = untilDate.split("-").map(Number);
          return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
        })()
      : null,
    resetStatus: resetOn ? resetStatus || null : null,
    weekdays: freq === "WEEK" ? weekdays : null,
    monthDay: freq === "MONTH" ? monthDay : null,
    yearMonth: freq === "YEAR" ? yearMonth : null,
    yearDay: freq === "YEAR" ? yearDay : null,
    // "HH:MM" (some engines emit "HH:MM:SS" — trim); empty input = null =
    // occurrences keep inheriting the due date's time-of-day.
    atTime: /^([01]\d|2[0-3]):[0-5]\d/.test(atTime) ? atTime.slice(0, 5) : null,
  }), [freq, interval, trigger, ends, count, untilDate, resetOn, resetStatus, weekdays, monthDay, yearMonth, yearDay, atTime]);

  const saveDisabled = ends === "until" && !untilDate;

  const toggleWeekday = (v: number) => {
    setWeekdays((prev) => {
      if (prev.includes(v)) return prev.length > 1 ? prev.filter((x) => x !== v) : prev; // at least one day
      return [...prev, v].sort((a, b) => a - b);
    });
  };

  const check = "w-3.5 h-3.5 rounded border-zinc-300 accent-[var(--os-brand)]";
  const radio = "w-3.5 h-3.5 accent-[var(--os-brand)]";

  return (
    <div>
      <div className="flex gap-4">
        {/* Recurrence options */}
        <div className="flex-1 min-w-0 space-y-3.5">
          <div className="space-y-1">
            <span className={`block ${LABEL}`}>Recurring</span>
            <select value={freq} onChange={(e) => setFreq(e.target.value as RecurFreq)} className={`${FIELD} w-full`}>
              {freqOptions.map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-zinc-600">
            Every
            <input
              type="number" min={1} max={365} value={interval}
              onChange={(e) => setIntervalN(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              className={`${FIELD} w-14`}
            />
            {FREQ_UNIT[freq]}{interval > 1 ? "s" : ""}
          </label>

          {/* Frequency-specific controls — only what each frequency needs. */}
          {freq === "WEEK" ? (
            <div className="space-y-1">
              <span className={`block ${LABEL}`}>On days</span>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_CHIPS.map((w) => {
                  const on = weekdays.includes(w.v);
                  return (
                    <button
                      key={w.v}
                      type="button"
                      onClick={() => toggleWeekday(w.v)}
                      className={`h-7 rounded-md text-[12.5px] font-medium transition-colors ${
                        on ? "bg-[var(--os-brand)] text-white" : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {freq === "MONTH" ? (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-[13px] text-zinc-600">
                On day
                <input
                  type="number" min={1} max={31} value={monthDay}
                  onChange={(e) => setMonthDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                  className={`${FIELD} w-14`}
                />
              </label>
              {monthDay >= 29 ? (
                <p className="text-[12px] text-zinc-400">Days 29-31 fall on the last day of shorter months.</p>
              ) : null}
            </div>
          ) : null}
          {freq === "YEAR" ? (
            <div className="flex items-center gap-2 text-[13px] text-zinc-600">
              On
              <select value={yearMonth} onChange={(e) => setYearMonth(Number(e.target.value))} className={`${FIELD} flex-1 min-w-0`}>
                {MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input
                type="number" min={1} max={31} value={yearDay}
                onChange={(e) => setYearDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                className={`${FIELD} w-14`}
              />
            </div>
          ) : null}

          {/* Explicit occurrence time — empty = inherit the due date's time. */}
          <div className="space-y-1">
            <span className={`block ${LABEL}`}>At</span>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={atTime}
                onChange={(e) => setAtTime(e.target.value)}
                className={`${FIELD} w-[110px]`}
              />
              {atTime ? (
                <button
                  type="button"
                  onClick={() => setAtTime("")}
                  className="text-[12px] text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  clear
                </button>
              ) : (
                <span className="text-[12px] text-zinc-400">same time as the due date</span>
              )}
            </div>
          </div>

          {/* Repeat trigger — the ONE control that picks the recurrence mode. */}
          <div className="space-y-1">
            <span className={`block ${LABEL}`}>Repeat trigger</span>
            <div className="space-y-1.5">
              {([
                { v: "SCHEDULE", label: "On schedule", hint: "Each occurrence creates a new task" },
                { v: "ON_COMPLETE", label: "After completion", hint: "This task's due date moves forward" },
              ] as { v: RecurTrigger; label: string; hint: string }[]).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setTrigger(o.v)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md border transition-colors ${
                    trigger === o.v ? "border-[var(--os-brand)] bg-[#0073EA]/[0.04]" : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <span className={`block text-[13.5px] font-medium ${trigger === o.v ? "text-[var(--os-brand)]" : "text-zinc-700"}`}>
                    {o.label}
                  </span>
                  <span className="block text-[12px] text-zinc-400">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Ends: Never / On date / After N times */}
          <div className="space-y-1.5">
            <span className={`block ${LABEL}`}>Ends</span>
            <label className="flex items-center gap-2 text-[13.5px] text-zinc-700">
              <input type="radio" name="recur-ends" className={radio} checked={ends === "never"} onChange={() => setEnds("never")} />
              Never
            </label>
            <label className="flex items-center gap-2 text-[13.5px] text-zinc-700">
              <input type="radio" name="recur-ends" className={radio} checked={ends === "until"} onChange={() => setEnds("until")} />
              On date
              {ends === "until" ? (
                <input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className={`${FIELD} flex-1 min-w-0`} />
              ) : null}
            </label>
            <label className="flex items-center gap-2 text-[13.5px] text-zinc-700">
              <input type="radio" name="recur-ends" className={radio} checked={ends === "count"} onChange={() => setEnds("count")} />
              After
              {ends === "count" ? (
                <>
                  <input
                    type="number" min={1} max={999} value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                    className={`${FIELD} w-14`}
                  />
                  times
                </>
              ) : null}
            </label>
          </div>

          <div>
            <label className="flex items-center gap-2 text-[13.5px] text-zinc-700">
              <input type="checkbox" className={check} checked={resetOn} onChange={(e) => setResetOn(e.target.checked)} disabled={statuses.length === 0} />
              Update status to:
            </label>
            {resetOn ? (
              <select value={resetStatus} onChange={(e) => setResetStatus(e.target.value)} className={`${FIELD} mt-1.5 ml-[22px] w-[calc(100%-22px)]`}>
                {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            ) : null}
          </div>
        </div>

        {/* Month calendar (picks the due date the recurrence anchors to) */}
        <div className="w-[248px] shrink-0 border-l border-zinc-100 pl-4">
          <MonthCalendar due={due} onPickDay={onPickDay} />
        </div>
      </div>

      {/* Live plain-English summary + footer: Don't Recur · Cancel · Save */}
      <div className="pt-3 mt-4 border-t border-zinc-100">
        <p className="text-[13.5px] text-zinc-500">{buildRecurrenceSummary(draft)}</p>
        <div className="flex items-center gap-2 mt-3">
          {rule ? (
            <button type="button" onClick={() => onSave(null)} className="text-[13px] font-medium text-red-600 hover:text-red-700 transition-colors">Don&apos;t Recur</button>
          ) : null}
          <div className="flex-1" />
          <button type="button" onClick={onCancel} className="inline-flex items-center h-8 px-3 rounded-md text-[13.5px] text-zinc-600 hover:bg-zinc-100 transition-colors">Cancel</button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saveDisabled}
            className="inline-flex items-center h-8 px-4 rounded-md text-[13.5px] font-medium text-white bg-[var(--os-brand)] hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
