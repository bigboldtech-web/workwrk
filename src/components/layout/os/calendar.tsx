"use client";

/* OsCalendar — Monday-bright month grid, shared across modules.
 *
 *  Takes an array of events with { id, title, date (ISO), color }
 *  plus an optional payload that gets handed to the drawer when an
 *  event is clicked.
 *
 *  Today is highlighted with the brand-soft blue background; the date
 *  number is a brand pill. Events render as colored pills inside each
 *  day cell, max 3 visible; the 4th+ collapses to "+N more" which
 *  pops a list overlay.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useOsShell } from "./shell-context";

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;             // ISO timestamp
  color: string;            // CSS color value (the pill background)
  done?: boolean;
  /** Optional payload — forwarded as `payload` to openItemDrawer */
  payload?: Record<string, unknown>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long" });
}

export function OsCalendar({
  events,
  moduleId,
  newLabel,
}: {
  events: CalendarEvent[];
  moduleId: string;
  /** Used only for the empty-day "+ Add on Mon, Sep 10" hint (optional) */
  newLabel?: string;
}) {
  const { openItemDrawer } = useOsShell();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [popover, setPopover] = useState<{ rect: DOMRect; date: Date; events: CalendarEvent[] } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Pre-bucket events by yyyy-mm-dd for fast cell lookup.
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const d = new Date(e.date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [events]);

  // Build the 42-cell grid: weeks × days starting from the Sunday before
  // (or equal to) the 1st of the visible month.
  const grid = useMemo(() => {
    const first = startOfMonth(cursor);
    const startWeekday = first.getDay(); // 0 = Sun
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startWeekday);

    const weeks: { date: Date; events: CalendarEvent[]; otherMonth: boolean }[][] = [];
    let cur = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const row: typeof weeks[number] = [];
      for (let i = 0; i < 7; i++) {
        const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
        row.push({
          date: new Date(cur),
          events: byDay.get(key) ?? [],
          otherMonth: cur.getMonth() !== first.getMonth(),
        });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(row);
    }
    return weeks;
  }, [cursor, byDay]);

  function goPrev() {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  }
  function goNext() {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  }
  function goToday() {
    setCursor(startOfMonth(new Date()));
  }

  function openEvent(e: CalendarEvent) {
    openItemDrawer({
      moduleId,
      itemId: e.id,
      name: e.title,
      groupColor: e.color,
      payload: e.payload ?? {},
    });
  }

  // Visible-month event count (excludes other-month cells)
  const monthCount = useMemo(() => {
    let n = 0;
    for (const row of grid) for (const cell of row) if (!cell.otherMonth) n += cell.events.length;
    return n;
  }, [grid]);

  const today = new Date();
  const monthName = monthLabel(cursor);
  const year = cursor.getFullYear();

  return (
    <div className="os-cal">
      <div className="os-cal__head">
        <div className="os-cal__nav">
          <button type="button" className="os-cal__nav-btn" onClick={goPrev} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <button type="button" className="os-cal__nav-btn" onClick={goNext} aria-label="Next month">
            <ChevronRight />
          </button>
        </div>
        <button type="button" className="os-cal__today" onClick={goToday}>Today</button>
        <h2 className="os-cal__title">
          <span className="os-cal__title-month">{monthName}</span>
          <span className="os-cal__title-year">{year}</span>
        </h2>
        <span className="os-cal__count">
          <strong>{monthCount}</strong> {monthCount === 1 ? "event" : "events"} this month
        </span>
      </div>

      <div className="os-cal__grid">
        <div className="os-cal__weekdays" role="row">
          {WEEKDAYS.map((d) => (
            <div key={d} className="os-cal__weekday" role="columnheader">{d}</div>
          ))}
        </div>
        <div className="os-cal__weeks">
          {grid.map((row, w) => (
            <div key={w} className="os-cal__week" role="row">
              {row.map((cell, di) => {
                const isToday = sameDay(cell.date, today);
                const visible = cell.events.slice(0, 3);
                const hidden = cell.events.length - visible.length;
                return (
                  <div
                    key={di}
                    className={`os-cal__day ${cell.otherMonth ? "is-other-month" : ""} ${isToday ? "is-today" : ""}`}
                    role="gridcell"
                  >
                    <span className="os-cal__day-num">{cell.date.getDate()}</span>
                    {visible.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className={`os-cal__event ${e.done ? "os-cal__event--done" : ""}`}
                        style={{ background: e.color }}
                        onClick={() => openEvent(e)}
                        title={e.title}
                      >
                        {e.title}
                      </button>
                    ))}
                    {hidden > 0 ? (
                      <button
                        type="button"
                        className="os-cal__more"
                        onClick={(ev) => setPopover({
                          rect: (ev.currentTarget as HTMLElement).getBoundingClientRect(),
                          date: cell.date,
                          events: cell.events,
                        })}
                      >
                        +{hidden} more
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {popover ? (
        <CalDayPopover
          ref={popRef}
          rect={popover.rect}
          date={popover.date}
          events={popover.events}
          onPick={(e) => { openEvent(e); setPopover(null); }}
          onClose={() => setPopover(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Per-day overflow popover ───────────────────────────────
function CalDayPopover({
  rect, date, events, onPick, onClose,
}: {
  rect: DOMRect;
  date: Date;
  events: CalendarEvent[];
  onPick: (e: CalendarEvent) => void;
  onClose: () => void;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  // Anchor below the +N more button; flip horizontally if it overflows
  const top = rect.bottom + 4;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 332));

  return createPortal(
    <>
      <button
        type="button"
        className="os-cal-pop-bd"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="os-cal-pop workwrk-os"
        style={{ top, left }}
        role="dialog"
        aria-label={`Events on ${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`}
      >
        <div className="os-cal-pop__title">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </div>
        <div className="os-cal-pop__list">
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`os-cal__event ${e.done ? "os-cal__event--done" : ""}`}
              style={{ background: e.color }}
              onClick={() => onPick(e)}
            >
              {e.title}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
