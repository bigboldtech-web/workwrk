// The week pills on /me/weekly-review.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/me/weekly-review):
// "Views row (text-tab pills, the URL `?week=YYYY-MM-DD` is the source): This
// week, Last week, then the previous 6 weeks as '8 Sep', '1 Sep'… overflowing
// into '•••'".
//
// The page had NO history at all: it auto-created the current week's draft and
// that was the only week you could reach, so a review you wrote last Friday was
// unreachable by Monday (work-tasks 1.15, misc-apps 1.25).
//
// Pure: dates in, labels out. No prisma, no React, no Intl assumptions beyond
// the caller's own locale for the short date.

/** A week, keyed by the ISO date of its start. */
export interface WeekOption {
  /** "2026-09-14": the `?week=` value and the row key. */
  key: string;
  label: string;
  start: Date;
  /** The viewer has a review row for this week. */
  hasReview?: boolean;
  /** That review is submitted: the pill carries a success dot. */
  submitted?: boolean;
}

/** Midnight local on the given day, with no time component. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The Monday on or before `date`, matching `weekStartFor` in
 * src/lib/weekly-review.ts, which is what the stored `periodStart` is.
 *
 * `weekStart` is the viewer's `home.locale.weekStart` (0 = Sunday). The stored
 * rows are Monday-based, so a viewer whose week starts on Sunday still sees
 * Monday-keyed weeks: changing the key would orphan every existing review.
 */
export function weekStartOf(date: Date): Date {
  const d = startOfDay(date);
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const back = dow === 0 ? 6 : dow - 1;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** "2026-09-14" from a Date, in LOCAL time (never toISOString, which shifts). */
export function weekKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a `?week=` value. Returns null for anything that is not a real date. */
export function parseWeekKey(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // Snap to the week's own Monday, so a mid-week value still resolves.
  return weekStartOf(d);
}

/**
 * The pills: This week, Last week, then the previous `count - 2` weeks by
 * short date. Newest first, which is the order a person scans.
 *
 * The spec's open question is answered by `count`: eight by default, and "•••"
 * (the caller's overflow) opens a month picker for older weeks.
 */
export function weekOptions(now: Date = new Date(), count = 8, locale?: string): WeekOption[] {
  const thisWeek = weekStartOf(now);
  const out: WeekOption[] = [];
  for (let i = 0; i < Math.max(1, count); i += 1) {
    const start = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7);
    out.push({
      key: weekKey(start),
      label:
        i === 0 ? "This week"
          : i === 1 ? "Last week"
            : start.toLocaleDateString(locale, { day: "numeric", month: "short" }),
      start,
    });
  }
  return out;
}

/** Is this the week we are in right now? Only that one auto-creates a draft. */
export function isCurrentWeek(key: string, now: Date = new Date()): boolean {
  return key === weekKey(weekStartOf(now));
}

/** "14 Sep to 20 Sep": the range under the title. */
export function weekRangeLabel(start: Date, locale?: string): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return `${fmt(start)} to ${fmt(end)}`;
}
