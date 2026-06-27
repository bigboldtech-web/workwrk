"use client";

// /calendar — work-visibility calendar.
//
//   My Calendar    — the viewer's own scheduled work + logged time.
//   Team Calendar  — managers only: each direct/indirect report's work, with
//                    a People view showing what they worked on and for how long.
//
// Views: Month · Week · People (team only). Flat colors, no gradients.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, Check, Loader2,
  User as UserIcon, Users as UsersIcon, Clock, CircleDot,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";

type CalKind = "my" | "team";
type ViewMode = "month" | "week" | "people";

interface CalendarEvent {
  id: string; title: string; start: string; end?: string | null;
  kind: "TASK" | "WEEKLY_REVIEW" | "SOP_ASSIGNMENT";
  ownerId: string | null; ownerName: string | null;
  status?: string | null; priority?: string | null; loggedMs?: number;
  spaceId?: string | null; url: string;
}
interface Person { id: string; name: string; avatar?: string | null; role?: string | null }
interface TaskTime { userId: string; entityId: string; title: string; ms: number }
interface DayTime { userId: string; day: string; ms: number }
interface ActiveWork { userId: string; entityId: string; title: string; since: string }
interface ApiResponse {
  calendar: CalKind; canTeam: boolean;
  range: { from: string; to: string };
  events: CalendarEvent[]; people: Person[];
  timeByUserDay: DayTime[]; taskTime: TaskTime[]; activeByUser: ActiveWork[];
}

const PERSON_COLORS = [
  "#0073EA", "#00C875", "#E8920C", "#FF3D57", "#00B2A9", "#FF158A",
  "#579BFC", "#9CD326", "#FDAB3D", "#5B7FFF", "#14787E", "#E2445C",
];
function colorForId(id: string | null): string {
  if (!id) return "#9699A6";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}
const KIND_COLOR: Record<CalendarEvent["kind"], string> = {
  TASK: "#0073EA", WEEKLY_REVIEW: "#E8920C", SOP_ASSIGNMENT: "#00B26A",
};
function eventColor(e: CalendarEvent, cal: CalKind): string {
  return cal === "team" ? colorForId(e.ownerId) : KIND_COLOR[e.kind];
}
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function roleLabel(r?: string | null): string {
  if (!r) return "";
  return r.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}
