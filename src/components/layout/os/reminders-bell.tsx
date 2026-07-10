"use client";

// RemindersBell — top-right alarm surface. Shows the current user's PENDING
// reminders (personal + task-scheduled) proactively, grouped Overdue / Today /
// Upcoming, with a count badge. Task reminders (entityType BOARD_ITEM) deep-link
// to the task. Snooze (+1h) or Done (dismiss) per row. Polls every 60s.
//
// Firing still happens via ReminderTicker/cron (a due reminder becomes a
// notification and leaves PENDING); this bell is the "what's coming up" view.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlarmClock, Bell, CheckSquare, Clock, Check, Plus } from "lucide-react";

type Reminder = {
  id: string;
  title: string;
  remindAt: string;
  entityType: string | null;
  entityId: string | null;
};

function startOfTomorrow(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  return d.getTime();
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sameDay = d >= today && d.getTime() < today.getTime() + 86_400_000;
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function RemindersBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders");
      if (!res.ok) return;
      const d = await res.json();
      setItems(Array.isArray(d.reminders) ? d.reminders : []);
    } catch { /* ignore */ }
  }, []);

  // Poll every 60s + on mount.
  useEffect(() => {
    void load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  // Refetch whenever opened (so it's fresh right when the user looks).
  useEffect(() => { if (open) void load(); }, [open, load]);

  // Anchor the panel below the bell, right-aligned to it.
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 6), right: Math.round(window.innerWidth - r.right) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  // Click-outside + Escape.
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

  const act = async (id: string, body: Record<string, unknown>) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    try { await fetch(`/api/reminders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    finally { void load(); }
  };

  const now = Date.now();
  const tomorrow = startOfTomorrow();
  const overdue = items.filter((r) => new Date(r.remindAt).getTime() < now);
  const today = items.filter((r) => { const t = new Date(r.remindAt).getTime(); return t >= now && t < tomorrow; });
  const upcoming = items.filter((r) => new Date(r.remindAt).getTime() >= tomorrow);
  // Badge = things that want attention now/soon (overdue + today).
  const badge = overdue.length + today.length;

  const Group = ({ label, rows }: { label: string; rows: Reminder[] }) =>
    rows.length === 0 ? null : (
      <div className="py-1">
        <div className="px-3 pt-1 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
        <ul>
          {rows.map((r) => {
            const isTask = r.entityType === "BOARD_ITEM" && r.entityId;
            const Icon = isTask ? CheckSquare : Bell;
            const inner = (
              <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50">
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isTask ? "text-blue-500" : "text-amber-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-zinc-800 truncate">{r.title}</div>
                  <div className="text-[11px] text-zinc-400">{fmtTime(r.remindAt)}</div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void act(r.id, { snoozeMinutes: 60 }); }}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
                    title="Snooze 1 hour"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void act(r.id, {}); }}
                    className="p-1 rounded text-zinc-400 hover:text-emerald-600 hover:bg-zinc-100"
                    title="Done"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
            return (
              <li key={r.id}>
                {isTask
                  ? <Link href={`/item/${r.entityId}`} onClick={() => setOpen(false)}>{inner}</Link>
                  : inner}
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-1 rounded-md hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-500 hover:text-zinc-800"
        aria-label="Reminders"
        title="Reminders"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <AlarmClock className="w-[15px] h-[15px]" />
        {badge > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-[#FB5A6F] text-white text-[9px] font-bold leading-[14px] text-center">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              style={{ position: "fixed", top: pos.top, right: pos.right, width: 320 }}
              className="z-[120] rounded-xl bg-white border border-zinc-200 shadow-2xl overflow-hidden"
              role="dialog"
              aria-label="Reminders"
            >
              <div className="flex items-center gap-2 px-3 h-10 border-b border-zinc-100">
                <AlarmClock className="w-4 h-4 text-[#FB5A6F]" />
                <span className="text-[13px] font-semibold text-zinc-900 flex-1">Reminders</span>
                <button
                  type="button"
                  onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "reminder" })); }}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100"
                >
                  <Plus className="w-3.5 h-3.5" /> New
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="px-3 py-8 text-center">
                    <AlarmClock className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
                    <p className="text-[12.5px] text-zinc-500">No reminders</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">Schedule one on a task or add a personal reminder.</p>
                  </div>
                ) : (
                  <>
                    <Group label="Overdue" rows={overdue} />
                    <Group label="Today" rows={today} />
                    <Group label="Upcoming" rows={upcoming} />
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
