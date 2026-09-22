"use client";

// CalendarGrid: the Calendar's three views (spec-planner.md section 3).
//
// One component, because Week, Month and People are three drawings of ONE
// set of rules, and the rules are the part that kept going wrong:
//
//   * a day column is a calendar day IN THE VIEWER'S ZONE, never
//     `date.getDay()` on the browser's clock;
//   * a week starts on `home.locale.weekStart`, read once, in
//     src/lib/planner-prefs.ts;
//   * a block that overlaps another packs beside it instead of hiding it
//     (audit P-8);
//   * every block opens (audit P-2), and every block that can move, moves
//     with POINTER events so a touch drag works (audit P-10) and has a
//     keyboard and menu alternative.
//
// Nothing here fetches, and nothing here knows a URL. The page hands it
// events and takes back "the person opened this", "the person moved this to
// here" and "the person swept this range"; what those mean is the page's
// business. That is what lets the same grid render the viewer's own week,
// a read-only team week and a month at a glance without a `if (team)` in
// the middle of the drawing code.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Globe, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addDaysToKey,
  clockLabel,
  dayOfKey,
  hourLabel,
  instantAt,
  monthOfKey,
  weekdayOfKey,
  zonedDayKey,
  zonedMinutesOfDay,
} from "@/lib/calendar-grid";
import {
  HOUR_PX, MAX_LANES, SNAP_MIN, capLanes, hoursMinutes, packEvents, yToMinutes,
  type CappedPack,
} from "@/lib/calendar-blocks";

/* ─────────────────────────── the one event shape ─────────────────────────── */

export type CalKind = "task" | "meeting" | "event" | "external" | "reminder";

export interface CalEvent {
  /** Namespaced: "item:x" | "meeting:x" | "cal:x" | "reminder:x". */
  id: string;
  kind: CalKind;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  personId: string | null;
  /** Where clicking goes, when the block navigates rather than opening a popover. */
  url: string | null;
  editable: boolean;
  /** The column an all-day row belongs to, already decided by the server. */
  dayKey?: string;
  /** A teammate's row whose title the server withheld. */
  busyOnly?: boolean;
}

/**
 * Which day column an event belongs to.
 *
 * A TIMED row is an instant, so the column is a calendar question and the
 * answer only exists in the viewer's zone. An ALL-DAY row is already a
 * calendar day, and re-reading it in a zone MOVES it: that is the same rule
 * `TimeEntry.day` follows in the calendar feed, for the same reason. The
 * server sends `dayKey` on the rows it has already decided; everything else
 * falls back to the zoned read, which is what every row did before.
 */
export function eventDayKey(e: CalEvent, timezone: string | null): string {
  if (e.allDay && e.dayKey) return e.dayKey;
  return zonedDayKey(new Date(e.start), timezone);
}

export interface CalPerson {
  id: string;
  name: string;
  avatar: string | null;
}

/** Where a drag ended: the page turns this into the right write. */
export interface CalMove {
  event: CalEvent;
  startAt: Date;
  endAt: Date;
}

export interface CalSweep {
  dayKey: string;
  startMin: number;
  endMin: number;
  allDay?: boolean;
}

const DAY_PX = HOUR_PX * 24;
const WORK_START = 9;
const WORK_END = 18;
/** Long-press before a touch drag starts, so the page can still be scrolled. */
const TOUCH_HOLD_MS = 250;

/* ───────────────────────────── kind vocabulary ───────────────────────────── */

/**
 * The bar colour of a block. Semantic and neutral tokens only: nothing on
 * this grid is hue-keyed off an id, and the chip always carries its title so
 * a colour never travels alone (audit P-12).
 */
export function kindTone(kind: CalKind): string {
  switch (kind) {
    case "meeting": return "var(--os-brand)";
    case "external": return "var(--os-line-strong)";
    case "reminder": return "var(--os-warning-solid)";
    case "event": return "var(--os-ink-3)";
    default: return "var(--os-ink-strong)";
  }
}

export const KIND_LABEL: Readonly<Record<CalKind, string>> = {
  task: "Task",
  meeting: "Meeting",
  event: "Event",
  external: "Google event",
  reminder: "Reminder",
};

const KIND_GLYPH: Partial<Record<CalKind, typeof Video>> = {
  meeting: Video,
  external: Globe,
  reminder: AlarmClock,
};

/* ──────────────────────────────── props ──────────────────────────────── */

