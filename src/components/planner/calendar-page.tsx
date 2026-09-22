"use client";

// The Calendar: /planner, the one calendar in the product (spec-planner.md
// section 2 `/planner`; naming canon: the hub is Planner, the page is
// Calendar).
//
// WHAT THIS REPLACES. `PlannerWeek`, a week-only grid with a bespoke 48px
// header, a Sunday-first week that ignored the preference, no month view, no
// team view, no all-day lane, no filter, no display options, blocks that
// mostly did not open, and three dead companions: `PlannerSidePanel` (an
// "Add priority" button with no handler and a "Meet with" that wrote a
// personal task called "Meet with X"), `PlannerCommandBar` (a search box
// that did not search) and `PlannerModal` (the same grid again, in an
// overlay that stayed open across navigation). Each one's capability, and
// where it lives now, is written in the deletion note of its own file.
//
// THE FIVE RULES THIS PAGE KEEPS, all of which were broken before:
//
//   1. ONE FEED. `GET /api/calendar/events` is tasks, meetings, personal
//      events, Google rows and reminders in one range read. Turning a
//      source off in the filter panel means the server stops reading that
//      table, not that the client hides rows it already paid for.
//   2. ONE POLLER. 60 seconds, only while the tab is visible, and the
//      reminder chips ride the same response rather than starting a second
//      reminder tick (critic #12).
//   3. THE SETTINGS ARE READ. Week start, time zone and time format come
//      from `home.locale` through useEffectiveLocale(); every display
//      option persists in `home.planner.*` so it survives a reload.
//   4. A TASK OPENS AS A TASK. A task block pushes `/item/<id>`, which the
//      mounted @drawer slot renders as the drawer over this page, and
//      closing comes back to the calendar at the same period and view.
//      Never `?item=`.
//   5. NOTHING LIES. A viewer with no reports who asks for `calendar=team`
//      gets their own calendar, the parameter stripped and one notice line
//      saying why, rather than their own week under a Team pill.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays, CalendarRange, ChevronLeft, ChevronRight, ListTodo, Users, X,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterPanel, FilterGroup, FilterRow } from "@/components/ui/filter-panel";
import { SplitPrimary } from "@/components/ui/split-primary";
import { MenuItem } from "@/components/ui/menu";
import { Dots } from "@/components/ui/dots";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { openTask } from "@/lib/nav/open-task";
import { useEffectiveLocale } from "@/hooks/use-effective-locale";
import { plannerDisplay, PLANNER_SOURCES, type PlannerSource, type PlannerView } from "@/lib/planner-prefs";
import { useWorkSchedule } from "@/lib/use-work-schedule";
import {
  addDaysToKey, dayOfKey, monthLabel, weekdayOfKey, zonedMonthKeys, zonedWeekKeys, instantAt,
} from "@/lib/calendar-grid";
import { CalendarGrid, eventDayKey, type CalEvent, type CalMove, type CalPerson, type CalSweep } from "./calendar-grid";
import { DayListPopover, EventPopover, ExternalEventPopover, ReminderPopover } from "./event-popover";
import { NewEventModal, type NewEventInitial, hhmm, minutesOfHhmm } from "./new-event-modal";
import { UnscheduledPanel } from "./unscheduled-panel";

/** The dismissal id spec-planner section 0 row 8 names. */
const CONNECT_DISMISSAL = "planner-connect";
const POLL_MS = 60_000;

interface FeedResponse {
  events: CalEvent[];
  people: CalPerson[];
  loggedByPersonDay: Record<string, Record<string, number>>;
  calendar: "my" | "team";
  teamDenied: boolean;
  /** Somebody reports to the viewer. Absent on an older server. */
  hasTeam?: boolean;
  /** The kinds whose server-side cap was reached. Absent on an older server. */
  truncated?: string[];
}

type OpenPopover =
  | { kind: "event"; event: CalEvent; anchor: DOMRect }
  | { kind: "external"; event: CalEvent; anchor: DOMRect }
  | { kind: "reminder"; event: CalEvent; anchor: DOMRect }
  | { kind: "day"; dayKey: string; anchor: DOMRect };

