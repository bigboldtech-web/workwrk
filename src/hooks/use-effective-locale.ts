"use client";

// useEffectiveLocale: the viewer's date rules, in one place, for every
// surface that draws a day or a time (spec-planner.md section 3, the
// `useEffectiveLocale()` row; critic-gaps #13).
//
// WHAT IT IS FOR, AND WHY IT IS NOT `useFormat()` ALONE. There were already
// two good pieces and one hole between them:
//
//   src/lib/format/date.ts       formats an instant: "21 Sep", "9:30 AM"
//   src/lib/format/use-date-prefs.ts  binds that to home.locale for React
//
// and `DateFormatPrefs` deliberately carries timezone, dateFormat,
// timeFormat and language and NOT week start, because a week start is not a
// formatting rule. So every surface that needed BOTH a formatted date and
// the start of the week (the Calendar, the timesheet week label, the board
// calendar view, the date planner) reached for the formatter and then
// invented its own week start beside it. Three spellings of that rule were
// live at once when Phase 4 began. This hook is the one door: it wraps
// `useFormat()` for the formatting half and `planner-prefs.ts` for the week
// half, and adds nothing of its own.
//
// It reads the EFFECTIVE preference (org default under the personal
// override), because that is what `useOsShell().prefs` already holds:
// /api/boot resolves it server-side through `getEffectivePreferences`.

import { useMemo } from "react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useFormat } from "@/lib/format/use-date-prefs";
import type { DateStyle } from "@/lib/format/date";
import { resolvePlannerWeekStart } from "@/lib/planner-prefs";
import {
  addDaysToKey,
  clockLabel,
  instantAt,
  zonedDayKey,
  zonedWeekKeys,
} from "@/lib/calendar-grid";

export interface EffectiveLocale {
  /** IANA name, or null to mean "whatever the browser is set to". */
  timezone: string | null;
  /** 0 = Sunday .. 6 = Saturday. Monday unless the viewer says otherwise. */
  weekStart: number;
  dateFormat: string | null;
  timeFormat: "12h" | "24h" | null;
  /** `formatDate` from src/lib/format/date.ts, bound to the preferences. */
  formatDate: (v: Date | string | number | null | undefined, style?: DateStyle) => string;
  /** "09:30" or "9:30 AM", in the viewer's zone. */
  formatTime: (v: Date | string | number | null | undefined) => string;
  /** "9:00 to 9:30", the second line of a calendar block. */
  formatRange: (from: Date | string | number, to: Date | string | number) => string;
  /** "YYYY-MM-DD" for an instant, read in the viewer's zone. */
  dayKey: (v: Date | string | number) => string;
  /** The seven day keys of the week containing `anchor`. */
  weekKeys: (anchor: Date) => string[];
  /** The instant at N minutes past midnight on a day key, in the zone. */
  instantAt: (key: string, minutes: number) => Date;
  /** "Week of 21 Sep" - the one week label of the naming canon. */
  weekLabel: (anchor: Date) => string;
}

function asDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}

export function useEffectiveLocale(): EffectiveLocale {
  const { prefs } = useOsShell();
  const fmt = useFormat();
  const locale = prefs.home.locale;
  const timezone = locale?.timezone ?? null;
  const timeFormat = (locale?.timeFormat ?? null) as "12h" | "24h" | null;
  const weekStart = resolvePlannerWeekStart(locale?.weekStart);
  const dateFormat = locale?.dateFormat ?? null;

  return useMemo<EffectiveLocale>(() => {
    const formatTime = (v: Date | string | number | null | undefined) =>
      v === null || v === undefined ? "" : clockLabel(asDate(v), timezone, timeFormat);
    return {
      timezone,
      weekStart,
      dateFormat,
      timeFormat,
      formatDate: fmt.date,
      formatTime,
      formatRange: (from, to) => `${formatTime(from)} to ${formatTime(to)}`,
      dayKey: (v) => zonedDayKey(asDate(v), timezone),
      weekKeys: (anchor) => zonedWeekKeys(anchor, weekStart, timezone),
      instantAt: (key, minutes) => instantAt(key, minutes, timezone),
      weekLabel: (anchor) => {
        const first = zonedWeekKeys(anchor, weekStart, timezone)[0];
        // Noon UTC and `timeZone: "UTC"` so the label names the day the key
        // names, never the day before it in a negative offset.
        return `Week of ${fmt.date(new Date(`${first}T12:00:00.000Z`), "date")}`;
      },
      // `addDaysToKey` is re-exported through the module rather than the
      // hook: it takes no preference, so binding it here would only hide
      // where it comes from.
    };
  }, [timezone, weekStart, dateFormat, timeFormat, fmt]);
}

export { addDaysToKey };
