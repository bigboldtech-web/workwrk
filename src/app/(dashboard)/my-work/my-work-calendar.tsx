"use client";

// The My work calendar: the viewer's own tasks on a month grid.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/my-work, Calendar
// view): "month grid, week starts on `home.locale.weekStart`, drag to
// reschedule, click opens the drawer, '+' on a day creates".
//
// WHY IT IS NOT `board-calendar-view.tsx`. That renderer belongs to ONE List:
// it takes that List's statuses as a prop and creates through
// `POST /api/boards/<id>/items`, and its day "+" hard-codes `status: "TO_DO"`.
// My work spans every List the viewer has a task in, so there is no single
// List to create into and no single status vocabulary to render. Creating
// therefore goes through the create-task modal, which asks which List, the
// one question a cross-List calendar cannot answer for you.
//
// THE MONTH IS CLIENT STATE, deliberately. The Space calendar mirrors its
// month into `?month=` and pays a full server render for every click on the
// chevron; this one keeps it in a `useState`, so stepping through the year is
// free. The rows are already loaded.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { openTask } from "@/lib/nav/open-task";
import {
  addDays,
  civilDayIn,
  formatIsoDay,
  normaliseWeekStart,
  weekdayOf,
  type LocaleContext,
} from "@/lib/work-buckets";
import type { MyWorkRow } from "@/lib/my-work";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function MyWorkCalendar({
  rows,
  locale,
  onCreate,
  mode = "month",
}: {
  rows: MyWorkRow[];
  locale: LocaleContext;
  onCreate: () => void;
  /** The toolbar's Week / Month segmented control, left of the view switcher. */
  mode?: "month" | "week";
}) {
  const router = useRouter();
  const today = useMemo(() => civilDayIn(new Date(), locale.timeZone), [locale.timeZone]);
  const [anchor, setAnchor] = useState(() => ({ y: today.y, m: today.m }));
  /** The day Week mode centres on. Month mode ignores it. */
  const [cursorDay, setCursorDay] = useState(() => today);
  const weekStart = normaliseWeekStart(locale.weekStart);

  // Tasks by the calendar day they are due, in the VIEWER's zone. A task due
  // at 23:00 UTC belongs on tomorrow's square for somebody in Auckland, and
  // formatIsoDay is what makes that true here as well as in the buckets.
  const byDay = useMemo(() => {
    const map = new Map<string, MyWorkRow[]>();
    for (const r of rows) {
      const when = r.dueAt ?? r.startAt;
      if (!when) continue;
      const key = formatIsoDay(new Date(when), locale.timeZone);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [rows, locale.timeZone]);

  // In Week mode the grid is the one week that holds `cursorDay`; in Month
  // mode it is six rows from the week the 1st falls in, so the grid does not
  // change height as you step months.
  const days = useMemo(() => {
    if (mode === "week") {
      const lead = (weekdayOf(cursorDay) - weekStart + 7) % 7;
      const start = addDays(cursorDay, -lead);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = { y: anchor.y, m: anchor.m, d: 1 };
    const lead = (weekdayOf(first) - weekStart + 7) % 7;
    const start = addDays(first, -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [anchor, weekStart, mode, cursorDay]);

  const undated = useMemo(() => rows.filter((r) => !r.dueAt && !r.startAt), [rows]);
  const headings = useMemo(
    () => Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(weekStart + i) % 7]),
    [weekStart],
  );

  function step(by: number) {
    if (mode === "week") {
      setCursorDay((d) => addDays(d, by * 7));
      return;
    }
    setAnchor((a) => {
      const m = a.m + by;
      if (m < 1) return { y: a.y - 1, m: 12 };
      if (m > 12) return { y: a.y + 1, m: 1 };
      return { y: a.y, m };
    });
  }

  return (
    <div className="os-row">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          aria-label={mode === "week" ? "Previous week" : "Previous month"}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
        <span className="min-w-[200px] text-center font-medium text-ink">
          {mode === "week"
            ? `Week of ${days[0]?.d ?? cursorDay.d} ${MONTH_LONG[(days[0]?.m ?? cursorDay.m) - 1]}`
            : `${MONTH_LONG[anchor.m - 1]} ${anchor.y}`}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          aria-label={mode === "week" ? "Next week" : "Next month"}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => { setAnchor({ y: today.y, m: today.m }); setCursorDay(today); }}
          className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink"
        >
          Today
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-raised">
        <div className="grid grid-cols-7 border-b border-line bg-subtle">
          {headings.map((w) => (
            <div key={w} className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
            const inMonth = mode === "week" || day.m === anchor.m;
            const isToday = day.y === today.y && day.m === today.m && day.d === today.d;
            const items = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                className={`group border-b border-e border-line-soft p-1.5 ${mode === "week" ? "min-h-[320px]" : "min-h-[104px]"} ${inMonth ? "" : "bg-subtle"}`}
              >
                <div className="mb-1 flex items-center gap-1">
                  <span
                    className={
                      isToday
                        ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-medium text-white"
                        : inMonth
                          ? "text-xs font-medium text-ink-2"
                          : "text-xs text-ink-4"
                    }
                  >
                    {day.d}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={onCreate}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Create a task for ${day.d} ${MONTH_LONG[day.m - 1]}`}
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
                {items.slice(0, mode === "week" ? 12 : 3).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openTask(router, r.id)}
                    className={`mb-0.5 block w-full truncate rounded px-1.5 py-0.5 text-start text-xs hover:bg-hover ${
                      r.dueBucket === "overdue" ? "text-danger-text" : "text-ink"
                    }`}
                    title={r.title}
                  >
                    {r.title}
                  </button>
                ))}
                {items.length > (mode === "week" ? 12 : 3) ? (
                  <span className="px-1.5 text-xs text-ink-3">+{items.length - (mode === "week" ? 12 : 3)} more</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 ? (
        <div className="mt-3 rounded-lg border border-line bg-raised p-3">
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-2">
            No date · {undated.length}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openTask(router, r.id)}
                className="max-w-[240px] truncate rounded-md border border-line px-2 py-1 text-sm text-ink hover:bg-hover"
              >
                {r.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