export function CalendarPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { prefs, patchPrefs, openCreateTask } = useOsShell();
  const { toast } = useOsToast();
  const locale = useEffectiveLocale();
  const { schedule } = useWorkSchedule();

  const display = useMemo(() => plannerDisplay(prefs.home.planner), [prefs.home.planner]);
  const dismissed = useMemo(
    () => new Set(Array.isArray(prefs.home.ui?.dismissed) ? prefs.home.ui.dismissed : []),
    [prefs.home.ui],
  );

  /* ── URL is the state: view, date, calendar ── */

  const viewParam = sp.get("view");
  const view: PlannerView =
    viewParam === "month" || viewParam === "people" || viewParam === "week" ? viewParam : display.view;
  const wantTeam = sp.get("calendar") === "team";

  const dateParam = sp.get("date");
  const [anchor, setAnchor] = useState<Date>(() => {
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const d = new Date(`${dateParam}T12:00:00.000Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  });

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k); else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `/planner?${qs}` : "/planner", { scroll: false });
  }, [router, sp]);

  /* ── the period, as day keys in the viewer's zone ── */

  const weekKeys = useMemo(
    () => zonedWeekKeys(anchor, locale.weekStart, locale.timezone),
    [anchor, locale.weekStart, locale.timezone],
  );
  const monthKeys = useMemo(
    () => zonedMonthKeys(anchor, locale.weekStart, locale.timezone),
    [anchor, locale.weekStart, locale.timezone],
  );
  const periodKeys = view === "month" ? monthKeys : weekKeys;

  // "Weekend" has ONE definition on this screen: the days outside the org's
  // working days. An org working Sunday to Thursday tints Friday and
  // Saturday, and the menu still reads "Show weekends" because that is the
  // word people use.
  const isRestDay = useCallback(
    (key: string) => !(schedule.workdays as readonly number[]).includes(weekdayOfKey(key)),
    [schedule.workdays],
  );
  const restDayKeys = useMemo(() => periodKeys.filter(isRestDay), [periodKeys, isRestDay]);
  const visibleKeys = useMemo(
    () => (view === "month" || display.showWeekends ? periodKeys : periodKeys.filter((k) => !isRestDay(k))),
    [view, display.showWeekends, periodKeys, isRestDay],
  );

  const rangeFrom = useMemo(() => instantAt(periodKeys[0], 0, locale.timezone), [periodKeys, locale.timezone]);
  const rangeTo = useMemo(
    () => instantAt(addDaysToKey(periodKeys[periodKeys.length - 1], 1), 0, locale.timezone),
    [periodKeys, locale.timezone],
  );

  /* ── the one feed ── */

  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [teamNotice, setTeamNotice] = useState(false);

  const sources = display.sources;
  const showDeclined = display.showDeclined;
  const fetchKey = `${rangeFrom.toISOString()}|${sources.join(",")}|${showDeclined ? "d" : ""}|${wantTeam ? "team" : "my"}`;
  const loading = loadedKey !== fetchKey;

  const load = useCallback(async () => {
    const key = `${rangeFrom.toISOString()}|${sources.join(",")}|${showDeclined ? "d" : ""}|${wantTeam ? "team" : "my"}`;
    const qs = new URLSearchParams({
      from: rangeFrom.toISOString(),
      to: rangeTo.toISOString(),
      // An empty list is sent AS an empty list: the server reads "show
      // nothing", which is what unticking every source asked for.
      kinds: sources.join(","),
    });
    if (showDeclined) qs.set("declined", "1");
    if (wantTeam) qs.set("calendar", "team");
    const r = await apiFetch<FeedResponse>(`/api/calendar/events?${qs.toString()}`);
    if (r.ok) {
      setFeed(r.data);
      setLoadFailed(false);
      // Rule 5: a view the viewer cannot hold falls back, strips the
      // parameter and says one honest line. Never a LockedPage, because a
      // view is not an object and there is nobody to request it from.
      if (r.data.teamDenied) setTeamNotice(true);
    } else {
      // The last successful range stays on screen, dimmed, with the error
      // row above it (audit P-7). Never setFeed(null) on a failure.
      setLoadFailed(true);
    }
    setLoadedKey(key);
  }, [rangeFrom, rangeTo, sources, showDeclined, wantTeam]);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  // Rule 5 continued: strip the parameter once the server has ruled on it,
  // so the URL and the screen agree.
  useEffect(() => {
    if (teamNotice && wantTeam) setParams({ calendar: null, view: view === "people" ? "week" : null });
  }, [teamNotice, wantTeam, setParams, view]);

  // Rule 2: ONE poller, and it stops while the tab is hidden.
  useEffect(() => {
    const iv = setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const onChanged = () => { void load(); };
    const names = [
      "workwrk:calendar-changed",
      "workwrk:items-changed",
      "workwrk:reminders-changed",
      "workwrk:meetings-changed",
    ];
    for (const n of names) window.addEventListener(n, onChanged);
    return () => { for (const n of names) window.removeEventListener(n, onChanged); };
  }, [load]);

  /* ── popovers, the create modal and the filter panel ── */

  const [popover, setPopover] = useState<OpenPopover | null>(null);
  const [draft, setDraft] = useState<NewEventInitial | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // One clock read per mount, ticked by the minute, so no render calls an
  // impure function and the today pill still moves at midnight.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const todayKey = locale.dayKey(clock);
  // The key handler is bound once and reads these, so it never has to list
  // every callback in its dependency array and re-subscribe on each render.
  // All three are assigned in effects: a ref is not render state.
  const todayKeyRefForKeys = useRef(todayKey);
  const zoneRefForKeys = useRef(locale.timezone);
  const stepPeriodRef = useRef<(dir: -1 | 1) => void>(() => {});
  const setViewRef = useRef<(v: PlannerView) => void>(() => {});
  useEffect(() => { todayKeyRefForKeys.current = todayKey; }, [todayKey]);
  useEffect(() => { zoneRefForKeys.current = locale.timezone; }, [locale.timezone]);

  /* ── `?new=event`, the Planner sidebar "+" > Event deep link ── */
  //
  // A ROUTE AND NOT A WINDOW EVENT, deliberately. The Planner sidebar also
  // renders on /timesheets, /clock, /meetings and /meetings/[id]; a window
  // event has its only listener here, so on four of the five Planner routes
  // that row closed the menu and did nothing. The guard is set INSIDE the
  // timer so StrictMode's double invoke cannot cancel the only scheduled run.
  const newEventFired = useRef(false);
  useEffect(() => {
    if (newEventFired.current || sp.get("new") !== "event") return;
    const t = setTimeout(() => {
      newEventFired.current = true;
      setDraft(defaultDraft(todayKey, todayKey, locale.timezone));
      setParams({ new: null });
    }, 0);
    return () => clearTimeout(t);
  }, [sp, setParams, todayKey, locale.timezone]);

  /* ── the Google connect line ── */

  const [google, setGoogle] = useState<{ available: boolean; connected: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const r = await apiFetch<{ connected?: boolean; available?: boolean }>("/api/integrations/google-calendar");
      if (!alive) return;
      // An older server that does not send `available` reads as available,
      // which is exactly the behaviour before the field and never a
      // regression.
      setGoogle(r.ok ? { available: r.data.available !== false, connected: Boolean(r.data.connected) } : { available: false, connected: false });
    };
    void run();
    return () => { alive = false; };
  }, []);

  const showConnectLine =
    google?.available === true && google.connected === false && !dismissed.has(CONNECT_DISMISSAL);

  const events = feed?.events ?? [];

  const truncatedLabel = useMemo(() => {
    const words: Record<string, string> = {
      task: "tasks", meeting: "meetings", event: "events",
      external: "Google events", reminder: "reminders",
    };
    const list = (feed?.truncated ?? []).map((k) => words[k]).filter(Boolean);
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  }, [feed?.truncated]);

  const openEvent = useCallback((e: CalEvent, rect: DOMRect) => {
    // Rule 4. A task is a task: one URL, opened as the drawer over this page
    // by the mounted @drawer slot, and closing returns here.
    if (e.kind === "task") {
      const id = e.id.replace(/^item:/, "");
      openTask(router, id);
      return;
    }
    if (e.kind === "meeting") { router.push(e.url ?? "/meetings"); return; }
    if (e.kind === "external") { setPopover({ kind: "external", event: e, anchor: rect }); return; }
    if (e.kind === "reminder") { setPopover({ kind: "reminder", event: e, anchor: rect }); return; }
    setPopover({ kind: "event", event: e, anchor: rect });
  }, [router]);

  const onSweep = useCallback((s: CalSweep) => {
    setDraft({ dayKey: s.dayKey, startMin: s.startMin, endMin: s.endMin, allDay: s.allDay });
  }, []);

  /**
   * Where a drag ends: a task, a meeting and an event are three writes.
   *
   * The retry on a failure calls this again, so the live copy is held in a
   * ref: a callback cannot name itself in its own body without being read
   * before it is declared.
   */
  const onMoveRef = useRef<(m: CalMove) => Promise<void>>(async () => {});
  const onMove = useCallback(async (m: CalMove) => {
    const { event, startAt, endAt } = m;
    const rollback = feed;
    // Optimistic, so the block stays where it was dropped while the write
    // lands. A failure puts it back and says so (never a silent snap).
    setFeed((prev) => prev && ({
      ...prev,
      events: prev.events.map((e) =>
        e.id === event.id ? { ...e, start: startAt.toISOString(), end: endAt.toISOString() } : e),
    }));
    let r: Awaited<ReturnType<typeof apiFetch>>;
    if (event.kind === "task") {
      r = await apiFetch(`/api/items/${event.id.replace(/^item:/, "")}`, {
        method: "PATCH",
        json: { startAt: startAt.toISOString(), dueAt: endAt.toISOString() },
        keepalive: true,
      });
    } else if (event.kind === "meeting") {
      r = await apiFetch(`/api/meetings/${event.id.replace(/^meeting:/, "")}`, {
        method: "PUT",
        json: {
          scheduledAt: startAt.toISOString(),
          duration: Math.max(5, Math.round((endAt.getTime() - startAt.getTime()) / 60_000)),
        },
        keepalive: true,
      });
    } else if (event.kind === "reminder") {
      r = await apiFetch(`/api/reminders/${event.id.replace(/^reminder:/, "")}`, {
        method: "PATCH",
        json: { remindAt: startAt.toISOString() },
        keepalive: true,
      });
    } else {
      r = await apiFetch(`/api/calendar/events/${event.id.replace(/^cal:/, "")}`, {
        method: "PATCH",
        json: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
        keepalive: true,
      });
    }
    if (!r.ok) {
      setFeed(rollback);
      toast("Couldn't move it", { tone: "danger", action: { label: "Retry", onClick: () => { void onMoveRef.current(m); } } });
      return;
    }
    void load();
  }, [feed, load, toast]);
  // Assigned in an effect, never during a render: a ref is not render state.
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);

  /* ── display options, every one persisted ── */

  const setDisplay = useCallback((patch: Record<string, unknown>) => {
    void patchPrefs({ home: { planner: patch } });
  }, [patchPrefs]);

  const toggleSource = useCallback((s: PlannerSource, on: boolean) => {
    const next = on ? [...new Set([...sources, s])] : sources.filter((x) => x !== s);
    // Reminders are named twice, once in this panel and once on the Display
    // menu, and they are ONE decision: writing only `sources` here left the
    // menu ticked while the grid showed none, and both keys survive a reload,
    // so the stored state contradicted itself rather than just the screen.
    setDisplay(s === "reminder" ? { sources: next, showReminders: on } : { sources: next });
  }, [sources, setDisplay]);

  const setView = useCallback((v: PlannerView) => {
    setDisplay({ view: v });
    setParams({ view: v });
  }, [setDisplay, setParams]);
  useEffect(() => { setViewRef.current = setView; }, [setView]);

  /* ── the period control ── */

  /**
   * Previous or next period.
   *
   * It steps from the CURRENT anchor rather than from the rendered period
   * keys, so two presses in one frame move two weeks. Reading `weekKeys`
   * out of the closure made the second press a no-op, because both fires
   * saw the same rendered week.
   */
  const stepPeriod = useCallback((dir: -1 | 1) => {
    setAnchor((prev) => {
      if (view === "month") {
        const p = zonedMonthKeys(prev, locale.weekStart, locale.timezone);
        const first = p.find((k) => dayOfKey(k) === 1) ?? p[10];
        const [y, m] = first.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1 + dir, 15, 12));
      }
      const week = zonedWeekKeys(prev, locale.weekStart, locale.timezone);
      return instantAt(addDaysToKey(week[0], dir * 7), 12 * 60, locale.timezone);
    });
  }, [view, locale.weekStart, locale.timezone]);

  useEffect(() => { stepPeriodRef.current = stepPeriod; }, [stepPeriod]);

  const periodLabel = useMemo(() => {
    if (view === "month") return monthLabel(anchor, locale.timezone, locale.dateFormat ? null : null);
    const first = weekKeys[0];
    const last = weekKeys[6];
    const month = (key: string) =>
      new Date(`${key}T12:00:00.000Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
    const sameMonth = first.slice(0, 7) === last.slice(0, 7);
    const year = last.slice(0, 4);
    return sameMonth
      ? `${dayOfKey(first)} to ${dayOfKey(last)} ${month(last)} ${year}`
      : `${dayOfKey(first)} ${month(first)} to ${dayOfKey(last)} ${month(last)} ${year}`;
  }, [view, anchor, weekKeys, locale.timezone, locale.dateFormat]);

  const onToday = periodKeys.includes(todayKey);

  /* ── keyboard ──────────────────────────────────────────────────
   *
   * spec-planner section 2 `/planner` Keyboard, under the section 1
   * suppression rule: a SINGLE LETTER never fires while focus is inside a
   * text input, a textarea, a contenteditable, or while a modal or popover
   * is open. Chords and Escape are the shell's and are untouched here.
   *
   * NOT ADVERTISED. These are page-local, and src/lib/shortcuts.ts is the
   * app-wide canon that the `?` overlay and /account/shortcuts read: putting
   * them there would promise them on every page. spec-planner section 4's
   * cross-unit blocker says exactly this ("not advertised until then"), so
   * they work and stay quiet rather than being listed and being wrong.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (draft || popover || filterOpen) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      switch (e.key) {
        case "ArrowLeft": stepPeriodRef.current(-1); break;
        case "ArrowRight": stepPeriodRef.current(1); break;
        case "t": case "T": setAnchor(new Date()); break;
        case "w": case "W": setViewRef.current("week"); break;
        case "m": case "M": setViewRef.current("month"); break;
        case "p": case "P": if (wantTeam) setViewRef.current("people"); break;
        case "n": case "N": setDraft(defaultDraft(todayKeyRefForKeys.current, todayKeyRefForKeys.current, zoneRefForKeys.current)); break;
        case "f": case "F": setFilterOpen(true); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, popover, filterOpen, wantTeam]);

  /* ── the header ── */

  // THE VIEW PILL IS NOT RENDERED FOR A ROLE THAT CANNOT HOLD THE VIEW
  // (access-model-spec 5.4, and spec-planner section 1 situation 2 step 1:
  // never rendered and then answered). `!teamNotice` was true on every first
  // load, because the notice only arrives after a team fetch has come back
  // denied, so a Member with no reports saw a Team pill, clicked it and was
  // bounced. The Planner sidebar already decides this the right way
  // (apps-catalog CalendarSidebar), and this is the same signal, so the
  // header and the sidebar now agree about whether a team view exists.
  const showTeamTab = (feed?.hasTeam ?? false) && !teamNotice;

  const switcherOptions = [
    { key: "week", label: "Week", icon: CalendarRange },
    { key: "month", label: "Month", icon: CalendarDays },
    ...(wantTeam && !teamNotice ? [{ key: "people", label: "People", icon: Users }] : []),
  ];

  const activeFilters = PLANNER_SOURCES.length - sources.length;

  return (
    <div className="pln">
      <OsPageHeader
        title="Calendar"
        askAi
        views={showTeamTab ? (
          <>
            <ViewTab label="My calendar" active={!wantTeam} onClick={() => setParams({ calendar: null })} />
            <ViewTab label="Team" active={wantTeam} onClick={() => setParams({ calendar: "team" })} />
          </>
        ) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          switcher: { value: view, options: switcherOptions, onChange: (k) => setView(k as PlannerView) },
          left: (
            <span className="pln-period">
              <button type="button" onClick={() => stepPeriod(-1)} aria-label="Previous period">
                <ChevronLeft aria-hidden />
              </button>
              <button type="button" className={cnToday(onToday)} onClick={() => setAnchor(new Date())}>Today</button>
              <button type="button" onClick={() => stepPeriod(1)} aria-label="Next period">
                <ChevronRight aria-hidden />
              </button>
              <span className="pln-period__label">{periodLabel}</span>
              {loading ? <Dots variant="pending" /> : null}
            </span>
          ),
          right: (
            <SplitPrimary
              label="New event"
              menuLabel="Other things to create"
              onClick={() => setDraft(defaultDraft(locale.dayKey(new Date()), todayKey, locale.timezone))}
            >
              <MenuItem label="Event" onClick={() => setDraft(defaultDraft(locale.dayKey(new Date()), todayKey, locale.timezone))} />
              <MenuItem label="Task" onClick={() => openCreateTask()} />
              <MenuItem label="Meeting" href="/meetings?new=1" />
              <MenuItem
                label="Reminder"
                onClick={() => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "reminder" }))}
              />
            </SplitPrimary>
          ),
          menu: [
            {
              label: "Show weekends", checked: display.showWeekends, keepOpen: true,
              onClick: () => setDisplay({ showWeekends: !display.showWeekends }),
            },
            {
              label: "Show declined Google events", checked: display.showDeclined, keepOpen: true,
              onClick: () => setDisplay({ showDeclined: !display.showDeclined }),
            },
            {
              label: "Show reminders", checked: display.showReminders, keepOpen: true,
              onClick: () => {
                const on = !display.showReminders;
                setDisplay({
                  showReminders: on,
                  sources: on ? [...new Set([...sources, "reminder"])] : sources.filter((s) => s !== "reminder"),
                });
              },
            },
            {
              label: "Highlight working hours", checked: display.highlightWorkHours, keepOpen: true,
              onClick: () => setDisplay({ highlightWorkHours: !display.highlightWorkHours }),
            },
            { separator: true },
            {
              label: "Unscheduled tasks", checked: display.showUnscheduled, keepOpen: true,
              onClick: () => setDisplay({ showUnscheduled: !display.showUnscheduled }),
            },
            { separator: true },
            { label: "Calendar & connections", href: "/account/connections" },
          ],
        }}
      />

      <div className="pln-body">
        {/* One quiet line, never a card and never a gate: the calendar below
            renders whether Google is connected or not, and an unconfigured
            deployment shows nothing at all rather than a "Coming soon". */}
        {showConnectLine ? (
          <div className="pln-connect">
            <span>Bring your Google Calendar in.</span>
            <Link href="/account/connections">Connect</Link>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => { void patchPrefs({ home: { ui: { dismissed: [...dismissed, CONNECT_DISMISSAL] } } }); }}
            >
              <X aria-hidden />
            </button>
          </div>
        ) : null}

        {teamNotice ? (
          <p className="pln-notice">Team calendar shows the people who report to you.</p>
        ) : null}

        {/* A clipped week must never read as a free one. The server names the
            kinds whose cap it reached; this is the only honest thing to do
            with that, short of paging a calendar. */}
        {truncatedLabel ? (
          <p className="pln-notice">
            This period has more {truncatedLabel} than the calendar shows at once. Narrow the range or turn off a source to see the rest.
          </p>
        ) : null}

        {loadFailed ? (
          <div className="pln-error">
            <span>Couldn&rsquo;t load your calendar.</span>
            <button type="button" onClick={() => { setLoadFailed(false); void load(); }}>Retry</button>
          </div>
        ) : null}

        <div className="pln-main">
          {filterOpen ? (
            <FilterPanel
              open
              onClose={() => setFilterOpen(false)}
              objects="calendar"
              activeCount={activeFilters}
              onClearAll={() => setDisplay({ sources: [...PLANNER_SOURCES] })}
            >
              <FilterGroup label="Show">
                {SOURCE_ROWS.map((row) => (
                  <FilterRow
                    key={row.value}
                    label={row.label}
                    checked={sources.includes(row.value)}
                    onCheckedChange={(on) => toggleSource(row.value, on)}
                  />
                ))}
              </FilterGroup>
            </FilterPanel>
          ) : null}

          <div className={cnCard(loadFailed)}>
            {loading && !feed ? (
              <CalendarSkeleton />
            ) : view === "month" && events.length === 0 ? (
              <div className="pln-empty">
                <p className="pln-empty__line">Nothing scheduled this month</p>
                <button type="button" className="pln-empty__link" onClick={() => setDraft(defaultDraft(todayKey, todayKey, locale.timezone))}>
                  Add an event
                </button>
              </div>
            ) : (
              <CalendarGrid
                view={view}
                dayKeys={view === "month" ? monthKeys : visibleKeys}
                events={events}
                people={feed?.people ?? []}
                loggedByPersonDay={feed?.loggedByPersonDay ?? {}}
                timezone={locale.timezone}
                timeFormat={locale.timeFormat}
                highlightWorkHours={display.highlightWorkHours}
                anchorMonth={view === "month" ? Number(monthKeys[10].slice(5, 7)) : undefined}
                restDayKeys={restDayKeys}
                readOnly={wantTeam && !teamNotice}
                onOpen={openEvent}
                onMove={onMove}
                onSweep={onSweep}
                onOpenDay={(dayKey, rect) => setPopover({ kind: "day", dayKey, anchor: rect })}
                onOpenPerson={(id) => router.push(`/people/${id}`)}
              />
            )}
          </div>

          {display.showUnscheduled && !wantTeam ? (
            <UnscheduledPanel onOpen={(id) => openTask(router, id)} />
          ) : null}
        </div>
      </div>

      {popover?.kind === "event" ? (
        <EventPopover
          event={popover.event}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onChanged={() => { void load(); }}
          timeFormat={locale.timeFormat}
          toLocalFields={(iso) => {
            const d = new Date(iso);
            return { dayKey: locale.dayKey(d), hhmm: hhmm(minutesOfDayIn(d, locale.timezone)) };
          }}
          toInstant={(dayKey, t) => locale.instantAt(dayKey, minutesOfHhmm(t))}
        />
      ) : null}

      {popover?.kind === "external" ? (
        <ExternalEventPopover
          event={popover.event}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          timeRange={locale.formatRange(popover.event.start, popover.event.end)}
        />
      ) : null}

      {popover?.kind === "reminder" ? (
        <ReminderPopover
          event={popover.event}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onChanged={() => { void load(); }}
          when={locale.formatDate(popover.event.start, "datetime")}
        />
      ) : null}

      {popover?.kind === "day" ? (
        <DayListPopover
          dayKey={popover.dayKey}
          label={locale.formatDate(new Date(`${popover.dayKey}T12:00:00.000Z`), "date")}
          events={events.filter((e) => eventDayKey(e, locale.timezone) === popover.dayKey)}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onOpen={openEvent}
        />
      ) : null}

      {draft ? (
        <NewEventModal
          initial={draft}
          timezone={locale.timezone}
          onClose={() => setDraft(null)}
          onCreated={() => {
            setDraft(null);
            // One event, so every calendar surface mounted right now
            // refetches (src/lib/realtime-events.ts names `calendar.changed`;
            // this is its window twin).
            window.dispatchEvent(new CustomEvent("workwrk:calendar-changed"));
            toast("Event created");
          }}
          toInstant={(dayKey, minutes) => locale.instantAt(dayKey, minutes)}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

const SOURCE_ROWS: ReadonlyArray<{ value: PlannerSource; label: string }> = [
  { value: "task", label: "Tasks" },
  { value: "meeting", label: "Meetings" },
  { value: "event", label: "Events" },
  { value: "external", label: "Google events" },
  { value: "reminder", label: "Reminders" },
];

function cnToday(onToday: boolean) {
  return onToday ? "pln-period__today is-here" : "pln-period__today";
}

function cnCard(dim: boolean) {
  return dim ? "pln-card is-stale" : "pln-card";
}

/**
 * A new event on the next half hour of `dayKey`, IN THE VIEWER'S ZONE.
 *
 * `now.getHours()` is the machine's clock, so a viewer whose home.locale says
 * America/New_York, on a machine set to Asia/Kolkata, was offered 4pm at half
 * past six in the morning: nine and a half hours from their actual now. The
 * write was always zone-correct (locale.instantAt), which is what made the
 * mismatch silent. minutesOfDayIn is the same reader the Event popover uses.
 */
function defaultDraft(dayKey: string, todayKey: string, zone: string | null): NewEventInitial {
  const mins = dayKey === todayKey ? minutesOfDayIn(new Date(), zone) : 9 * 60;
  const start = Math.min(23 * 60, Math.ceil(mins / 30) * 30);
  return { dayKey, startMin: start, endMin: Math.min(24 * 60, start + 30) };
}

/** Minutes past midnight in a zone, without importing the whole grid module. */
function minutesOfDayIn(d: Date, zone: string | null): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(zone ? { timeZone: zone } : {}),
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const h = parts.hour === "24" ? 0 : Number(parts.hour);
  return h * 60 + Number(parts.minute);
}

function CalendarSkeleton() {
  return (
    <div className="pln-skeleton" aria-busy="true" aria-label="Loading the calendar">
      <div className="pln-skeleton__head" />
      <div className="pln-skeleton__grid">
        <span style={{ height: 60 }} />
        <span style={{ height: 96 }} />
        <span style={{ height: 40 }} />
      </div>
      <p className="pln-skeleton__line"><ListTodo aria-hidden /> Reading your week</p>
    </div>
  );
}
