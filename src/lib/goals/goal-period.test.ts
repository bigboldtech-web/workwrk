// The period engine of repeating goals (docs/plans/recurring-goals.md B2, A2,
// A3, B6, B7, section 4 "Step 1. Must prove"). Every case reads real zones
// through Intl, so the daylight saving rules are the ones the server runs.
// Fails on the code before step 1: the module does not exist.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// okrStatusFor lives beside the goal queries; nothing here touches the database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  closesAt,
  daysLeft,
  defaultStart,
  firstBoundaryOnOrAfter,
  graceEndsAt,
  isGoalCadence,
  isScored,
  kpiCloseAt,
  kpiMonths,
  lastDayKey,
  mayOpen,
  nextPeriod,
  nominalOf,
  openedAfterWindow,
  periodAt,
  periodDatesLabel,
  periodFor,
  periodLabel,
  periodSettingsOf,
  planCadenceChange,
  RESULT_LABEL,
  resultFor,
  startOfZonedDay,
  startOptions,
  trackedFrom,
  type GoalCadence,
  type GoalPeriodRange,
  type PeriodSettings,
} from "./goal-period";
import { goalQuarterLabel } from "@/lib/fiscal-quarter";
import { isKpiPeriodWritableAnyZone } from "@/lib/kpi-period";
import { okrStatusFor } from "@/lib/alignment";
import { zonedDateKey, zonedHhmm, zonedWallClockToUtc } from "@/lib/zoned-time";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const KOL: PeriodSettings = { timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 };
const KOL_SUN: PeriodSettings = { ...KOL, weekStart: "SUN" };
const KOL_JAN: PeriodSettings = { ...KOL, fiscalYearStart: 1 };
const NY: PeriodSettings = { timezone: "America/New_York", weekStart: "MON", fiscalYearStart: 4 };
const AKL: PeriodSettings = { timezone: "Pacific/Auckland", weekStart: "SUN", fiscalYearStart: 4 };
const SCL: PeriodSettings = { timezone: "America/Santiago", weekStart: "SUN", fiscalYearStart: 1 };
const UTC: PeriodSettings = { timezone: "UTC", weekStart: "MON", fiscalYearStart: 4 };

/** "Today" for the labels: Tuesday 27 October 2026, midday in Kolkata. */
const NOW = new Date("2026-10-27T06:30:00Z");

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();
const span = (p: { startsAt: Date; endsAt: Date }) => [iso(p.startsAt), iso(p.endsAt)];
const len = (p: { startsAt: Date; endsAt: Date }) => p.endsAt.getTime() - p.startsAt.getTime();

/**
 * Opens `count` periods after `first`, the settings for each opening given by
 * `settingsAt(i)` and the cadence by `cadenceAt(i)`, and checks the B2
 * identity rules on the whole chain: each starts exactly where the one before
 * ended, keys are never reused, each key is its start day in the zone it was
 * opened in, and none is shorter than half its nominal period.
 */
function chain(
  first: GoalPeriodRange,
  count: number,
  settingsAt: (i: number) => PeriodSettings,
  cadenceAt: (i: number) => GoalCadence = () => first.cadence,
): GoalPeriodRange[] {
  const out = [first];
  for (let i = 1; i <= count; i++) out.push(nextPeriod(out[i - 1], cadenceAt(i), settingsAt(i)));
  expectWellFormed(out, settingsAt);
  return out;
}

function expectWellFormed(periods: GoalPeriodRange[], settingsAt: (i: number) => PeriodSettings) {
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const s = settingsAt(i);
    expect(p.endsAt.getTime(), `period ${i} has length`).toBeGreaterThan(p.startsAt.getTime());
    if (i > 0) expect(iso(p.startsAt), `period ${i} starts where ${i - 1} ended`).toBe(iso(periods[i - 1].endsAt));
    if (i > 0) expect(p.key, `period ${i} key`).toBe(zonedDateKey(p.startsAt, s.timezone));
    expect(len(p) * 2, `period ${i} is at least half its nominal period`).toBeGreaterThanOrEqual(len(nominalOf(p, s)));
  }
  expect(new Set(periods.map((p) => p.key)).size).toBe(periods.length);
}

