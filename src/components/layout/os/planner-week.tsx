"use client";

// PlannerWeek — the reusable Planner week view (time-grid + side panel + command
// bar + connect gate). Rendered full-page at /planner and inside the topbar
// PlannerModal popup. Click-and-drag on the grid to sweep a time range; release
// opens the create popover (Event / Task / Focus time / OOO).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft, ChevronRight, Loader2, X, Plus, Video, Users, Link2, MapPin, AlignLeft,
} from "lucide-react";
import { PlannerCommandBar } from "./planner-command-bar";
import { PlannerSidePanel } from "./planner-side-panel";
import { PlannerConnectGate } from "./planner-connect-gate";

interface PlannerEvent {
  id: string; source: "task" | "item"; external: boolean;
  title: string; start: string; end: string; allDay: boolean; status: string | null; url: string | null;
}

const HOUR_PX = 48;
const DAY_PX = HOUR_PX * 24;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WORK_START = 9, WORK_END = 18;
const SNAP_MIN = 15; // grid snap granularity in minutes

function startOfWeek(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function minutesOfDay(d: Date) { return d.getHours() * 60 + d.getMinutes(); }
function fmtHour(h: number) { const am = h < 12; const x = h % 12 === 0 ? 12 : h % 12; return `${x} ${am ? "am" : "pm"}`; }

function eventColor(e: PlannerEvent): string {
  if (e.source === "item") return "#F2A93B";
  if (e.external) return "#2F8BF0";
  return "#16A9A1";
}

// y-offset (px) within a day column -> minutes-of-day, snapped.
function yToMinutes(y: number): number {
  const raw = (y / HOUR_PX) * 60;
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(24 * 60, snapped));
}

interface DragSel { day: Date; startMin: number; endMin: number }

export function PlannerWeek({ embedded }: { embedded?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMeet = searchParams.get("meet") === "1";
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [data, setData] = useState<PlannerEvent[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag-to-create state.
  const [sel, setSel] = useState<DragSel | null>(null);
  const draggingRef = useRef(false);

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
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX; }, [connected]);

  useEffect(() => {
    fetch("/api/integrations/google-calendar")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean } | null) => setConnected(Boolean(d?.connected)))
      .catch(() => setConnected(false));
  }, []);

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

  // ---- drag-to-create handlers (per column) ----
  function colMinutes(day: Date, e: React.MouseEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return yToMinutes(e.clientY - rect.top);
  }
  function onColMouseDown(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const m = colMinutes(day, e);
    draggingRef.current = true;
    setSel({ day, startMin: m, endMin: m + SNAP_MIN });
  }
  function onColMouseMove(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (!draggingRef.current || !sel || !sameDay(sel.day, day)) return;
    const m = colMinutes(day, e);
    setSel({ day, startMin: sel.startMin, endMin: m });
  }
  function finishDrag() {
    if (!draggingRef.current || !sel) { draggingRef.current = false; return; }
    draggingRef.current = false;
    const lo = Math.min(sel.startMin, sel.endMin);
    let hi = Math.max(sel.startMin, sel.endMin);
    if (hi - lo < SNAP_MIN) hi = lo + 60; // a plain click => default 1h
    const start = new Date(sel.day); start.setHours(0, lo, 0, 0);
    const end = new Date(sel.day); end.setHours(0, hi, 0, 0);
    setSel(null);
    setDraft({ start, end });
  }

  const label = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="flex flex-col h-full relative" onMouseUp={finishDrag} onMouseLeave={() => { if (draggingRef.current) finishDrag(); }}>
      <div className="px-6 h-12 flex items-center gap-3 border-b border-zinc-200 dark:border-[#2A2F38] shrink-0">
        <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Planner</div>
        <div className="flex items-center gap-1 ml-2">
          <button type="button" onClick={() => setAnchor(addDays(weekStart, -7))} className="h-7 w-7 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center" aria-label="Previous week"><ChevronLeft className="h-4 w-4 text-zinc-600 dark:text-zinc-300" /></button>
          <button type="button" onClick={() => setAnchor(new Date())} className="h-7 px-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 text-[12.5px] text-zinc-700 dark:text-zinc-200">Today</button>
          <button type="button" onClick={() => setAnchor(addDays(weekStart, 7))} className="h-7 w-7 rounded-md hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center" aria-label="Next week"><ChevronRight className="h-4 w-4 text-zinc-600 dark:text-zinc-300" /></button>
        </div>
        <div className="text-[13.5px] font-medium text-zinc-700 dark:text-zinc-200">{label}</div>
        {connected && loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : null}
      </div>

      {connected === null ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-300" /></div>
      ) : connected === false ? (
        <PlannerConnectGate />
      ) : (
        <>
          <div className="flex flex-1 min-h-0">
            {!embedded ? <PlannerSidePanel onCreated={load} autoFocusMeet={initialMeet} /> : null}

            <div className="flex-1 flex flex-col min-w-0">
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
                    const showSel = sel && sameDay(sel.day, day);
                    const selLo = showSel ? Math.min(sel!.startMin, sel!.endMin) : 0;
                    const selHi = showSel ? Math.max(sel!.startMin, sel!.endMin) : 0;
                    return (
                      <div
                        key={day.toISOString()}
                        className="flex-1 relative border-l border-zinc-100 dark:border-[#23272F] cursor-pointer select-none"
                        onMouseDown={(e) => onColMouseDown(day, e)}
                        onMouseMove={(e) => onColMouseMove(day, e)}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <div key={h} className="absolute left-0 right-0 border-b border-zinc-100 dark:border-[#1F232A]" style={{ top: h * HOUR_PX, height: HOUR_PX, background: h < WORK_START || h >= WORK_END ? "rgba(120,130,150,0.05)" : undefined }} />
                        ))}
                        {showSel && selHi > selLo ? (
                          <div className="absolute left-1 right-1 z-20 rounded-md pointer-events-none" style={{ top: (selLo / 60) * HOUR_PX, height: ((selHi - selLo) / 60) * HOUR_PX, background: "#2F8BF033", border: "1px solid #2F8BF0" }} />
                        ) : null}
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
                              onMouseDown={(ev) => ev.stopPropagation()}
                              onClick={(ev) => { ev.stopPropagation(); openEvent(e); }}
                              className="absolute left-1 right-1 rounded-md px-1.5 py-0.5 text-left overflow-hidden hover:brightness-95 z-10"
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
            </div>
          </div>

          {draft ? <CreateEventPopover draft={draft} onClose={() => setDraft(null)} onCreated={() => { setDraft(null); load(); }} /> : null}
          <PlannerCommandBar onCreated={load} initialMeet={false} />
        </>
      )}
    </div>
  );
}

