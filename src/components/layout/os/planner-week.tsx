"use client";

// PlannerWeek: the reusable Planner week view (time-grid + side panel + command
// bar + connect banner). Rendered full-page at /planner and inside the bar's
// PlannerModal peek. Click-and-drag on the grid to sweep a time range; release
// opens the create popover (Event / Task / Focus time / OOO).
//
// On the design tokens (design-system section 1): no raw hex, no zinc, no
// `dark:` classes. Event chips tint from three semantic sources (a task on a
// List, an external calendar event, a personal task) and the chip always
// carries its title, so the colour never travels alone. Events that share a
// slot are packed side by side (overlap lanes) instead of painting on top of
// one another.
//
// `embedded` (the peek): the dialog already carries the title, so the week
// header shows only the navigation; the Google banner and the floating
// command bar stay on the full page, where there is room for them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft, ChevronRight, X, Plus, Video, Users, Link2, MapPin, AlignLeft,
} from "lucide-react";
import { PlannerCommandBar } from "./planner-command-bar";
import { PlannerSidePanel } from "./planner-side-panel";
import { PlannerConnectBanner } from "./planner-connect-gate";
import { Dots } from "@/components/ui/dots";
import { cn } from "@/lib/utils";

const BANNER_DISMISS_KEY = "planner:connectBannerDismissed";

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

/** The chip's colour source: a token, never a literal. */
function eventTone(e: PlannerEvent): string {
  if (e.source === "item") return "var(--os-warning-solid)";
  if (e.external) return "var(--os-success-solid)";
  return "var(--os-brand)";
}

// y-offset (px) within a day column -> minutes-of-day, snapped.
function yToMinutes(y: number): number {
  const raw = (y / HOUR_PX) * 60;
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(24 * 60, snapped));
}

/**
 * Overlap packing: events in one day column get a lane and a lane count, so
 * two 2pm meetings render side by side at half width each rather than one
 * on top of the other. Sorted by start; a cluster is a run of events whose
 * spans chain together; every member of the cluster shares its lane count.
 */