export interface CalendarGridProps {
  view: "week" | "month" | "people";
  /** The day keys the grid draws, in order. Week: 7 (or the working days). */
  dayKeys: string[];
  /** Every day of the period, including the ones hidden by Show weekends. */
  allDayKeys?: string[];
  events: CalEvent[];
  people?: CalPerson[];
  loggedByPersonDay?: Record<string, Record<string, number>>;
  timezone: string | null;
  timeFormat: "12h" | "24h" | null;
  highlightWorkHours: boolean;
  /** Month view only: which month the grid is "about", for the out-of-month tint. */
  anchorMonth?: number;
  /**
   * The day keys outside the organization's working days.
   *
   * "Weekend" has ONE definition on this screen and it is not Saturday and
   * Sunday: it is the days outside `WorkSchedule.workdays`, so an
   * organization working Sunday to Thursday tints Friday and Saturday. The
   * page computes the set (it owns the schedule read) and hands it here.
   */
  restDayKeys?: readonly string[];
  /** Tasks with no date, rendered as a drop source by the page's panel. */
  onOpen: (event: CalEvent, anchor: DOMRect) => void;
  /** A block was dragged to a new time (or a new day, in Month). */
  onMove?: (move: CalMove) => void;
  /** An empty range was swept, or an empty cell clicked. */
  onSweep?: (sweep: CalSweep) => void;
  /** Month view: "+N more" on a day. */
  onOpenDay?: (dayKey: string, anchor: DOMRect) => void;
  /** People view: the person's name was clicked. */
  onOpenPerson?: (personId: string) => void;
  /** Nothing can be moved (the Team calendar). */
  readOnly?: boolean;
  className?: string;
}

/* ──────────────────────────────── root ──────────────────────────────── */

export function CalendarGrid(props: CalendarGridProps) {
  if (props.view === "month") return <MonthGrid {...props} />;
  if (props.view === "people") return <PeopleGrid {...props} />;
  return <WeekGrid {...props} />;
}

/* ─────────────────────────────── week ─────────────────────────────── */

interface DragState {
  mode: "move" | "resize" | "sweep";
  event?: CalEvent;
  dayKey: string;
  startMin: number;
  endMin: number;
  /** Where in the block the pointer grabbed it, so it does not jump. */
  grabOffsetMin: number;
}

