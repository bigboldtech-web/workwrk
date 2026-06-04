"use client";

// /calendar — hierarchical work-visibility calendar.
//
// View options: month (the default). Week/day live in follow-up phases.
// Scope toggle: Mine / Team. Manager-only. Person filter chip-strip
// narrows further. Click an event → navigate to its source.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Loader2,
  Users as UsersIcon, User as UserIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";

type Scope = "mine" | "team" | "all";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  kind: "TASK" | "WEEKLY_REVIEW" | "SOP_ASSIGNMENT";
  ownerId: string | null;
  ownerName: string | null;
  spaceId?: string | null;
  url: string;
}

interface PersonRef {
  id: string;
  name: string;
}

interface ApiResponse {
  events: CalendarEvent[];
  scope: Scope;
  range: { from: string; to: string };
  people: PersonRef[];
}

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899",
  "#14B8A6", "#F97316", "#6366F1", "#06B6D4", "#84CC16", "#A855F7",
];

function colorForId(id: string | null): string {
  if (!id) return "#71717A";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sun-start grid
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function CalendarPage() {
  const router = useRouter();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [scope, setScope] = useState<Scope>("team");
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(anchor), [anchor]);
  const gridStart = useMemo(() => startOfWeek(monthStart), [monthStart]);
  const gridDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    return days;
  }, [gridStart]);

  // Deriving `loading` from a fetchKey vs loadedKey comparison avoids a
  // synchronous setLoading(true) inside useEffect, which React's strict
  // hook rules flag as a cascading render.
  const fetchKey = useMemo(
    () => `${gridStart.toISOString()}_${scope}_${activePersonId ?? ""}`,
    [gridStart, scope, activePersonId],
  );
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      from: gridStart.toISOString(),
      to: addDays(gridStart, 41).toISOString(),
      scope,
    });
    if (activePersonId) params.set("userId", activePersonId);
    fetch(`/api/calendar?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: ApiResponse | null) => {
        if (!active) return;
        if (res) setData(res);
        setLoadedKey(fetchKey);
      })
      .catch(() => {
        if (active) setLoadedKey(fetchKey);
      });
    return () => { active = false; };
  }, [fetchKey, gridStart, scope, activePersonId]);

  const eventsByDayKey = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of data?.events ?? []) {
      const k = e.start.slice(0, 10); // YYYY-MM-DD
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    return map;
  }, [data]);

  const today = new Date();

  return (
    <>
      <OsTitleBar
        title="Calendar"
        Icon={CalendarIcon}
        iconGradient={GRAD.indigoBlue}
        description={data ? `${data.events.length} events in view · ${data.people.length} ${data.people.length === 1 ? "person" : "people"}` : "Loading…"}
        people={[PEOPLE.bb, PEOPLE.sc]}
        morePeople={6}
      />

      <div className="px-6 pt-3 pb-3 border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
              className="h-7 w-7 rounded-md hover:bg-zinc-100 flex items-center justify-center"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-zinc-600" />
            </button>
            <button
              type="button"
              onClick={() => setAnchor(new Date())}
              className="h-7 px-2.5 rounded-md hover:bg-zinc-100 text-[12.5px] text-zinc-700"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
              className="h-7 w-7 rounded-md hover:bg-zinc-100 flex items-center justify-center"
              aria-label="Next month"
            >
              <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
            </button>
          </div>

          <div className="text-[14px] font-semibold text-zinc-900">{monthLabel(anchor)}</div>

          <div className="flex-1" />

          <div className="inline-flex items-center rounded-md border border-zinc-200 overflow-hidden text-[12px]">
            <ScopeTab active={scope === "mine"} onClick={() => setScope("mine")} icon={<UserIcon className="h-3 w-3" />}>
              Mine
            </ScopeTab>
            <ScopeTab active={scope === "team"} onClick={() => setScope("team")} icon={<UsersIcon className="h-3 w-3" />}>
              Team
            </ScopeTab>
          </div>

          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : null}
        </div>

        {data && data.people.length > 1 ? (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActivePersonId(null)}
              className={`text-[11.5px] px-2 py-1 rounded-full border transition ${
                activePersonId === null
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              Everyone ({data.people.length})
            </button>
            {data.people.map((p) => {
              const active = activePersonId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePersonId(active ? null : p.id)}
                  className="text-[11.5px] px-2 py-1 rounded-full border transition inline-flex items-center gap-1.5"
                  style={{
                    backgroundColor: active ? colorForId(p.id) : "white",
                    borderColor: active ? colorForId(p.id) : "rgb(228 228 231)",
                    color: active ? "white" : "rgb(82 82 91)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: active ? "white" : colorForId(p.id) }}
                  />
                  {p.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="p-6">
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-3 py-2 text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 grid-rows-6">
            {gridDays.map((day) => {
              const inMonth = day.getMonth() === anchor.getMonth();
              const isToday = sameDay(day, today);
              const key = day.toISOString().slice(0, 10);
              const events = eventsByDayKey.get(key) ?? [];
              const shown = events.slice(0, 3);
              const overflow = events.length - shown.length;
              return (
                <div
                  key={key}
                  className={`min-h-[110px] border-r border-b border-zinc-100 p-1.5 ${
                    inMonth ? "bg-white" : "bg-zinc-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[11.5px] font-medium ${
                        isToday
                          ? "h-5 w-5 rounded-full bg-zinc-900 text-white inline-flex items-center justify-center"
                          : inMonth
                            ? "text-zinc-700"
                            : "text-zinc-400"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {shown.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => router.push(e.url)}
                        className="w-full text-left rounded px-1.5 py-0.5 text-[11px] truncate transition hover:brightness-95"
                        style={{
                          backgroundColor: `${colorForId(e.ownerId)}1a`,
                          color: colorForId(e.ownerId),
                          borderLeft: `2px solid ${colorForId(e.ownerId)}`,
                        }}
                        title={`${e.title}${e.ownerName ? ` · ${e.ownerName}` : ""}`}
                      >
                        {e.title}
                      </button>
                    ))}
                    {overflow > 0 ? (
                      <div className="text-[10.5px] text-zinc-500 px-1.5">+{overflow} more</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {!loading && data && data.events.length === 0 ? (
          <div className="mt-4 text-[12.5px] text-zinc-500 text-center">
            No scheduled work in this period for {scope === "mine" ? "you" : "your team"}.
          </div>
        ) : null}
      </div>
    </>
  );
}

function ScopeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 inline-flex items-center gap-1.5 transition-colors ${
        active ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
