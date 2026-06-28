"use client";

// /planner — the time-grid Planner (week view). Hours down the side, 7 day
// columns, a now-line, working-hours dimming. Shows scheduled work (Items) and
// personal events + Google-synced meetings (Tasks) from /api/planner/events.
// Click an empty slot to create an event (posts a Task, which the existing
// Google push mirrors out). Phase 1 of the Planner.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, X, Plus } from "lucide-react";
import { PlannerCommandBar } from "@/components/layout/os/planner-command-bar";

interface PlannerEvent {
  id: string; source: "task" | "item"; external: boolean;
  title: string; start: string; end: string; allDay: boolean; status: string | null; url: string | null;
}

const HOUR_PX = 48;
const DAY_PX = HOUR_PX * 24;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WORK_START = 9, WORK_END = 18;

function startOfWeek(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function minutesOfDay(d: Date) { return d.getHours() * 60 + d.getMinutes(); }
function fmtHour(h: number) { const am = h < 12; const x = h % 12 === 0 ? 12 : h % 12; return `${x} ${am ? "am" : "pm"}`; }

function eventColor(e: PlannerEvent): string {
  if (e.source === "item") return "#F2A93B";       // work item, amber
  if (e.external) return "#2F8BF0";                 // Google meeting, blue
  return "#16A9A1";                                 // personal event, teal
}

export default function PlannerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMeet = searchParams.get("meet") === "1";
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [data, setData] = useState<PlannerEvent[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ day: Date; hour: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const fetchKey = weekStart.toISOString();
  const loading = loadedKey !== fetchKey;

  const load = useCallback(() => {
    const key = weekStart.toISOString();
    fetch(`/api/planner/events?from=${key}&to=${addDays(weekStart, 7).toISOString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events: PlannerEvent[] } | null) => { if (d) setData(d.events); setLoadedKey(key); })
      .catch(() => setLoadedKey(key));
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX; }, []);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(iv); }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, PlannerEvent[]>();
    for (const e of data ?? []) {
      const k = new Date(e.start).toDateString();
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return m;
  }, [data]);

  function openEvent(e: PlannerEvent) { if (e.url) router.push(e.url); }

  function onColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = Math.max(0, Math.min(23, Math.floor(y / HOUR_PX)));
    setDraft({ day, hour });
  }

  const label = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="flex flex-col h-full relative">
      <div className="px-6 h-12 flex items-center gap-3 border-b border-zinc-200 dark:border-[#2A2F38] shrink-0">
        <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Planner</div>
        <div className="flex items-center gap-1 ml-2">
          <button type="button" onClick={() => setAnchor(addDays(weekStart, -7))} className="h-7 w-7 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center" aria-label="Previous week"><ChevronLeft className="h-4 w-4 text-zinc-600 dark:text-zinc-300" /></button>
          <button type="button" onClick={() => setAnchor(new Date())} className="h-7 px-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 text-[12.5px] text-zinc-700 dark:text-zinc-200">Today</button>
          <button type="button" onClick={() => setAnchor(addDays(weekStart, 7))} className="h-7 w-7 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center" aria-label="Next week"><ChevronRight className="h-4 w-4 text-zinc-600 dark:text-zinc-300" /></button>
        </div>
        <div className="text-[13.5px] font-medium text-zinc-700 dark:text-zinc-200">{label}</div>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : null}
      </div>

      <div className="flex shrink-0 border-b border-zinc-200 dark:border-[#2A2F38] pr-[14px]">
        <div className="w-14 shrink-0" />
        {days.map((d) => {
          const today = sameDay(d, now);
          return (
            <div key={d.toISOString()} className="flex-1 py-2 text-center">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{DOW[d.getDay()]}</div>
              <div className={`text-[15px] font-semibold mt-0.5 inline-flex items-center justify-center ${today ? "h-7 w-7 rounded-full bg-[#2F8BF0] text-white" : "text-zinc-800 dark:text-zinc-100"}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        <div className="flex" style={{ height: DAY_PX }}>
          <div className="w-14 shrink-0 relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] text-zinc-400 dark:text-zinc-500" style={{ top: h * HOUR_PX }}>{h === 0 ? "" : fmtHour(h)}</div>
            ))}
          </div>
          {days.map((day) => {
            const events = (byDay.get(day.toDateString()) ?? []).filter((e) => !e.allDay);
            const isToday = sameDay(day, now);
            return (
              <div key={day.toISOString()} className="flex-1 relative border-l border-zinc-100 dark:border-[#23272F] cursor-pointer" onClick={(e) => onColumnClick(day, e)}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-b border-zinc-100 dark:border-[#1F232A]" style={{ top: h * HOUR_PX, height: HOUR_PX, background: h < WORK_START || h >= WORK_END ? "rgba(120,130,150,0.05)" : undefined }} />
                ))}
                {isToday ? (
                  <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }}>
                    <div className="h-px bg-[#FB5A6F]" />
                    <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[#FB5A6F]" />
                  </div>
                ) : null}
                {events.map((e) => {
                  const s = new Date(e.start), en = new Date(e.end);
                  const top = (minutesOfDay(s) / 60) * HOUR_PX;
                  const height = Math.max(20, ((en.getTime() - s.getTime()) / 3_600_000) * HOUR_PX);
                  const color = eventColor(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); openEvent(e); }}
                      className="absolute left-1 right-1 rounded-md px-1.5 py-0.5 text-left overflow-hidden hover:brightness-95"
                      style={{ top, height, background: `${color}22`, borderLeft: `3px solid ${color}` }}
                      title={e.title}
                    >
                      <div className="text-[11px] font-medium truncate" style={{ color }}>{e.title}</div>
                      <div className="text-[10px] truncate" style={{ color: `${color}cc` }}>{s.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {draft ? <CreateEventPopover draft={draft} onClose={() => setDraft(null)} onCreated={() => { setDraft(null); load(); }} /> : null}
      <PlannerCommandBar onCreated={load} initialMeet={initialMeet} />
    </div>
  );
}

function CreateEventPopover({ draft, onClose, onCreated }: { draft: { day: Date; hour: number }; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const start = new Date(draft.day); start.setHours(draft.hour, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  async function create() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), startAt: start.toISOString(), endAt: end.toISOString(), allDay: false, date: start.toISOString() }),
      });
      if (res.ok) onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[20vh] bg-black/20" onClick={onClose}>
      <div className="w-[360px] max-w-[92vw] rounded-xl bg-white dark:bg-[#181C22] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">New event</div>
          <button type="button" onClick={onClose} className="w-6 h-6 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500" aria-label="Close"><X className="w-3.5 h-3.5" /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} autoFocus placeholder="Event title" className="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#14171D] text-[14px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400" />
        <div className="mt-2 text-[12px] text-zinc-500 dark:text-zinc-400">
          {start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} for 1h
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 h-8 rounded-md text-[13px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => void create()} disabled={!title.trim() || saving} className="px-3.5 h-8 rounded-md text-[13px] font-medium text-white bg-[#2F8BF0] hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