function packEvents(events: PlannerEvent[]): Array<{ e: PlannerEvent; lane: number; lanes: number }> {
  const sorted = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const out: Array<{ e: PlannerEvent; lane: number; lanes: number }> = [];
  let cluster: Array<{ e: PlannerEvent; lane: number; end: number }> = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 1);
    for (const c of cluster) out.push({ e: c.e, lane: c.lane, lanes });
    cluster = [];
  };
  for (const e of sorted) {
    const s = new Date(e.start).getTime();
    const en = Math.max(s + 20 * 60_000, new Date(e.end).getTime());
    if (cluster.length && s >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.end);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ e, lane, end: en });
    clusterEnd = Math.max(clusterEnd, en);
  }
  if (cluster.length) flush();
  return out;
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
  // The connect prompt is a dismissible banner, never a gate; remember the
  // dismissal locally so it doesn't nag on every visit (no server round-trip).
  // Read in a lazy initializer (not an effect): safe from hydration mismatch
  // because the banner only renders once `connected === false`, which is never
  // true during SSR/first paint (connected starts null).
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(BANNER_DISMISS_KEY) === "1"; } catch { return false; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try { localStorage.setItem(BANNER_DISMISS_KEY, "1"); } catch { /* ignore */ }
  }, []);

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
  // Grid always mounts now, so scroll to the work-day start once on mount.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX; }, []);

  useEffect(() => {
    if (embedded) return;
    fetch("/api/integrations/google-calendar")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean } | null) => setConnected(Boolean(d?.connected)))
      .catch(() => setConnected(false));
  }, [embedded]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(iv); }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, Array<{ e: PlannerEvent; lane: number; lanes: number }>>();
    const grouped = new Map<string, PlannerEvent[]>();
    for (const e of data ?? []) {
      if (e.allDay) continue;
      const k = new Date(e.start).toDateString();
      (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(e);
    }
    for (const [k, list] of grouped) m.set(k, packEvents(list));
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

  const label = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const navBtn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink";

  return (
    <div className="relative flex h-full flex-col bg-raised text-ink" onMouseUp={finishDrag} onMouseLeave={() => { if (draggingRef.current) finishDrag(); }}>
      <div className={cn("flex shrink-0 items-center gap-3 border-b border-line", embedded ? "h-10 px-4" : "h-12 px-6")}>
        {!embedded ? <h1 className="text-lg font-semibold text-ink">Planner</h1> : null}
        <div className={cn("flex items-center gap-1", embedded ? "" : "ms-2")}>
          <button type="button" onClick={() => setAnchor(addDays(weekStart, -7))} className={navBtn} aria-label="Previous week"><ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} /></button>
          <button type="button" onClick={() => setAnchor(new Date())} className="h-7 rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink">Today</button>
          <button type="button" onClick={() => setAnchor(addDays(weekStart, 7))} className={navBtn} aria-label="Next week"><ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} /></button>
        </div>
        <div className="text-base font-medium text-ink">{label}</div>
        {loading ? <Dots variant="pending" /> : null}
        <span className="flex-1" />
        <Legend />
      </div>

      {/* Not a gate: the grid below renders local tasks + work items for
          everyone. When Google isn't connected we offer it as a dismissible
          banner rather than blocking the whole Planner. */}
      {!embedded && connected === false && !bannerDismissed ? (
        <PlannerConnectBanner onDismiss={dismissBanner} />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {!embedded ? <PlannerSidePanel onCreated={load} autoFocusMeet={initialMeet} /> : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b border-line pe-[14px]">
            <div className="w-14 shrink-0" />
            {days.map((d) => {
              const today = sameDay(d, now);
              return (
                <div key={d.toISOString()} className="flex-1 py-2 text-center">
                  <div className="text-micro uppercase tracking-[0.06em] text-ink-3">{DOW[d.getDay()]}</div>
                  <div
                    className={cn(
                      "mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-base font-semibold tabular-nums",
                      today ? "bg-brand-soft text-brand-deep" : "text-ink",
                    )}
                    aria-current={today ? "date" : undefined}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
            <div className="flex" style={{ height: DAY_PX }}>
              <div className="relative w-14 shrink-0">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute end-2 -translate-y-1/2 text-xs tabular-nums text-ink-3" style={{ top: h * HOUR_PX }}>{h === 0 ? "" : fmtHour(h)}</div>
                ))}
              </div>
              {days.map((day) => {
                const events = byDay.get(day.toDateString()) ?? [];
                const isToday = sameDay(day, now);
                const showSel = sel && sameDay(sel.day, day);
                const selLo = showSel ? Math.min(sel!.startMin, sel!.endMin) : 0;
                const selHi = showSel ? Math.max(sel!.startMin, sel!.endMin) : 0;
                return (
                  <div
                    key={day.toISOString()}
                    className="relative flex-1 cursor-pointer select-none border-s border-line-soft"
                    onMouseDown={(e) => onColMouseDown(day, e)}
                    onMouseMove={(e) => onColMouseMove(day, e)}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className={cn("absolute start-0 end-0 border-b border-line-soft", h < WORK_START || h >= WORK_END ? "bg-subtle" : "")}
                        style={{ top: h * HOUR_PX, height: HOUR_PX }}
                      />
                    ))}
                    {showSel && selHi > selLo ? (
                      <div
                        className="pointer-events-none absolute start-1 end-1 z-20 rounded-md border border-brand bg-brand-soft"
                        style={{ top: (selLo / 60) * HOUR_PX, height: ((selHi - selLo) / 60) * HOUR_PX }}
                      />
                    ) : null}
                    {isToday ? (
                      <div className="pointer-events-none absolute start-0 end-0 z-10" style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }} aria-hidden>
                        <div className="h-px bg-danger-solid" />
                        <div className="absolute -start-1 -top-1 h-2 w-2 rounded-full bg-danger-solid" />
                      </div>
                    ) : null}
                    {events.map(({ e, lane, lanes }) => {
                      const s = new Date(e.start), en = new Date(e.end);
                      const top = (minutesOfDay(s) / 60) * HOUR_PX;
                      const height = Math.max(20, ((en.getTime() - s.getTime()) / 3_600_000) * HOUR_PX);
                      const tone = eventTone(e);
                      const widthPct = 100 / lanes;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onClick={(ev) => { ev.stopPropagation(); openEvent(e); }}
                          className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-start hover:brightness-95"
                          style={{
                            top,
                            height,
                            left: `calc(${lane * widthPct}% + 4px)`,
                            width: `calc(${widthPct}% - ${lanes > 1 ? 6 : 8}px)`,
                            background: `color-mix(in srgb, ${tone} 14%, var(--os-surface))`,
                            borderInlineStart: `3px solid ${tone}`,
                          }}
                          title={e.title}
                        >
                          <div className="truncate text-xs font-medium text-ink">{e.title}</div>
                          {height >= 34 && lanes <= 2 ? (
                            <div className="truncate text-xs text-ink-2">{s.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
                          ) : null}
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
      {!embedded ? <PlannerCommandBar onCreated={load} initialMeet={false} /> : null}
    </div>
  );
}

/** The three chip tints, named, so a colour on the grid is never alone. */
function Legend() {
  const rows: Array<{ label: string; tone: string }> = [
    { label: "Task", tone: "var(--os-brand)" },
    { label: "Work item", tone: "var(--os-warning-solid)" },
    { label: "Calendar", tone: "var(--os-success-solid)" },
  ];
  return (
    <div className="flex items-center gap-3 text-xs text-ink-2 max-md:hidden" aria-label="Legend">
      {rows.map((r) => (
        <span key={r.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.tone }} aria-hidden />
          {r.label}
        </span>
      ))}
    </div>
  );
}

const CREATE_TABS = ["Event", "Task", "Focus time", "OOO"] as const;
type CreateTab = typeof CREATE_TABS[number];

function timeValue(d: Date) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function dateValue(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

const FIELD = "h-8 rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]";

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
  function startOfDay(v: string) { const d = new Date(v); d.setHours(0, 0, 0, 0); return d; }
  function endOfDay(v: string) { const d = new Date(v); d.setHours(23, 59, 0, 0); return d; }
  const durMin = Math.max(0, (composeEnd().getTime() - composeStart().getTime()) / 60000);
  const durLabel = durMin >= 60 ? `${(durMin / 60).toFixed(durMin % 60 ? 1 : 0)}h` : `${durMin}m`;

  const placeholder =
    tab === "Task" ? "Task name" :
    tab === "Focus time" ? "Focus time" :
    tab === "OOO" ? "Out of office" :
    "Add title";

  async function create() {
    const finalTitle = title.trim() || placeholder;
    if (saving) return;
    setSaving(true);
    // "All day" means the whole of the chosen day, local time. The legacy
    // table had an `allDay` column for this and Item does not, so the flag is
    // expressed in the timestamps instead of being dropped: without this the
    // checkbox would still hide the time inputs and then save whatever times
    // happened to be in them, which is a control that does nothing.
    const start = allDay ? startOfDay(date) : composeStart();
    const end = allDay ? endOfDay(date) : composeEnd();
    try {
      // Phase 2 W4: this popover wrote to the legacy `Task` table, so an
      // event created on the week grid was invisible everywhere else in the
      // product. It creates a real task on the viewer's Personal list now.
      const res = await fetch("/api/me/work", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: finalTitle,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      if (res.ok) onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div className="workwrk-os os-chrome fixed inset-0 z-[95] flex items-center justify-center bg-[var(--os-scrim)]" onClick={onClose}>
      <div role="dialog" aria-label="New event" className="w-[420px] max-w-[94vw] rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-modal)]" onClick={(e) => e.stopPropagation()}>
        {/* tabs */}
        <div className="flex items-center gap-1 px-3 pb-2 pt-3" role="tablist" aria-label="What to create">
          {CREATE_TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("h-7 rounded-md px-2.5 text-base transition-colors", tab === t ? "bg-active font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")}
            >
              {t}
            </button>
          ))}
          <button type="button" onClick={onClose} className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink" aria-label="Close"><X className="h-4 w-4" strokeWidth={1.5} /></button>
        </div>

        <div className="space-y-2.5 px-3 pb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            autoFocus
            placeholder={`${placeholder}, @ for people, @@ for tasks`}
            aria-label="Title"
            className="h-10 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />

          {/* date + time range */}
          <div className="flex items-center gap-2 text-base text-ink-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={FIELD} />
            {!allDay ? (
              <>
                <input type="time" value={startT} onChange={(e) => setStartT(e.target.value)} aria-label="Start time" className={FIELD} />
                <span className="text-ink-3">to</span>
                <input type="time" value={endT} onChange={(e) => setEndT(e.target.value)} aria-label="End time" className={FIELD} />
                <span className="text-sm text-ink-3">{durLabel}</span>
              </>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-base text-ink-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[var(--os-brand)]" /> All day
          </label>

          {/* affordance rows (mirrors ClickUp; video/participants/links are next) */}
          <div className="space-y-1 border-t border-line-soft pt-1">
            <Row icon={Video} label="Add video call" muted />
            <Row icon={Users} label="Add participants" muted />
            <Row icon={Link2} label="Add tasks and docs" muted />
            <Row icon={MapPin} label="Add location or room" muted />
            <button type="button" onClick={() => setShowDesc((v) => !v)} className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-start text-base text-ink-2 hover:bg-hover hover:text-ink">
              <AlignLeft className="h-4 w-4" strokeWidth={1.5} /> {showDesc ? "Hide description" : "Add description"}
            </button>
            {showDesc ? (
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Add a description" aria-label="Description" className="w-full resize-none rounded-md border border-line-strong bg-raised px-2.5 py-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]" />
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-base text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void create()} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-40">
              {saving ? <Dots variant="pending" /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />} Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, muted }: { icon: typeof Video; label: string; muted?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-base", muted ? "text-ink-3" : "text-ink-2")}>
      <Icon className="h-4 w-4" strokeWidth={1.5} /> {label}
    </div>
  );
}