function WeekGrid({
  dayKeys, events, timezone, timeFormat, highlightWorkHours, restDayKeys,
  onOpen, onMove, onSweep, onOpenDay, readOnly,
}: CalendarGridProps) {
  const rest = useMemo(() => new Set(restDayKeys ?? []), [restDayKeys]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const holdTimer = useRef<number | null>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const todayKey = zonedDayKey(now, timezone);

  // Scroll to the start of the working day once, on mount.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (WORK_START - 1) * HOUR_PX;
  }, []);

  const timed = useMemo(() => {
    const grouped = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (e.allDay) continue;
      const k = zonedDayKey(new Date(e.start), timezone);
      const list = grouped.get(k);
      if (list) list.push(e); else grouped.set(k, [e]);
    }
    // Capped at MAX_LANES columns: past that the day packs into slivers no
    // title survives, so the rest go behind one "+N" chip that opens the day
    // list (spec-planner section 2 Blocks, audit P-8).
    const packedByDay = new Map<string, CappedPack<CalEvent>>();
    for (const [k, list] of grouped) packedByDay.set(k, capLanes(packEvents(list), MAX_LANES));
    return packedByDay;
  }, [events, timezone]);

  const allDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!e.allDay) continue;
      const k = eventDayKey(e, timezone);
      const list = m.get(k);
      if (list) list.push(e); else m.set(k, [e]);
    }
    return m;
  }, [events, timezone]);

  /* ── pointer drag, one handler set for mouse, touch and pen ── */

  const columnAt = useCallback((clientX: number): { key: string; rect: DOMRect } | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const cols = body.querySelectorAll<HTMLElement>("[data-day-key]");
    for (const col of cols) {
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return { key: col.dataset.dayKey ?? "", rect };
      }
    }
    return null;
  }, []);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (!d) return;
    const lo = Math.min(d.startMin, d.endMin);
    let hi = Math.max(d.startMin, d.endMin);
    if (d.mode === "sweep") {
      // A plain click (no travel) is one hour, which is what a person means
      // when they tap 2pm on an empty Tuesday.
      if (hi - lo < SNAP_MIN) hi = Math.min(24 * 60, lo + 60);
      onSweep?.({ dayKey: d.dayKey, startMin: lo, endMin: hi });
      return;
    }
    if (!d.event || !onMove) return;
    if (hi - lo < SNAP_MIN) hi = lo + SNAP_MIN;
    const original = new Date(d.event.start);
    const originalKey = zonedDayKey(original, timezone);
    const originalMin = zonedMinutesOfDay(original, timezone);
    // Nothing actually moved: do not spend a write on it.
    if (d.dayKey === originalKey && lo === originalMin && d.mode === "move") return;
    onMove({ event: d.event, startAt: instantAt(d.dayKey, lo, timezone), endAt: instantAt(d.dayKey, hi, timezone) });
  }, [onMove, onSweep, timezone]);

  useEffect(() => {
    if (!drag) return;
    const onMovePointer = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const col = columnAt(ev.clientX);
      const body = bodyRef.current;
      if (!body) return;
      const ref = col?.rect ?? body.getBoundingClientRect();
      const minutes = yToMinutes(ev.clientY - ref.top + (bodyScrollTop(bodyRef) ?? 0));
      if (d.mode === "resize") {
        dragRef.current = { ...d, endMin: Math.max(d.startMin + SNAP_MIN, minutes) };
      } else if (d.mode === "move") {
        const length = d.endMin - d.startMin;
        const top = Math.max(0, Math.min(24 * 60 - length, minutes - d.grabOffsetMin));
        dragRef.current = { ...d, dayKey: col?.key ?? d.dayKey, startMin: top, endMin: top + length };
      } else {
        dragRef.current = { ...d, endMin: minutes };
      }
      setDrag(dragRef.current);
    };
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onMovePointer);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMovePointer);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, columnAt, endDrag]);

  function beginSweep(key: string, ev: React.PointerEvent<HTMLDivElement>) {
    if (readOnly || !onSweep || ev.button !== 0) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const m = yToMinutes(ev.clientY - rect.top);
    const state: DragState = { mode: "sweep", dayKey: key, startMin: m, endMin: m, grabOffsetMin: 0 };
    const start = () => { dragRef.current = state; setDrag(state); };
    if (ev.pointerType === "touch") {
      holdTimer.current = window.setTimeout(start, TOUCH_HOLD_MS);
    } else {
      start();
    }
  }

  function beginBlockDrag(e: CalEvent, mode: "move" | "resize", ev: React.PointerEvent) {
    if (readOnly || !onMove || !e.editable) return;
    ev.stopPropagation();
    const s = new Date(e.start);
    const en = new Date(e.end);
    const startMin = zonedMinutesOfDay(s, timezone);
    const endMin = Math.max(startMin + SNAP_MIN, zonedMinutesOfDay(en, timezone));
    const grab = yToMinutes(ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top);
    const state: DragState = {
      mode, event: e, dayKey: zonedDayKey(s, timezone), startMin, endMin,
      grabOffsetMin: mode === "move" ? grab : 0,
    };
    const start = () => { dragRef.current = state; setDrag(state); };
    if (ev.pointerType === "touch") holdTimer.current = window.setTimeout(start, TOUCH_HOLD_MS);
    else start();
  }

  return (
    <div className="pln-week">
      {/* Day headers plus the all-day lane (audit P-1: an all-day task or
          event had nowhere to render and simply did not appear). */}
      <div className="pln-week__head">
        <div className="pln-week__gutter" aria-hidden />
        {dayKeys.map((key) => {
          const isToday = key === todayKey;
          const chips = allDay.get(key) ?? [];
          return (
            <div key={key} className="pln-week__daycol">
              <div className="pln-week__dow">{weekdayWord(key)}</div>
              <div className={cn("pln-week__dom", isToday && "is-today")} aria-current={isToday ? "date" : undefined}>
                {dayOfKey(key)}
              </div>
              <div className="pln-week__allday">
                {chips.map((e) => (
                  <BlockChip key={e.id} event={e} onOpen={onOpen} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="pln-week__scroll">
        <div ref={bodyRef} className="pln-week__body" style={{ height: DAY_PX }}>
          <div className="pln-week__gutter pln-week__gutter--hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="pln-week__hour" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : hourLabel(h, timeFormat)}
              </span>
            ))}
          </div>
          {dayKeys.map((key) => {
            const day = timed.get(key);
            const packed = day?.shown ?? [];
            const hidden = day?.hidden ?? [];
            const overflowMin = day?.overflowStart
              ? zonedMinutesOfDay(new Date(day.overflowStart), timezone)
              : null;
            const isToday = key === todayKey;
            const showDrag = drag && drag.dayKey === key;
            const dragLo = showDrag ? Math.min(drag.startMin, drag.endMin) : 0;
            const dragHi = showDrag ? Math.max(drag.startMin, drag.endMin) : 0;
            return (
              <div
                key={key}
                data-day-key={key}
                className={cn("pln-week__col", rest.has(key) && "is-rest")}
                onPointerDown={(ev) => beginSweep(key, ev)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className={cn("pln-week__slot", highlightWorkHours && (h < WORK_START || h >= WORK_END) && "is-off")}
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  />
                ))}

                {showDrag && dragHi > dragLo ? (
                  <div
                    className={cn("pln-week__ghost", drag.mode === "sweep" && "is-sweep")}
                    style={{ top: (dragLo / 60) * HOUR_PX, height: ((dragHi - dragLo) / 60) * HOUR_PX }}
                  >
                    <span>{clockLabel(instantAt(key, dragLo, timezone), timezone, timeFormat)}</span>
                  </div>
                ) : null}

                {isToday ? (
                  <div className="pln-week__now" style={{ top: (zonedMinutesOfDay(now, timezone) / 60) * HOUR_PX }} aria-hidden>
                    <i />
                  </div>
                ) : null}

                {packed.map(({ e, lane, lanes }) => {
                  const dragging = drag?.event?.id === e.id;
                  const s = new Date(e.start);
                  const en = new Date(e.end);
                  const startMin = dragging ? Math.min(drag!.startMin, drag!.endMin) : zonedMinutesOfDay(s, timezone);
                  const endMin = dragging
                    ? Math.max(drag!.startMin, drag!.endMin)
                    : Math.max(startMin + 15, zonedMinutesOfDay(en, timezone));
                  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_PX);
                  const width = 100 / lanes;
                  const movable = !readOnly && Boolean(onMove) && e.editable;
                  return (
                    <Block
                      key={e.id}
                      event={e}
                      now={now}
                      timezone={timezone}
                      timeFormat={timeFormat}
                      style={{
                        top: (startMin / 60) * HOUR_PX,
                        height,
                        insetInlineStart: `calc(${lane * width}% + 3px)`,
                        width: `calc(${width}% - ${lanes > 1 ? 5 : 7}px)`,
                        opacity: dragging ? 0.75 : undefined,
                      }}
                      movable={movable}
                      showTime={height >= 34 && lanes <= 2}
                      onOpen={onOpen}
                      onDragStart={(ev) => beginBlockDrag(e, "move", ev)}
                      onResizeStart={(ev) => beginBlockDrag(e, "resize", ev)}
                    />
                  );
                })}

                {hidden.length && overflowMin !== null ? (
                  <button
                    type="button"
                    className="pln-week__more"
                    style={{ top: (overflowMin / 60) * HOUR_PX }}
                    title={`${hidden.length} more on this day`}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenDay?.(key, ev.currentTarget.getBoundingClientRect());
                    }}
                  >
                    {hidden.length} more
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function bodyScrollTop(ref: React.RefObject<HTMLDivElement | null>): number {
  const body = ref.current;
  const scroller = body?.parentElement;
  return scroller ? scroller.scrollTop : 0;
}

/* ─────────────────────────────── block ─────────────────────────────── */

function Block({
  event, now, timezone, timeFormat, style, movable, showTime, onOpen, onDragStart, onResizeStart,
}: {
  event: CalEvent;
  /** The grid's own minute clock, so nothing reads Date.now() in a render. */
  now: Date;
  timezone: string | null;
  timeFormat: "12h" | "24h" | null;
  style: React.CSSProperties;
  movable: boolean;
  showTime: boolean;
  onOpen: (e: CalEvent, anchor: DOMRect) => void;
  onDragStart: (ev: React.PointerEvent) => void;
  onResizeStart: (ev: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const Glyph = KIND_GLYPH[event.kind];
  const tone = kindTone(event.kind);
  const overdue = event.kind === "task" && new Date(event.end).getTime() < now.getTime() && event.status !== "DONE";
  return (
    <div
      ref={ref}
      className={cn("pln-block", movable && "is-movable")}
      style={{ ...style, "--pln-tone": tone } as React.CSSProperties}
      data-kind={event.kind}
      onPointerDown={(ev) => { if (movable) onDragStart(ev); else ev.stopPropagation(); }}
    >
      <button
        type="button"
        className="pln-block__hit"
        title={`${KIND_LABEL[event.kind]}: ${event.title}`}
        onClick={(ev) => {
          ev.stopPropagation();
          onOpen(event, (ref.current ?? ev.currentTarget).getBoundingClientRect());
        }}
      >
        <span className="pln-block__title">
          {/* A task carries its status colour as a 6px dot, the same way the
              Month chip does, so the two views agree about what a task looks
              like (spec-planner section 2 Blocks). */}
          {event.kind === "task" && event.status ? <i className="pln-block__dot" aria-hidden /> : null}
          {Glyph ? <Glyph aria-hidden /> : null}
          <span>{event.title}</span>
        </span>
        {showTime ? (
          <span className="pln-block__meta">
            {/* A RANGE, not a start: "9:00 to 9:30". A block's second line is
                the one place a person reads how long the thing is. */}
            {clockLabel(new Date(event.start), timezone, timeFormat)}
            {event.allDay ? null : ` to ${clockLabel(new Date(event.end), timezone, timeFormat)}`}
            {overdue ? <em className="pln-block__overdue">Overdue</em> : null}
          </span>
        ) : null}
      </button>
      {movable ? (
        <span
          className="pln-block__grip"
          aria-hidden
          onPointerDown={(ev) => { ev.stopPropagation(); onResizeStart(ev); }}
        />
      ) : null}
    </div>
  );
}

/** The 24px chip used in the all-day lane and in Month cells. */
function BlockChip({ event, onOpen }: { event: CalEvent; onOpen: (e: CalEvent, anchor: DOMRect) => void }) {
  const Glyph = KIND_GLYPH[event.kind];
  return (
    <button
      type="button"
      className="pln-chip"
      style={{ "--pln-tone": kindTone(event.kind) } as React.CSSProperties}
      title={`${KIND_LABEL[event.kind]}: ${event.title}`}
      onPointerDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => { ev.stopPropagation(); onOpen(event, ev.currentTarget.getBoundingClientRect()); }}
    >
      {event.kind === "task" && event.status ? <i className="pln-chip__dot" aria-hidden /> : null}
      {Glyph ? <Glyph aria-hidden /> : null}
      <span>{event.title}</span>
    </button>
  );
}

/* ─────────────────────────────── month ─────────────────────────────── */

const MONTH_CHIPS = 4;

function MonthGrid({
  dayKeys, events, timezone, anchorMonth, onOpen, onSweep, onOpenDay, onMove, readOnly,
}: CalendarGridProps) {
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = eventDayKey(e, timezone);
      const list = m.get(k);
      if (list) list.push(e); else m.set(k, [e]);
    }
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [events, timezone]);

  // One clock read per mount, ticked by the minute, so nothing impure runs
  // in a render pass.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const todayKey = zonedDayKey(now, timezone);
  const [dragging, setDragging] = useState<CalEvent | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const drop = (key: string) => {
    const e = dragging;
    setDragging(null);
    setOverKey(null);
    if (!e || !onMove) return;
    const from = new Date(e.start);
    const to = new Date(e.end);
    const minutes = zonedMinutesOfDay(from, timezone);
    const length = Math.max(15, (to.getTime() - from.getTime()) / 60_000);
    onMove({
      event: e,
      startAt: instantAt(key, minutes, timezone),
      endAt: instantAt(key, Math.min(24 * 60, minutes + length), timezone),
    });
  };

  return (
    <div className="pln-month">
      <div className="pln-month__head">
        {dayKeys.slice(0, 7).map((k) => (
          <div key={k} className="pln-month__dow">{weekdayWord(k)}</div>
        ))}
      </div>
      <div className="pln-month__grid" style={{ gridTemplateRows: `repeat(${dayKeys.length / 7}, minmax(128px, 1fr))` }}>
        {dayKeys.map((key) => {
          const list = byDay.get(key) ?? [];
          const outside = anchorMonth !== undefined && monthOfKey(key) !== anchorMonth;
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={cn("pln-month__cell", outside && "is-outside", overKey === key && "is-over")}
              onClick={() => { if (!readOnly) onSweep?.({ dayKey: key, startMin: 9 * 60, endMin: 10 * 60 }); }}
              onDragOver={(ev) => { if (dragging) { ev.preventDefault(); setOverKey(key); } }}
              onDrop={(ev) => { ev.preventDefault(); drop(key); }}
            >
              <div className="pln-month__num">
                <span className={cn(isToday && "is-today")}>{dayOfKey(key)}</span>
              </div>
              <div className="pln-month__chips">
                {list.slice(0, MONTH_CHIPS).map((e) => (
                  <span
                    key={e.id}
                    draggable={!readOnly && e.editable && Boolean(onMove)}
                    onDragStart={() => setDragging(e)}
                    onDragEnd={() => { setDragging(null); setOverKey(null); }}
                  >
                    <BlockChip event={e} onOpen={onOpen} />
                  </span>
                ))}
                {list.length > MONTH_CHIPS ? (
                  <button
                    type="button"
                    className="pln-month__more"
                    onClick={(ev) => { ev.stopPropagation(); onOpenDay?.(key, ev.currentTarget.getBoundingClientRect()); }}
                  >
                    {list.length - MONTH_CHIPS} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────── people ─────────────────────────────── */

function PeopleGrid({
  dayKeys, events, people = [], loggedByPersonDay = {}, timezone, restDayKeys, onOpen, onOpenPerson,
}: CalendarGridProps) {
  // The same rest days the Week grid tints. Without it a manager's default
  // view of the week disagreed with their own week about which days are worked.
  const rest = useMemo(() => new Set(restDayKeys ?? []), [restDayKeys]);
  const byPersonDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!e.personId) continue;
      const k = `${e.personId}|${eventDayKey(e, timezone)}`;
      const list = m.get(k);
      if (list) list.push(e); else m.set(k, [e]);
    }
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [events, timezone]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const todayKey = zonedDayKey(now, timezone);
  const totalByDay = useMemo(() => {
    const t: Record<string, number> = {};
    for (const perDay of Object.values(loggedByPersonDay)) {
      for (const [k, minutes] of Object.entries(perDay)) t[k] = (t[k] ?? 0) + minutes;
    }
    return t;
  }, [loggedByPersonDay]);

  if (people.length === 0) {
    return <p className="pln-people__empty">Nobody reports to you yet, so there is no team week to show.</p>;
  }

  return (
    <div className="pln-people">
      <table className="pln-people__table">
        <thead>
          <tr>
            <th scope="col" className="pln-people__who">Person</th>
            {dayKeys.map((k) => (
              <th key={k} scope="col" className={cn(k === todayKey && "is-today", rest.has(k) && "is-rest")}>
                <span className="pln-people__dow">{weekdayWord(k)}</span>
                <span className="pln-people__dom">{dayOfKey(k)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <th scope="row" className="pln-people__who">
                <button type="button" onClick={() => onOpenPerson?.(p.id)} className="pln-people__name">
                  <Avatar person={p} />
                  <span>{p.name}</span>
                </button>
              </th>
              {dayKeys.map((k) => {
                const list = byPersonDay.get(`${p.id}|${k}`) ?? [];
                const logged = loggedByPersonDay[p.id]?.[k] ?? 0;
                return (
                  <td key={k} className={cn(k === todayKey && "is-today", rest.has(k) && "is-rest")}>
                    <div className="pln-people__chips">
                      {list.map((e) => <BlockChip key={e.id} event={e} onOpen={onOpen} />)}
                    </div>
                    {logged > 0 ? <span className="pln-people__logged">{hoursMinutes(logged)} logged</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="pln-people__who">Total logged</th>
            {dayKeys.map((k) => (
              <td key={k}>{totalByDay[k] ? hoursMinutes(totalByDay[k]) : ""}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * The 24px person avatar in the People view's first column.
 *
 * A REAL one or none: the picture when the person has one, their own initials
 * when they do not. Nothing generated, nothing stock, so the column never
 * shows a face that is not theirs.
 */
function Avatar({ person }: { person: CalPerson }) {
  if (person.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="pln-people__avatar" src={person.avatar} alt="" width={24} height={24} />;
  }
  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return <i className="pln-people__avatar is-initials" aria-hidden>{initials}</i>;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

export { HOUR_PX, hoursMinutes, packEvents, yToMinutes };

const WEEKDAY_WORDS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday word for a day key. Positional, so it needs no Date and no zone. */
export function weekdayWord(key: string): string {
  return WEEKDAY_WORDS[weekdayOfKey(key)];
}

export { addDaysToKey };