function fmtMs(ms: number): string {
  if (!ms || ms < 1000) return "0m";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function fmtSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  return fmtMs(ms);
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function monthLabel(d: Date) { return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const router = useRouter();
  const [calendar, setCalendar] = useState<CalKind>("my");
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // The fetch window depends on the view.
  const { from, to } = useMemo(() => {
    if (view === "week") {
      const ws = startOfWeek(anchor);
      return { from: ws, to: addDays(ws, 6) };
    }
    if (view === "people") {
      const ms = startOfMonth(anchor);
      return { from: ms, to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59) };
    }
    const gs = startOfWeek(startOfMonth(anchor));
    return { from: gs, to: addDays(gs, 41) };
  }, [anchor, view]);

  const fetchKey = useMemo(
    () => `${calendar}_${from.toISOString()}_${to.toISOString()}_${activePersonId ?? ""}`,
    [calendar, from, to, activePersonId],
  );
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ calendar, from: from.toISOString(), to: to.toISOString() });
    if (activePersonId) params.set("userId", activePersonId);
    fetch(`/api/calendar?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: ApiResponse | null) => {
        if (!active) return;
        if (res) setData(res);
        setLoadedKey(fetchKey);
      })
      .catch(() => { if (active) setLoadedKey(fetchKey); });
    return () => { active = false; };
  }, [fetchKey, calendar, from, to, activePersonId]);

  // Switching to My calendar can't stay in People view.
  function selectCalendar(next: CalKind) {
    setCalendar(next);
    setActivePersonId(null);
    if (next === "my" && view === "people") setView("month");
  }
  function nav(dir: -1 | 1) {
    if (view === "week") setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  }

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of data?.events ?? []) {
      const k = e.start.slice(0, 10);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return m;
  }, [data]);

  const timeByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.timeByUserDay ?? []) m.set(t.day, (m.get(t.day) ?? 0) + t.ms);
    return m;
  }, [data]);

  const totalLogged = useMemo(
    () => (data?.timeByUserDay ?? []).reduce((s, t) => s + t.ms, 0),
    [data],
  );

  const label = view === "week"
    ? `${from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${to.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : monthLabel(anchor);

  const canTeam = data?.canTeam ?? false;

  return (
    <>
      <OsTitleBar
        title="Calendar"
        Icon={CalendarIcon}
        iconGradient={GRAD.indigoBlue}
        description={data ? `${data.events.length} scheduled · ${fmtMs(totalLogged)} logged` : "Loading…"}
      />

      {/* Toolbar */}
      <div className="px-6 pt-3 pb-3 border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3 flex-wrap">
          {/* My / Team */}
          <Segmented>
            <Seg active={calendar === "my"} onClick={() => selectCalendar("my")} icon={<UserIcon className="h-3 w-3" />}>My Calendar</Seg>
            {canTeam ? (
              <Seg active={calendar === "team"} onClick={() => selectCalendar("team")} icon={<UsersIcon className="h-3 w-3" />}>Team Calendar</Seg>
            ) : null}
          </Segmented>

          <span className="w-px h-5 bg-zinc-200" />

          {/* View switcher */}
          <Segmented>
            <Seg active={view === "month"} onClick={() => setView("month")}>Month</Seg>
            <Seg active={view === "week"} onClick={() => setView("week")}>Week</Seg>
            {calendar === "team" ? (
              <Seg active={view === "people"} onClick={() => setView("people")}>People</Seg>
            ) : null}
          </Segmented>

          {/* Person filter (team grid views) */}
          {calendar === "team" && view !== "people" && data && data.people.length > 1 ? (
            <PersonFilter people={data.people} activeId={activePersonId} onChange={setActivePersonId} />
          ) : null}

          <div className="flex-1" />

          {/* Period nav */}
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => nav(-1)} className="h-7 w-7 rounded-md hover:bg-zinc-100 flex items-center justify-center" aria-label="Previous">
              <ChevronLeft className="h-3.5 w-3.5 text-zinc-600" />
            </button>
            <button type="button" onClick={() => setAnchor(new Date())} className="h-7 px-2.5 rounded-md hover:bg-zinc-100 text-[12.5px] text-zinc-700">Today</button>
            <button type="button" onClick={() => nav(1)} className="h-7 w-7 rounded-md hover:bg-zinc-100 flex items-center justify-center" aria-label="Next">
              <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
            </button>
          </div>
          <div className="text-[14px] font-semibold text-zinc-900 min-w-[150px] text-right">{label}</div>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : null}
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        {calendar === "team" && !canTeam ? (
          <Empty>Team Calendar is available to managers and above.</Empty>
        ) : view === "people" ? (
          <PeopleView data={data} loading={loading} onOpen={(u) => setActivePersonId(u)} />
        ) : view === "week" ? (
          <WeekGrid from={from} calendar={calendar} eventsByDay={eventsByDay} timeByDay={timeByDay} onOpen={(u) => router.push(u)} />
        ) : (
          <MonthGrid anchor={anchor} from={from} calendar={calendar} eventsByDay={eventsByDay} timeByDay={timeByDay} onOpen={(u) => router.push(u)} />
        )}

        {!loading && data && data.events.length === 0 && view !== "people" ? (
          <div className="mt-4 text-[12.5px] text-zinc-500 text-center">
            No scheduled work in this period{calendar === "team" ? " for your team" : ""}.
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ─────────────────────────── Month ─────────────────────────── */
function MonthGrid({ anchor, from, calendar, eventsByDay, timeByDay, onOpen }: {
  anchor: Date; from: Date; calendar: CalKind;
  eventsByDay: Map<string, CalendarEvent[]>; timeByDay: Map<string, number>;
  onOpen: (url: string) => void;
}) {
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(from, i)), [from]);
  const today = new Date();
  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
        {DOW.map((d) => <div key={d} className="px-3 py-2 text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const inMonth = day.getMonth() === anchor.getMonth();
          const isToday = sameDay(day, today);
          const key = day.toISOString().slice(0, 10);
          const events = eventsByDay.get(key) ?? [];
          const shown = events.slice(0, 3);
          const logged = timeByDay.get(key) ?? 0;
          return (
            <div key={key} className={`min-h-[112px] border-r border-b border-zinc-100 p-1.5 ${inMonth ? "bg-white" : "bg-zinc-50/50"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[11.5px] font-medium ${isToday ? "h-5 w-5 rounded-full bg-[#0073EA] text-white inline-flex items-center justify-center" : inMonth ? "text-zinc-700" : "text-zinc-400"}`}>
                  {day.getDate()}
                </span>
                {logged > 0 ? (
                  <span className="text-[9.5px] font-semibold text-[#0073EA] bg-[#0073EA]/8 rounded px-1 inline-flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />{fmtMs(logged)}
                  </span>
                ) : null}
              </div>
              <div className="space-y-0.5">
                {shown.map((e) => <EventChip key={e.id} e={e} calendar={calendar} onOpen={onOpen} />)}
                {events.length > shown.length ? <div className="text-[10.5px] text-zinc-500 px-1.5">+{events.length - shown.length} more</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Week ─────────────────────────── */
function WeekGrid({ from, calendar, eventsByDay, timeByDay, onOpen }: {
  from: Date; calendar: CalKind;
  eventsByDay: Map<string, CalendarEvent[]>; timeByDay: Map<string, number>;
  onOpen: (url: string) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const today = new Date();
  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden grid grid-cols-7">
      {days.map((day, i) => {
        const isToday = sameDay(day, today);
        const key = day.toISOString().slice(0, 10);
        const events = eventsByDay.get(key) ?? [];
        const logged = timeByDay.get(key) ?? 0;
        return (
          <div key={key} className={`min-h-[460px] p-2 ${i < 6 ? "border-r" : ""} border-zinc-100`}>
            <div className="flex items-center justify-between mb-2 px-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] uppercase tracking-wide text-zinc-400 font-semibold">{DOW[day.getDay()]}</span>
                <span className={`text-[12.5px] font-semibold ${isToday ? "h-5 min-w-5 px-1 rounded-full bg-[#0073EA] text-white inline-flex items-center justify-center" : "text-zinc-800"}`}>{day.getDate()}</span>
              </div>
              {logged > 0 ? <span className="text-[9.5px] font-semibold text-[#0073EA]">{fmtMs(logged)}</span> : null}
            </div>
            <div className="space-y-1">
              {events.map((e) => <EventChip key={e.id} e={e} calendar={calendar} onOpen={onOpen} block />)}
              {events.length === 0 ? <div className="text-[11px] text-zinc-300 px-1 pt-1">—</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── People ─────────────────────────── */
function PeopleView({ data, loading, onOpen }: { data: ApiResponse | null; loading: boolean; onOpen: (userId: string) => void }) {
  if (loading && !data) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-zinc-300" /></div>;
  if (!data || data.people.length === 0) return <Empty>You have no direct reports yet. People who report to you will appear here.</Empty>;

  const totalByUser = new Map<string, number>();
  for (const t of data.timeByUserDay) totalByUser.set(t.userId, (totalByUser.get(t.userId) ?? 0) + t.ms);
  const tasksByUser = new Map<string, TaskTime[]>();
  for (const t of data.taskTime) (tasksByUser.get(t.userId) ?? tasksByUser.set(t.userId, []).get(t.userId)!).push(t);
  const activeByUser = new Map(data.activeByUser.map((a) => [a.userId, a]));
  const scheduledByUser = new Map<string, number>();
  for (const e of data.events) if (e.ownerId) scheduledByUser.set(e.ownerId, (scheduledByUser.get(e.ownerId) ?? 0) + 1);

  // Most time logged first.
  const people = [...data.people].sort((a, b) => (totalByUser.get(b.id) ?? 0) - (totalByUser.get(a.id) ?? 0));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {people.map((p) => {
        const total = totalByUser.get(p.id) ?? 0;
        const tasks = (tasksByUser.get(p.id) ?? []).slice(0, 6);
        const maxMs = Math.max(1, ...tasks.map((t) => t.ms));
        const active = activeByUser.get(p.id);
        const color = colorForId(p.id);
        return (
          <div key={p.id} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <Avatar person={p} color={color} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-zinc-900 truncate">{p.name}</div>
                <div className="text-[12px] text-zinc-500 truncate">{roleLabel(p.role) || "Team member"}</div>
              </div>
              <div className="text-right">
                <div className="text-[15px] font-bold text-zinc-900 tabular-nums">{fmtMs(total)}</div>
                <div className="text-[10.5px] text-zinc-400 uppercase tracking-wide">logged</div>
              </div>
            </div>

            {active ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
                <span className="text-[12px] text-emerald-700 truncate flex-1">Working on <strong className="font-semibold">{active.title}</strong></span>
                <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">{fmtSince(active.since)}</span>
              </div>
            ) : null}

            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold">What they worked on</span>
                <span className="text-[11px] text-zinc-400">{scheduledByUser.get(p.id) ?? 0} scheduled</span>
              </div>
              {tasks.length === 0 ? (
                <div className="text-[12px] text-zinc-400 py-2">No time tracked this period.</div>
              ) : (
                <ul className="space-y-1.5">
                  {tasks.map((t) => (
                    <li key={t.entityId}>
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[12.5px] text-zinc-700 truncate flex items-center gap-1.5">
                          <CircleDot className="h-3 w-3 shrink-0" style={{ color }} />{t.title}
                        </span>
                        <span className="text-[12px] font-semibold text-zinc-600 tabular-nums shrink-0">{fmtMs(t.ms)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(t.ms / maxMs) * 100}%`, background: color }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button type="button" onClick={() => onOpen(p.id)} className="mt-3 text-[12px] font-medium text-[#0073EA] hover:underline">
              View {p.name.split(" ")[0]}&apos;s calendar →
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Bits ─────────────────────────── */
function EventChip({ e, calendar, onOpen, block }: { e: CalendarEvent; calendar: CalKind; onOpen: (url: string) => void; block?: boolean }) {
  const color = eventColor(e, calendar);
  return (
    <button
      type="button"
      onClick={() => onOpen(e.url)}
      className={`w-full text-left rounded px-1.5 ${block ? "py-1" : "py-0.5"} text-[11px] transition hover:brightness-95`}
      style={{ backgroundColor: `${color}1a`, color, borderLeft: `2px solid ${color}` }}
      title={`${e.title}${e.ownerName ? ` · ${e.ownerName}` : ""}${e.loggedMs ? ` · ${fmtMs(e.loggedMs)} logged` : ""}`}
    >
      <span className="block truncate font-medium">{e.title}</span>
      {block ? (
        <span className="flex items-center gap-1.5 mt-0.5 text-[10px] opacity-80">
          {calendar === "team" && e.ownerName ? <span className="truncate">{e.ownerName}</span> : null}
          {e.loggedMs ? <span className="inline-flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{fmtMs(e.loggedMs)}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

function Avatar({ person, color }: { person: Person; color: string }) {
  if (person.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={person.avatar} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />;
  }
  return (
    <span className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-[13px] font-semibold" style={{ background: color }}>
      {initials(person.name)}
    </span>
  );
}

function Segmented({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex items-center rounded-md border border-zinc-200 overflow-hidden text-[12px]">{children}</div>;
}
function Seg({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1 inline-flex items-center gap-1.5 transition-colors ${active ? "bg-[#0073EA] text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"}`}>
      {icon}{children}
    </button>
  );
}
function PersonFilter({ people, activeId, onChange }: { people: Person[]; activeId: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = people.find((p) => p.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(id: string | null) { onChange(id); setOpen(false); }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 pl-2 pr-1.5 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white text-[12px] text-zinc-700 hover:bg-zinc-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {active ? (
          <>
            <span className="h-2 w-2 rounded-full" style={{ background: colorForId(active.id) }} />
            <span className="max-w-[130px] truncate font-medium">{active.name}</span>
          </>
        ) : (
          <>
            <UsersIcon className="h-3 w-3 text-zinc-500" />
            <span className="font-medium">Everyone ({people.length})</span>
          </>
        )}
        <ChevronDown className="h-3 w-3 text-zinc-400" />
      </button>

      {open ? (
        <div className="absolute left-0 top-[34px] z-50 w-[230px] max-h-[320px] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl py-1" role="listbox">
          <FilterRow selected={activeId === null} onClick={() => pick(null)}>
            <UsersIcon className="h-3.5 w-3.5 text-zinc-500" />
            <span className="flex-1">Everyone</span>
            <span className="text-[11px] text-zinc-400">{people.length}</span>
          </FilterRow>
          <div className="my-1 border-t border-zinc-100" />
          {people.map((p) => (
            <FilterRow key={p.id} selected={activeId === p.id} onClick={() => pick(p.id)}>
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorForId(p.id) }} />
              <span className="flex-1 truncate">{p.name}</span>
            </FilterRow>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function FilterRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-[12.5px] text-left hover:bg-zinc-50 ${selected ? "text-zinc-900 font-medium" : "text-zinc-700"}`}
      role="option"
      aria-selected={selected}
    >
      {children}
      {selected ? <Check className="h-3.5 w-3.5 text-[#0073EA] shrink-0" /> : <span className="w-3.5 shrink-0" />}
    </button>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-white py-16 text-center text-[13px] text-zinc-500">
      {children}
    </div>
  );
}
