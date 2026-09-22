"use client";

// The client half of src/lib/format/date.ts: the viewer's locale preferences
// from the shell's effective preferences, and a bound `formatDate` so a list
// row writes `fmt(row.updatedAt)` and never reads `home.locale` itself.

import { useCallback, useMemo } from "react";
import { useOsShell } from "@/components/layout/os/shell-context";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTitle,
  formatRelative,
  formatWallClockDate,
  formatWallClockHhmm,
  formatWallClockTime,
  wallClockToday,
  type DateFormatPrefs,
  type DateStyle,
} from "./date";

export function useDatePrefs(): DateFormatPrefs {
  const { prefs } = useOsShell();
  const locale = prefs.home.locale;
  return useMemo<DateFormatPrefs>(
    () => ({
      timezone: locale?.timezone ?? null,
      dateFormat: locale?.dateFormat ?? null,
      timeFormat: locale?.timeFormat ?? null,
      language: locale?.language ?? null,
    }),
    [locale?.timezone, locale?.dateFormat, locale?.timeFormat, locale?.language],
  );
}

export function useFormat() {
  const prefs = useDatePrefs();
  const date = useCallback((v: Date | string | number | null | undefined, style: DateStyle = "smart") => formatDate(v, prefs, style), [prefs]);
  const title = useCallback((v: Date | string | number | null | undefined) => formatDateTitle(v, prefs), [prefs]);
  const relative = useCallback((v: Date | string | number | null | undefined) => formatRelative(v, prefs), [prefs]);
  const bytes = useCallback((n: number | null | undefined) => formatBytes(n, prefs), [prefs]);
  const count = useCallback((n: number | null | undefined) => formatCount(n, prefs), [prefs]);
  // The two wall-clock renderers: a picker's option is a set of digits and a
  // calendar day, never an instant, so nothing here re-reads it in a zone.
  const wallTime = useCallback((h: number, m: number) => formatWallClockTime(h, m, prefs), [prefs]);
  const wallHhmm = useCallback((v: string | null | undefined) => formatWallClockHhmm(v, prefs), [prefs]);
  const wallDate = useCallback((key: string | null | undefined) => formatWallClockDate(key, prefs), [prefs]);
  const today = useCallback(() => wallClockToday(prefs), [prefs]);
  return useMemo(
    () => ({ date, title, relative, bytes, count, wallTime, wallHhmm, wallDate, today, prefs }),
    [date, title, relative, bytes, count, wallTime, wallHhmm, wallDate, today, prefs],
  );
}
