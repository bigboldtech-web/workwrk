"use client";

// DatePlanner — the ClickUp-style scheduling popover for a task. One trigger,
// three working tabs:
//   • Date    — set/clear Start + Due (datetime), with quick chips.
//   • Reminder — arm one or more reminders (relative to due or a custom time).
//                Task reminders are real Reminder rows (entityType BOARD_ITEM)
//                so they fire through the existing ticker/cron + topbar bell.
//   • Repeat   — a recurrence rule (Item.metadata.recurrence). Completion-based:
//                finishing the task rolls its dates forward server-side.
//
// The panel is portaled with fixed positioning (useAnchorPos) so it escapes the
// drawer's overflow-y-auto clip.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Bell, Repeat, X, Loader2, Plus, Trash2 } from "lucide-react";
import type { BoardItemRow } from "@/lib/board-items-shared";
import type { DetailPatch } from "./board-item-detail";
import { useAnchorPos } from "./use-anchor-pos";
import {
  parseRecurrence, describeRecurrence, type RecurFreq, type RecurrenceRule,
} from "@/lib/recurrence";

type Tab = "date" | "reminder" | "repeat";

type TaskReminder = {
  id: string;
  title: string;
  remindAt: string;
  notifyEmail: boolean;
};

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

const FREQ_LABEL: Record<RecurFreq, string> = { DAY: "Daily", WEEK: "Weekly", MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" };
const FREQ_UNIT: Record<RecurFreq, string> = { DAY: "day", WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" };
const FREQS: RecurFreq[] = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"];

export function DatePlanner({
  item, canEdit, onPatch,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  onPatch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("date");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchorPos(btnRef, open, 320);

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
  const quickDue = (offsetDays: number) => {
    const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(17, 0, 0, 0);
    setDates({ dueAt: d.toISOString() });
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

  const setRecurrence = (rule: RecurrenceRule | null) => {
    onPatch({ recurRule: rule }, { recurRule: rule });
  };

  // ── trigger summary ──────────────────────────────────────────────
  const due = item.dueAt ?? null;
  const start = item.startAt ?? null;
  const hasReminder = reminders.length > 0;
  const summary = due ? fmtDay(due) : start ? `${fmtDay(start)} →` : "";

  const tabBtn = (key: Tab, Icon: typeof CalendarDays, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 h-8 text-[12px] font-medium border-b-2 transition-colors ${
        tab === key ? "border-[var(--os-brand)] text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
  const chip = "px-2 py-1 rounded-md text-[11.5px] border border-zinc-200 text-zinc-600 hover:bg-zinc-50";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => canEdit && setOpen((v) => !v)}
        disabled={!canEdit}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 max-w-full"
      >
        <CalendarDays className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
        <span className={`truncate ${summary ? "" : "text-zinc-400"}`}>{summary || "Set date"}</span>
        {hasReminder ? <Bell className="w-3 h-3 text-amber-500 flex-shrink-0" /> : null}
        {recurrence ? <Repeat className="w-3 h-3 text-violet-500 flex-shrink-0" /> : null}
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: 320 }}
              className="z-[120] rounded-xl bg-white border border-zinc-200 shadow-2xl overflow-hidden"
            >
              {/* Tab strip */}
              <div className="flex items-stretch border-b border-zinc-100">
                {tabBtn("date", CalendarDays, "Date")}
                {tabBtn("reminder", Bell, "Reminder")}
                {tabBtn("repeat", Repeat, "Repeat")}
              </div>

              <div className="p-3">
                {tab === "date" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button type="button" className={chip} onClick={() => quickDue(0)}>Today</button>
                      <button type="button" className={chip} onClick={() => quickDue(1)}>Tomorrow</button>
                      <button type="button" className={chip} onClick={() => quickDue(7)}>Next week</button>
                    </div>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-wide text-zinc-500">Start</span>
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          type="datetime-local"
                          value={toLocalInput(start)}
                          onChange={(e) => setDates({ startAt: localToIso(e.target.value) })}
                          className="flex-1 h-8 px-2 rounded-md border border-zinc-200 text-[12.5px] outline-none focus:border-zinc-400"
                        />
                        {start ? <button type="button" onClick={() => setDates({ startAt: null })} className="text-zinc-400 hover:text-zinc-700" title="Clear"><X className="w-3.5 h-3.5" /></button> : null}
                      </div>
                    </label>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-wide text-zinc-500">Due</span>
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          type="datetime-local"
                          value={toLocalInput(due)}
                          onChange={(e) => setDates({ dueAt: localToIso(e.target.value) })}
                          className="flex-1 h-8 px-2 rounded-md border border-zinc-200 text-[12.5px] outline-none focus:border-zinc-400"
                        />
                        {due ? <button type="button" onClick={() => setDates({ dueAt: null })} className="text-zinc-400 hover:text-zinc-700" title="Clear"><X className="w-3.5 h-3.5" /></button> : null}
                      </div>
                    </label>
                  </div>
                ) : null}

                {tab === "reminder" ? (
                  <div className="space-y-3">
                    {due ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button type="button" className={chip} onClick={() => addReminder(new Date(due))}>At due time</button>
                        <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 10 * 60000))}>10m before</button>
                        <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 60 * 60000))}>1h before</button>
                        <button type="button" className={chip} onClick={() => addReminder(new Date(new Date(due).getTime() - 24 * 60 * 60000))}>1d before</button>
                      </div>
                    ) : (
                      <p className="text-[11.5px] text-zinc-400">Set a due date to use quick reminders, or pick a custom time below.</p>
                    )}
                    <CustomReminder onAdd={addReminder} />
                    <div className="pt-1 border-t border-zinc-100">
                      {remLoading ? (
                        <div className="flex items-center gap-2 text-[12px] text-zinc-400 py-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
                      ) : reminders.length === 0 ? (
                        <p className="text-[12px] text-zinc-400 py-1">No reminders set.</p>
                      ) : (
                        <ul className="space-y-1">
                          {reminders.map((r) => (
                            <li key={r.id} className="flex items-center gap-2 text-[12.5px] text-zinc-700">
                              <Bell className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                              <span className="flex-1 truncate">{fmtWhen(r.remindAt)}</span>
                              <button type="button" onClick={() => removeReminder(r.id)} className="text-zinc-400 hover:text-red-600" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}

                {tab === "repeat" ? (
                  <RepeatTab rule={recurrence} onChange={setRecurrence} />
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// Custom datetime reminder input (used in both due/no-due cases).
function CustomReminder({ onAdd }: { onAdd: (at: Date) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="datetime-local"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="flex-1 h-8 px-2 rounded-md border border-zinc-200 text-[12.5px] outline-none focus:border-zinc-400"
      />
      <button
        type="button"
        disabled={!val}
        onClick={() => { const d = new Date(val); if (!Number.isNaN(d.getTime())) { onAdd(d); setVal(""); } }}
        className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-[12px] text-white bg-[var(--os-brand)] hover:opacity-90 disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
    </div>
  );
}

// Repeat tab — frequency + interval; writes/clears the recurrence rule.
function RepeatTab({ rule, onChange }: { rule: RecurrenceRule | null; onChange: (r: RecurrenceRule | null) => void }) {
  const freq = rule?.freq ?? "WEEK";
  const interval = rule?.interval ?? 1;
  const set = (patch: Partial<RecurrenceRule>) => onChange({ freq, interval, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {FREQS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => set({ freq: f })}
            className={`h-8 rounded-md text-[12px] font-medium border transition-colors ${
              rule && freq === f ? "border-[var(--os-brand)] bg-[var(--os-brand)]/10 text-zinc-900" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {FREQ_LABEL[f]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-zinc-600">
        Every
        <input
          type="number"
          min={1}
          max={365}
          value={interval}
          onChange={(e) => set({ interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
          className="w-16 h-8 px-2 rounded-md border border-zinc-200 text-[12.5px] outline-none focus:border-zinc-400"
        />
        {FREQ_UNIT[freq]}{interval > 1 ? "s" : ""}
      </label>
      <p className="text-[11.5px] text-zinc-400">A fresh copy of this task, with its subtasks, is created automatically each cycle so every period has its own record.</p>
      <div className="flex items-center justify-between pt-1 border-t border-zinc-100">
        <span className="text-[12px] text-zinc-500">{rule ? describeRecurrence(rule) : "Doesn't repeat"}</span>
        {rule ? (
          <button type="button" onClick={() => onChange(null)} className="text-[12px] text-red-600 hover:underline">Don&apos;t repeat</button>
        ) : (
          <button type="button" onClick={() => onChange({ freq, interval })} className="text-[12px] text-[var(--os-brand)] hover:underline">Turn on</button>
        )}
      </div>
    </div>
  );
}