const CREATE_TABS = ["Event", "Task", "Focus time", "OOO"] as const;
type CreateTab = typeof CREATE_TABS[number];

function timeValue(d: Date) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function dateValue(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function CreateEventPopover({ draft, onClose, onCreated }: { draft: { start: Date; end: Date }; onClose: () => void; onCreated: () => void }) {
  const [tab, setTab] = useState<CreateTab>("Event");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => dateValue(draft.start));
  const [startT, setStartT] = useState(() => timeValue(draft.start));
  const [endT, setEndT] = useState(() => timeValue(draft.end));
  const [saving, setSaving] = useState(false);

  function composeStart() { const [h, m] = startT.split(":").map(Number); const d = new Date(date); d.setHours(h, m, 0, 0); return d; }
  function composeEnd() { const [h, m] = endT.split(":").map(Number); const d = new Date(date); d.setHours(h, m, 0, 0); return d; }
  const durMin = Math.max(0, (composeEnd().getTime() - composeStart().getTime()) / 60000);
  const durLabel = durMin >= 60 ? `${(durMin / 60).toFixed(durMin % 60 ? 1 : 0)}h` : `${durMin}m`;

  const placeholder =
    tab === "Task" ? "Task name" :
    tab === "Focus time" ? "Focus time" :
    tab === "OOO" ? "Out of office" :
    "Add title";
  const accent =
    tab === "Task" ? "#7C5CFF" :
    tab === "Focus time" ? "#16A9A1" :
    tab === "OOO" ? "#F2A93B" :
    "#2F8BF0";

  async function create() {
    const finalTitle = title.trim() || placeholder;
    if (saving) return;
    setSaving(true);
    const start = composeStart(), end = composeEnd();
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: finalTitle,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          allDay,
          date: start.toISOString(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      if (res.ok) onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/20" onClick={onClose}>
      <div className="w-[420px] max-w-[94vw] rounded-2xl bg-white dark:bg-[#181C22] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* tabs */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-2">
          {CREATE_TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-2.5 h-7 rounded-md text-[13px] font-medium ${tab === t ? "bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5"}`}>{t}</button>
          ))}
          <button type="button" onClick={onClose} className="ml-auto w-7 h-7 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-3 pb-3 space-y-2.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} autoFocus placeholder={`${placeholder}, @ for people, @@ for tasks`} className="w-full h-11 px-3 rounded-lg border text-[14px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none" style={{ borderColor: accent }} />

          {/* date + time range */}
          <div className="flex items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-200">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-zinc-200 dark:border-[#2A2F38] bg-transparent px-2 h-8 outline-none" />
            {!allDay ? (
              <>
                <input type="time" value={startT} onChange={(e) => setStartT(e.target.value)} className="rounded-md border border-zinc-200 dark:border-[#2A2F38] bg-transparent px-2 h-8 outline-none" />
                <span className="text-zinc-400">→</span>
                <input type="time" value={endT} onChange={(e) => setEndT(e.target.value)} className="rounded-md border border-zinc-200 dark:border-[#2A2F38] bg-transparent px-2 h-8 outline-none" />
                <span className="text-[12px] text-zinc-400">{durLabel}</span>
              </>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-zinc-600 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[#2F8BF0]" /> All day
          </label>

          {/* affordance rows (mirrors ClickUp; video/participants/links are next) */}
          <div className="pt-1 border-t border-zinc-100 dark:border-[#23272F] space-y-1">
            <Row icon={Video} label="Add video call" muted />
            <Row icon={Users} label="Add participants" muted />
            <Row icon={Link2} label="Add tasks and docs" muted />
            <Row icon={MapPin} label="Add location or room" muted />
            <button type="button" onClick={() => setShowDesc((v) => !v)} className="w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-white/5 text-left text-[13px] text-zinc-500 dark:text-zinc-400">
              <AlignLeft className="w-4 h-4" /> {showDesc ? "Hide description" : "Add description"}
            </button>
            {showDesc ? (
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Add a description…" className="w-full rounded-lg border border-zinc-200 dark:border-[#2A2F38] bg-transparent px-2.5 py-2 text-[13px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 outline-none resize-none" />
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 h-9 rounded-md text-[13px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10">Cancel</button>
            <button type="button" onClick={() => void create()} disabled={saving} className="px-4 h-9 rounded-md text-[13px] font-medium text-white inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: accent }}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, muted }: { icon: typeof Video; label: string; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-1.5 py-1.5 rounded-md text-[13px] ${muted ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-200"}`}>
      <Icon className="w-4 h-4" /> {label}
    </div>
  );
}