describe("periodFor: boundaries at 00:00 in the workspace zone", () => {
  it("starts October in Asia/Kolkata at 30 Sep 18:30 UTC", () => {
    const oct = periodFor("MONTHLY", at("2026-10-15T12:00:00Z"), KOL);
    expect(oct.key).toBe("2026-10-01");
    expect(oct.cadence).toBe("MONTHLY");
    expect(span(oct)).toEqual(["2026-09-30T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]);
    expect(periodLabel(oct, KOL, NOW)).toBe("October 2026");
    // The edges: the last millisecond of September and the first of October.
    expect(periodFor("MONTHLY", at("2026-09-30T18:29:59.999Z"), KOL).key).toBe("2026-09-01");
    expect(periodFor("MONTHLY", at("2026-09-30T18:30:00.000Z"), KOL).key).toBe("2026-10-01");
  });

  it("runs a New York month across the November daylight saving change", () => {
    const oct = periodFor("MONTHLY", at("2026-10-20T12:00:00Z"), NY);
    expect(span(oct)).toEqual(["2026-10-01T04:00:00.000Z", "2026-11-01T04:00:00.000Z"]);
    const nov = periodFor("MONTHLY", at("2026-11-15T12:00:00Z"), NY);
    // Midnight on 1 November is still daylight time (the change is at 02:00);
    // midnight on 1 December is standard time, an hour later in UTC.
    expect(span(nov)).toEqual(["2026-11-01T04:00:00.000Z", "2026-12-01T05:00:00.000Z"]);
    expect(len(nov)).toBe(30 * DAY + HOUR);
    expect(lastDayKey(nov, NY)).toBe("2026-11-30");
    // Both readings of 01:30 on 1 November are November.
    expect(periodFor("MONTHLY", at("2026-11-01T05:30:00Z"), NY).key).toBe("2026-11-01");
    expect(periodFor("MONTHLY", at("2026-11-01T06:30:00Z"), NY).key).toBe("2026-11-01");
    expect(periodFor("MONTHLY", at("2026-11-01T03:59:59.999Z"), NY).key).toBe("2026-10-01");
    // And March, an hour short.
    expect(span(periodFor("MONTHLY", at("2026-03-15T12:00:00Z"), NY))).toEqual(["2026-03-01T05:00:00.000Z", "2026-04-01T04:00:00.000Z"]);
  });

  it("keys a Pacific/Auckland period by its own day, a day ahead of UTC", () => {
    const oct = periodFor("MONTHLY", at("2026-10-15T00:00:00Z"), AKL);
    expect(oct.key).toBe("2026-10-01");
    expect(span(oct)).toEqual(["2026-09-30T11:00:00.000Z", "2026-10-31T11:00:00.000Z"]);
    // The Sunday week across the September change (02:00 to 03:00 on 27 Sep) is an hour short.
    const week = periodFor("WEEKLY", at("2026-09-28T00:00:00Z"), AKL);
    expect(week.key).toBe("2026-09-27");
    expect(span(week)).toEqual(["2026-09-26T12:00:00.000Z", "2026-10-03T11:00:00.000Z"]);
    expect(len(week)).toBe(7 * DAY - HOUR);
    // An Auckland instant on 1 October local is 30 September in UTC, and October here.
    expect(periodFor("MONTHLY", at("2026-09-30T11:00:00Z"), AKL).key).toBe("2026-10-01");
    expect(periodFor("MONTHLY", at("2026-09-30T10:59:59Z"), AKL).key).toBe("2026-09-01");
  });

  it("starts a Santiago week at 01:00 on the day whose midnight does not exist", () => {
    // Chile moves its clocks from 00:00 to 01:00 on Sunday 6 September 2026.
    // The shared helper lands that midnight on 23:00 the day before, which
    // would key the week by Saturday and end the week before an hour early.
    const raw = zonedWallClockToUtc("2026-09-06", "00:00", SCL.timezone)!;
    expect(iso(raw)).toBe("2026-09-06T03:00:00.000Z");
    expect(zonedDateKey(raw, SCL.timezone)).toBe("2026-09-05");

    const week = periodFor("WEEKLY", at("2026-09-08T15:00:00Z"), SCL);
    expect(week.key).toBe("2026-09-06");
    expect(iso(week.startsAt)).toBe("2026-09-06T04:00:00.000Z");
    expect(zonedHhmm(week.startsAt, SCL.timezone)).toBe("01:00");
    expect(zonedDateKey(week.startsAt, SCL.timezone)).toBe("2026-09-06");
    expect(periodLabel(week, SCL, NOW)).toBe("Week of 6 Sep");
    // The hour that does not exist is nobody's: this week is an hour short.
    expect(len(week)).toBe(7 * DAY - HOUR);

    // The week before ends exactly there; 23:30 on Saturday is still in it.
    const before = periodFor("WEEKLY", at("2026-09-06T03:30:00Z"), SCL);
    expect(before.key).toBe("2026-08-30");
    expect(iso(before.endsAt)).toBe("2026-09-06T04:00:00.000Z");
    expect(len(before)).toBe(7 * DAY);
    expect(iso(nextPeriod(before, "WEEKLY", SCL).startsAt)).toBe(iso(week.startsAt));
    expect(span(nextPeriod(before, "WEEKLY", SCL))).toEqual(span(week));

    // The April change (24:00 back to 23:00) repeats Saturday's last hour, and Sunday starts once.
    const april = periodFor("WEEKLY", at("2026-04-06T12:00:00Z"), SCL);
    expect(iso(april.startsAt)).toBe("2026-04-05T04:00:00.000Z");
    expect(periodFor("WEEKLY", at("2026-04-05T03:30:00Z"), SCL).key).toBe("2026-03-29");
  });

  it("returns the first instant of every day in every zone, memoised or not", () => {
    for (const zone of ["Asia/Kolkata", "America/New_York", "Pacific/Auckland", "America/Santiago", "UTC", "Europe/London"]) {
      for (let d = 0; d < 400; d++) {
        const key = zonedDateKey(new Date(Date.UTC(2026, 0, 1) + d * DAY + 12 * HOUR), zone);
        const start = startOfZonedDay(key, zone);
        expect(zonedDateKey(start, zone), `${zone} ${key}`).toBe(key);
        expect(zonedDateKey(new Date(start.getTime() - 60_000), zone) < key, `${zone} ${key} first`).toBe(true);
        expect(iso(startOfZonedDay(key, zone))).toBe(iso(start));
      }
    }
  });

  it("refuses an instant that is not one", () => {
    expect(() => periodFor("MONTHLY", new Date("nope"), KOL)).toThrow(RangeError);
  });
});

describe("weeks start on the workspace's week start day", () => {
  it("cuts Sunday weeks and Monday weeks", () => {
    const sun = periodFor("WEEKLY", NOW, KOL_SUN);
    expect(sun.key).toBe("2026-10-25");
    expect(span(sun)).toEqual(["2026-10-24T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]);
    expect(periodLabel(sun, KOL_SUN, NOW)).toBe("Week of 25 Oct");
    const mon = periodFor("WEEKLY", NOW, KOL);
    expect(mon.key).toBe("2026-10-26");
    expect(periodLabel(mon, KOL, NOW)).toBe("Week of 26 Oct");
    // A Sunday opens a Sunday week and closes a Monday one.
    const sunday = at("2026-11-01T06:00:00Z");
    expect(periodFor("WEEKLY", sunday, KOL_SUN).key).toBe("2026-11-01");
    expect(periodFor("WEEKLY", sunday, KOL).key).toBe("2026-10-26");
  });

  it("adds the year to a week of another year", () => {
    const week = periodFor("WEEKLY", at("2025-12-31T06:00:00Z"), KOL);
    expect(week.key).toBe("2025-12-29");
    expect(periodLabel(week, KOL, NOW)).toBe("Week of 29 Dec 2025");
    expect(periodLabel(week, KOL, at("2025-12-30T06:00:00Z"))).toBe("Week of 29 Dec");
  });
});

describe("quarters and years are fiscal (Settings > Locale)", () => {
  it("cuts April fiscal quarters", () => {
    const q1 = periodFor("QUARTERLY", at("2026-05-10T00:00:00Z"), KOL);
    expect(q1.key).toBe("2026-04-01");
    expect(span(q1)).toEqual(["2026-03-31T18:30:00.000Z", "2026-06-30T18:30:00.000Z"]);
    expect(periodLabel(q1, KOL, NOW)).toBe("Q1 FY27");
    const q3 = periodFor("QUARTERLY", NOW, KOL);
    expect(q3.key).toBe("2026-10-01");
    expect(iso(q3.endsAt)).toBe("2026-12-31T18:30:00.000Z");
    expect(periodLabel(q3, KOL, NOW)).toBe("Q3 FY27");
    const q4 = periodFor("QUARTERLY", at("2027-02-01T00:00:00Z"), KOL);
    expect(q4.key).toBe("2027-01-01");
    expect(periodLabel(q4, KOL, NOW)).toBe("Q4 FY27");
    expect(periodLabel(periodFor("QUARTERLY", NOW, KOL_JAN), KOL_JAN, NOW)).toBe("Q4 2026");
  });

  it("names quarters as goalQuarterLabel does", () => {
    for (const s of [KOL, KOL_JAN, { ...KOL, fiscalYearStart: 7 }, { ...KOL, fiscalYearStart: 10 }]) {
      let q = periodFor("QUARTERLY", at("2026-01-15T00:00:00Z"), s);
      for (let i = 0; i < 8; i++, q = nextPeriod(q, "QUARTERLY", s)) {
        expect(periodLabel(q, s, NOW)).toBe(goalQuarterLabel(new Date(`${lastDayKey(q, s)}T00:00:00Z`), s.fiscalYearStart));
      }
    }
  });

  it("cuts April fiscal years, in Kolkata and in Auckland", () => {
    const fy = periodFor("YEARLY", NOW, KOL);
    expect(fy.key).toBe("2026-04-01");
    expect(span(fy)).toEqual(["2026-03-31T18:30:00.000Z", "2027-03-31T18:30:00.000Z"]);
    expect(periodLabel(fy, KOL, NOW)).toBe("FY27");
    expect(periodDatesLabel(fy, KOL)).toBe("1 Apr 2026 to 31 Mar 2027");
    expect(periodLabel(periodFor("YEARLY", at("2027-03-31T18:29:59Z"), KOL), KOL, NOW)).toBe("FY27");
    expect(periodLabel(periodFor("YEARLY", at("2027-03-31T18:30:00Z"), KOL), KOL, NOW)).toBe("FY28");
    expect(span(periodFor("YEARLY", NOW, AKL))).toEqual(["2026-03-31T11:00:00.000Z", "2027-03-31T11:00:00.000Z"]);
    const cal = periodFor("YEARLY", NOW, KOL_JAN);
    expect(cal.key).toBe("2026-01-01");
    expect(periodLabel(cal, KOL_JAN, NOW)).toBe("2026");
  });

  it("reads the period settings from Organization.settings, the legacy fiscal string included", () => {
    expect(periodSettingsOf({})).toEqual({ timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 });
    expect(periodSettingsOf({ timezone: "America/New_York", fiscalYearStart: "01-01", locale: { weekStart: "SUN" } })).toEqual({
      timezone: "America/New_York",
      weekStart: "SUN",
      fiscalYearStart: 1,
    });
    expect(periodSettingsOf({ fiscalYearStart: 7 }).fiscalYearStart).toBe(7);
  });
});

describe("grace is counted in calendar days (B7)", () => {
  it("takes October's numbers until the end of 5 November", () => {
    const oct = periodFor("MONTHLY", NOW, KOL);
    const grace = graceEndsAt(oct, KOL);
    expect(iso(grace)).toBe("2026-11-05T18:30:00.000Z");
    expect(zonedDateKey(new Date(grace.getTime() - 1), KOL.timezone)).toBe("2026-11-05");
  });

  it("gives a week two days and a quarter or a year five", () => {
    expect(iso(graceEndsAt(periodFor("WEEKLY", NOW, KOL), KOL))).toBe("2026-11-03T18:30:00.000Z");
    expect(iso(graceEndsAt(periodFor("QUARTERLY", NOW, KOL), KOL))).toBe("2027-01-05T18:30:00.000Z");
    expect(iso(graceEndsAt(periodFor("YEARLY", NOW, KOL), KOL))).toBe("2027-04-05T18:30:00.000Z");
  });

  it("is five days at 00:00 local across a daylight saving change, not 120 hours", () => {
    const oct = periodFor("MONTHLY", at("2026-10-20T12:00:00Z"), NY);
    const grace = graceEndsAt(oct, NY);
    expect(iso(grace)).toBe("2026-11-06T05:00:00.000Z");
    expect(grace.getTime() - oct.endsAt.getTime()).toBe(5 * DAY + HOUR);
    expect(zonedHhmm(grace, NY.timezone)).toBe("00:00");
  });
});

describe("a goal with a KPI-linked target closes when the KPI month stops taking numbers", () => {
  it("closes October at 1 December 14:00 UTC, the moment the KPI gate shuts", () => {
    const oct = periodFor("MONTHLY", NOW, KOL);
    expect(kpiMonths(oct, KOL)).toEqual(["2026-10"]);
    const close = kpiCloseAt(oct, KOL)!;
    expect(iso(close)).toBe("2026-12-01T14:00:00.000Z");
    expect(isKpiPeriodWritableAnyZone("2026-10", new Date(close.getTime() - 1))).toBe(true);
    expect(isKpiPeriodWritableAnyZone("2026-10", close)).toBe(false);
    expect(iso(closesAt(oct, KOL, { kpiLinked: true }))).toBe("2026-12-01T14:00:00.000Z");
    expect(iso(closesAt(oct, KOL, { kpiLinked: false }))).toBe(iso(graceEndsAt(oct, KOL)));
  });

  it("names the workspace month, not the UTC one, east and west of UTC", () => {
    expect(kpiMonths(periodFor("MONTHLY", at("2026-10-15T00:00:00Z"), AKL), AKL)).toEqual(["2026-10"]);
    expect(kpiMonths(periodFor("MONTHLY", at("2026-10-15T00:00:00Z"), NY), NY)).toEqual(["2026-10"]);
    expect(iso(kpiCloseAt(periodFor("MONTHLY", at("2026-10-15T00:00:00Z"), AKL), AKL)!)).toBe("2026-12-01T14:00:00.000Z");
  });

  it("lets a quarter's or a year's last month set the close", () => {
    const q3 = periodFor("QUARTERLY", NOW, KOL);
    expect(kpiMonths(q3, KOL)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(iso(kpiCloseAt(q3, KOL)!)).toBe("2027-02-01T14:00:00.000Z");
    const fy = periodFor("YEARLY", NOW, KOL);
    expect(kpiMonths(fy, KOL)).toHaveLength(12);
    expect(kpiMonths(fy, KOL)[11]).toBe("2027-03");
    expect(iso(kpiCloseAt(fy, KOL)!)).toBe("2027-05-01T14:00:00.000Z");
  });

  it("never holds a week for a KPI", () => {
    const week = periodFor("WEEKLY", NOW, KOL);
    expect(kpiMonths(week, KOL)).toEqual([]);
    expect(kpiCloseAt(week, KOL)).toBeNull();
    expect(iso(closesAt(week, KOL, { kpiLinked: true }))).toBe(iso(graceEndsAt(week, KOL)));
  });
});

describe("identity: no gap and no overlap across a settings change (B2)", () => {
  it("moves from Kolkata to New York mid-chain", () => {
    const sep = periodFor("MONTHLY", at("2026-09-15T00:00:00Z"), KOL);
    const periods = chain(sep, 4, (i) => (i <= 1 ? KOL : NY));
    expect(periods[1].key).toBe("2026-10-01");
    // October in Kolkata ends at 18:30 UTC on 31 October; New York's October
    // has 9.5 hours left then, under half a month, so it joins November.
    expect(periods[2].key).toBe("2026-10-31");
    expect(span(periods[2])).toEqual(["2026-10-31T18:30:00.000Z", "2026-12-01T05:00:00.000Z"]);
    expect(periodLabel(periods[2], NY, NOW)).toBe("November 2026");
    expect(span(periods[3])).toEqual(["2026-12-01T05:00:00.000Z", "2027-01-01T05:00:00.000Z"]);
    expect(periods[3].key).toBe("2026-12-01");
  });

  it("moves from New York to Kolkata mid-chain", () => {
    const oct = periodFor("MONTHLY", at("2026-10-15T00:00:00Z"), NY);
    const periods = chain(oct, 3, (i) => (i === 0 ? NY : KOL));
    // New York's October ends at 09:30 on 1 November in Kolkata: nearly all of November is left.
    expect(span(periods[1])).toEqual(["2026-11-01T04:00:00.000Z", "2026-11-30T18:30:00.000Z"]);
    expect(periods[1].key).toBe("2026-11-01");
    expect(periodLabel(periods[1], KOL, NOW)).toBe("November 2026");
    expect(periods[2].key).toBe("2026-12-01");
  });

  it("holds for every cadence across every pair of zones", () => {
    const zones = [KOL, NY, AKL, SCL, UTC];
    for (const cadence of ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const) {
      for (const a of zones) {
        for (const b of zones) {
          const first = periodFor(cadence, at("2026-08-20T12:00:00Z"), a);
          chain(first, 5, (i) => (i < 2 ? a : b));
        }
      }
    }
  });

  it("moves a Monday week start to Sunday, and back", () => {
    const mon = periodFor("WEEKLY", NOW, KOL);
    const toSun = chain(mon, 3, (i) => (i === 0 ? KOL : KOL_SUN));
    // Monday 2 November: six days of the Sunday week of 1 November are left, more than half.
    expect(toSun[1].key).toBe("2026-11-02");
    expect(len(toSun[1])).toBe(6 * DAY);
    expect(periodLabel(toSun[1], KOL_SUN, NOW)).toBe("Week of 1 Nov");
    expect(toSun[2].key).toBe("2026-11-08");

    const sun = periodFor("WEEKLY", NOW, KOL_SUN);
    const toMon = chain(sun, 3, (i) => (i === 0 ? KOL_SUN : KOL));
    // Sunday 1 November: one day of the Monday week is left, so it joins the next week.
    expect(toMon[1].key).toBe("2026-11-01");
    expect(len(toMon[1])).toBe(8 * DAY);
    expect(periodLabel(toMon[1], KOL, NOW)).toBe("Week of 2 Nov");
    expect(toMon[2].key).toBe("2026-11-09");
  });

  it("moves the fiscal year start", () => {
    const q3 = periodFor("QUARTERLY", NOW, KOL);
    const feb = { ...KOL, fiscalYearStart: 2 };
    const quarters = chain(q3, 3, (i) => (i === 0 ? KOL : feb));
    // January is the last month of a February-start quarter: it joins the next one.
    expect(quarters[1].key).toBe("2027-01-01");
    expect(lastDayKey(quarters[1], feb)).toBe("2027-04-30");
    expect(periodLabel(quarters[1], feb, NOW)).toBe("Q1 FY28");
    expect(quarters[2].key).toBe("2027-05-01");

    const fy = periodFor("YEARLY", NOW, KOL);
    const years = chain(fy, 2, (i) => (i === 0 ? KOL : KOL_JAN));
    // April to December 2027 is more than half a calendar year: it stands, and 2028 follows.
    expect(years[1].key).toBe("2027-04-01");
    expect(lastDayKey(years[1], KOL_JAN)).toBe("2027-12-31");
    expect(periodLabel(years[1], KOL_JAN, NOW)).toBe("2027");
    expect(years[2].key).toBe("2028-01-01");
    expect(periodLabel(years[2], KOL_JAN, NOW)).toBe("2028");
  });

  it("finds the current period among the stored rows, not by recomputing a key", () => {
    const sep = periodFor("MONTHLY", at("2026-09-15T00:00:00Z"), KOL);
    const stored = chain(sep, 2, (i) => (i <= 1 ? KOL : NY));
    const mid = at("2026-11-15T12:00:00Z");
    // Under today's settings the key would be New York's November; the stored row is "2026-10-31".
    expect(periodFor("MONTHLY", mid, NY).key).toBe("2026-11-01");
    expect(periodAt(stored, mid)?.key).toBe("2026-10-31");
    expect(periodAt(stored, at("2026-10-31T18:29:59.999Z"))?.key).toBe("2026-10-01");
    expect(periodAt(stored, at("2027-06-01T00:00:00Z"))).toBeNull();
  });

  it("never opens a period that overlaps a stored one or reuses its key", () => {
    const sep = periodFor("MONTHLY", at("2026-09-15T00:00:00Z"), KOL);
    const stored = chain(sep, 2, (i) => (i <= 1 ? KOL : NY));
    expect(mayOpen(periodFor("MONTHLY", at("2026-11-15T00:00:00Z"), NY), stored)).toBe(false);
    expect(mayOpen({ ...nextPeriod(stored[2], "MONTHLY", NY), key: "2026-10-01" }, stored)).toBe(false);
    expect(mayOpen(nextPeriod(stored[2], "MONTHLY", NY), stored)).toBe(true);
    const empty = { key: "2027-01-01", startsAt: at("2027-01-01T00:00:00Z"), endsAt: at("2027-01-01T00:00:00Z") };
    expect(mayOpen(empty, [])).toBe(false);
  });
});

describe("a change of Repeats every (A3)", () => {
  const oct = periodFor("MONTHLY", NOW, KOL);

  it("monthly to quarterly: November and December stay monthly, quarterly from 1 January", () => {
    const plan = planCadenceChange(oct, "QUARTERLY", KOL);
    expect(plan.direction).toBe("coarser");
    expect(iso(plan.currentEndsAt)).toBe(iso(oct.endsAt));
    expect(iso(plan.effectiveFrom)).toBe("2026-12-31T18:30:00.000Z");
    const periods = chain(oct, 3, () => KOL, () => "QUARTERLY");
    expect(periods.map((p) => [p.cadence, periodLabel(p, KOL, NOW)])).toEqual([
      ["MONTHLY", "October 2026"],
      ["MONTHLY", "November 2026"],
      ["MONTHLY", "December 2026"],
      ["QUARTERLY", "Q4 FY27"],
    ]);
    expect(span(periods[3])).toEqual(["2026-12-31T18:30:00.000Z", "2027-03-31T18:30:00.000Z"]);
    // From a month that ends a quarter, the next period is quarterly at once.
    const dec = periods[2];
    expect(iso(planCadenceChange(dec, "QUARTERLY", KOL).effectiveFrom)).toBe(iso(dec.endsAt));
    expect(nextPeriod(dec, "QUARTERLY", KOL).cadence).toBe("QUARTERLY");
  });

  it("monthly to weekly: October runs to 1 November, weekly from Monday 2 November", () => {
    const plan = planCadenceChange(oct, "WEEKLY", KOL);
    expect(plan.direction).toBe("finer");
    // 1 November 2026 is a Sunday: October is stretched by that one day, never cut.
    expect(iso(plan.currentEndsAt)).toBe("2026-11-01T18:30:00.000Z");
    expect(iso(plan.effectiveFrom)).toBe("2026-11-01T18:30:00.000Z");
    const stretched = { ...oct, endsAt: plan.currentEndsAt };
    expect(lastDayKey(stretched, KOL)).toBe("2026-11-01");
    // Named by its middle: still October (its last instant is in November).
    expect(periodLabel(stretched, KOL, NOW)).toBe("October 2026");
    expect(periodFor("MONTHLY", new Date(stretched.endsAt.getTime() - 1), KOL).key).toBe("2026-11-01");
    const periods = chain(stretched, 2, () => KOL, () => "WEEKLY");
    expect(periods[1].cadence).toBe("WEEKLY");
    expect(periods[1].key).toBe("2026-11-02");
    expect(periodLabel(periods[1], KOL, NOW)).toBe("Week of 2 Nov");
    expect(len(periods[1])).toBe(7 * DAY);
    expect(periods[2].key).toBe("2026-11-09");
  });

  it("monthly to weekly when the month already ends on a week start: nothing stretches", () => {
    // 1 March 2027 is a Monday.
    const feb = periodFor("MONTHLY", at("2027-02-10T00:00:00Z"), KOL);
    const plan = planCadenceChange(feb, "WEEKLY", KOL);
    expect(iso(plan.currentEndsAt)).toBe(iso(feb.endsAt));
    expect(nextPeriod(feb, "WEEKLY", KOL).key).toBe("2027-03-01");
  });

  it("weekly to monthly: weeks run until 1 December, the last one stretched rather than a one-day stub", () => {
    const week = periodFor("WEEKLY", at("2026-11-03T06:00:00Z"), KOL);
    expect(week.key).toBe("2026-11-02");
    const plan = planCadenceChange(week, "MONTHLY", KOL);
    expect(plan.direction).toBe("coarser");
    expect(iso(plan.currentEndsAt)).toBe(iso(week.endsAt));
    expect(iso(plan.effectiveFrom)).toBe("2026-11-30T18:30:00.000Z");
    const periods = chain(week, 4, () => KOL, () => "MONTHLY");
    expect(periods.map((p) => p.key)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-12-01"]);
    expect(len(periods[3])).toBe(8 * DAY);
    expect(periods[3].cadence).toBe("WEEKLY");
    expect(periodLabel(periods[3], KOL, NOW)).toBe("Week of 23 Nov");
    expect(periods[4].cadence).toBe("MONTHLY");
    expect(periodLabel(periods[4], KOL, NOW)).toBe("December 2026");

    // Changed during the week of 23 November itself: that week stretches to 1 December.
    const late = planCadenceChange(periodFor("WEEKLY", at("2026-11-24T06:00:00Z"), KOL), "MONTHLY", KOL);
    expect(iso(late.currentEndsAt)).toBe("2026-11-30T18:30:00.000Z");
    expect(iso(late.effectiveFrom)).toBe("2026-11-30T18:30:00.000Z");
  });

  it("joins a stub to the new cadence's first period when the change was not planned", () => {
    // A week ending Monday 30 November, the goal already monthly: one day to
    // 1 December is under half a week, so it opens with December.
    const week = periodFor("WEEKLY", at("2026-11-24T06:00:00Z"), KOL);
    const next = nextPeriod(week, "MONTHLY", KOL);
    expect(next.cadence).toBe("MONTHLY");
    expect(span(next)).toEqual(["2026-11-29T18:30:00.000Z", "2026-12-31T18:30:00.000Z"]);
    expect(periodLabel(next, KOL, NOW)).toBe("December 2026");
    // And an unplanned monthly to weekly opens no stub either.
    const unplanned = nextPeriod(oct, "WEEKLY", KOL);
    expect(len(unplanned)).toBe(8 * DAY);
    expect(periodLabel(unplanned, KOL, NOW)).toBe("Week of 2 Nov");
  });

  it("quarterly to monthly and yearly to quarterly need no stretch; the same cadence changes nothing", () => {
    const q3 = periodFor("QUARTERLY", NOW, KOL);
    expect(planCadenceChange(q3, "MONTHLY", KOL)).toEqual({ direction: "finer", currentEndsAt: q3.endsAt, effectiveFrom: q3.endsAt });
    expect(nextPeriod(q3, "MONTHLY", KOL).key).toBe("2027-01-01");
    const fy = periodFor("YEARLY", NOW, KOL);
    expect(iso(planCadenceChange(fy, "QUARTERLY", KOL).currentEndsAt)).toBe(iso(fy.endsAt));
    expect(planCadenceChange(oct, "MONTHLY", KOL).direction).toBe("same");
    expect(iso(firstBoundaryOnOrAfter("MONTHLY", oct.endsAt, KOL))).toBe(iso(oct.endsAt));
  });
});

describe("no stub under half a period", () => {
  it("never opens a period shorter than half its nominal one, from any starting instant", () => {
    for (const s of [KOL, NY, AKL, SCL]) {
      for (const cadence of ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const) {
        for (let h = 0; h < 24 * 40; h += 17) {
          const prev: GoalPeriodRange = { key: "x", cadence, startsAt: at("2026-01-01T00:00:00Z"), endsAt: new Date(Date.UTC(2026, 9, 1) + h * HOUR) };
          const p = nextPeriod(prev, cadence, s);
          const nominal = nominalOf(p, s);
          expect(len(p) * 2, `${s.timezone} ${cadence} +${h}h`).toBeGreaterThanOrEqual(len(nominal));
          // And never much more than one and a half (months and years differ in length).
          expect(len(p), `${s.timezone} ${cadence} +${h}h`).toBeLessThanOrEqual(len(nominal) * 1.5 + 4 * DAY);
          expect(iso(p.startsAt)).toBe(iso(prev.endsAt));
        }
      }
    }
  });
});

describe("Starts (A2)", () => {
  it("offers the current period and the next twelve, never a past one", () => {
    const options = startOptions("MONTHLY", NOW, KOL);
    expect(options).toHaveLength(13);
    expect(options[0].key).toBe("2026-10-01");
    expect(options[12].key).toBe("2027-10-01");
    for (let i = 1; i < options.length; i++) expect(iso(options[i].startsAt)).toBe(iso(options[i - 1].endsAt));
    expect(periodDatesLabel(startOptions("YEARLY", NOW, KOL)[0], KOL)).toBe("1 Apr 2026 to 31 Mar 2027");
  });

  it("defaults to the current period only while half of it remains", () => {
    expect(daysLeft(periodFor("MONTHLY", NOW, KOL), NOW, KOL)).toBe(4);
    expect(defaultStart("MONTHLY", NOW, KOL).key).toBe("2026-11-01");
    expect(defaultStart("MONTHLY", at("2026-10-10T06:00:00Z"), KOL).key).toBe("2026-10-01");
    // Midday on Tuesday 27 October: five and a half days of the week are left.
    expect(defaultStart("WEEKLY", NOW, KOL).key).toBe("2026-10-26");
    expect(defaultStart("QUARTERLY", NOW, KOL).key).toBe("2026-10-01");
    expect(defaultStart("YEARLY", NOW, KOL).key).toBe("2027-04-01");
  });

  it("counts days left in calendar days of the workspace zone", () => {
    const oct = periodFor("MONTHLY", NOW, KOL);
    expect(daysLeft(oct, at("2026-10-31T06:00:00Z"), KOL)).toBe(0);
    expect(daysLeft(oct, at("2026-11-02T06:00:00Z"), KOL)).toBe(0);
    expect(daysLeft(oct, at("2026-09-20T06:00:00Z"), KOL)).toBe(30);
  });
});

describe("trackedFrom, results and scoring (B1, B6)", () => {
  const oct = periodFor("MONTHLY", NOW, KOL);

  it("tracks from the later of the period's start and the goal's start", () => {
    expect(iso(trackedFrom(oct, NOW))).toBe(iso(NOW));
    expect(iso(trackedFrom(oct, at("2026-08-01T00:00:00Z")))).toBe(iso(oct.startsAt));
  });

  it("decides the result on the clamped progress", () => {
    expect(resultFor(100)).toBe("HIT");
    expect(resultFor(112)).toBe("HIT");
    expect(resultFor(99.6)).toBe("HIT");
    expect(resultFor(99)).toBe("PARTLY_HIT");
    expect(resultFor(70)).toBe("PARTLY_HIT");
    expect(resultFor(69.4)).toBe("MISSED");
    expect(resultFor(0)).toBe("MISSED");
    expect(resultFor(-5)).toBe("MISSED");
    expect(resultFor(null)).toBe("NOT_MEASURED");
    expect(resultFor(undefined)).toBe("NOT_MEASURED");
    expect(resultFor(Number.NaN)).toBe("NOT_MEASURED");
    expect(RESULT_LABEL).toEqual({ HIT: "Hit", PARTLY_HIT: "Partly hit", MISSED: "Missed", NOT_MEASURED: "Not measured" });
  });

  it("draws the Hit and Partly hit lines where okrStatusFor draws Completed and On track", () => {
    for (let p = 0; p <= 100; p++) {
      const status = okrStatusFor(p);
      expect(resultFor(p) === "HIT", String(p)).toBe(status === "COMPLETED");
      expect(resultFor(p) === "PARTLY_HIT", String(p)).toBe(status === "ON_TRACK");
    }
  });

  it("does not score a goal created on 27 October in October, and scores one from the 10th", () => {
    const created = at("2026-10-27T04:30:00Z");
    const base = { result: "MISSED" as const, startsAt: oct.startsAt, endsAt: oct.endsAt, openedAfterWindow: false };
    expect(isScored({ ...base, trackedFrom: trackedFrom(oct, created) })).toBe(false);
    expect(isScored({ ...base, trackedFrom: trackedFrom(oct, at("2026-10-10T04:30:00Z")) })).toBe(true);
    // Exactly half counts; a minute less does not.
    const half = new Date(oct.startsAt.getTime() + len(oct) / 2);
    expect(isScored({ ...base, trackedFrom: half })).toBe(true);
    expect(isScored({ ...base, trackedFrom: new Date(half.getTime() + 60_000) })).toBe(false);
  });

  it("never scores Not measured, or a period opened after its window", () => {
    const base = { startsAt: oct.startsAt, endsAt: oct.endsAt, trackedFrom: oct.startsAt };
    expect(isScored({ ...base, result: "NOT_MEASURED", openedAfterWindow: false })).toBe(false);
    expect(isScored({ ...base, result: "HIT", openedAfterWindow: true })).toBe(false);
    expect(isScored({ ...base, result: "HIT", openedAfterWindow: false })).toBe(true);
    const grace = graceEndsAt(oct, KOL);
    expect(openedAfterWindow({ graceEndsAt: grace }, grace)).toBe(true);
    expect(openedAfterWindow({ graceEndsAt: grace }, new Date(grace.getTime() - 1))).toBe(false);
  });
});

describe("the cadence values", () => {
  it("knows the four cadences and nothing else", () => {
    for (const c of ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]) expect(isGoalCadence(c)).toBe(true);
    for (const c of ["BIWEEKLY", "monthly", "", null, 3]) expect(isGoalCadence(c)).toBe(false);
  });
});

describe("the new files", () => {
  const ROOT = process.cwd();
  const FILES = ["src/lib/goals/goal-period.ts", "src/lib/goals/recurring-flag.ts"];

  it("never use hour12 (Node 20 prints midnight as 24)", () => {
    for (const f of FILES) {
      const code = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, f).not.toMatch(/hour12\s*:/);
    }
  });

  it("write no em dash or double hyphen in a label", () => {
    const labels = [
      ...Object.values(RESULT_LABEL),
      periodLabel(periodFor("WEEKLY", NOW, KOL), KOL, NOW),
      periodDatesLabel(periodFor("YEARLY", NOW, KOL), KOL),
    ];
    for (const l of labels) expect(l).not.toMatch(/—|–|--/);
    for (const f of FILES) expect(readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/—|–/);
  });
});
